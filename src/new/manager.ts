import {
    acquireHashWorker,
    commitUpload,
    finishUpload,
    getHashWorkerCount,
    hexToBinary,
    prepareNextPart,
    preparePart,
    releaseHashWorker,
    UploadError,
} from './function';
import { UploadPart, UploadPartDetails, UploadSignature } from './types';
import { Upload, UploadState } from './upload';

interface ChunkTask {
    upload_id: string;
    part: number;
    start: number;
    end: number;
    retries: number;
}

interface ManagerConfig {
    simultaneous: number;
    parallel: number;
    retries: number;
    auto_start: boolean;
    auto_remove: boolean;
    remove_after_ms: number;
}

/** Backoff between retries of a failed chunk, in milliseconds */
const RETRY_DELAYS = [300, 900, 2700];

let _upload_list: Upload[] = [];
let _chunk_queue: ChunkTask[] = [];
let _active_chunks = 0;
// Tracked by ID rather than as a count so releasing a slot is idempotent. A
// bare counter leaked a slot on every path that forgot to decrement, and once
// the count reached `simultaneous` no further upload could ever start.
let _active_upload_ids: Set<string> = new Set();
let _paused_uploads: Set<string> = new Set();
let _pending_uploads: Upload[] = [];
let _removal_timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Hash cache: Map<"upload_id:part", {hex, base64}> for chunk hashes
interface HashCacheEntry {
    hex: string;
    base64: string;
}
let _hash_cache: Map<string, HashCacheEntry> = new Map();

let _config: ManagerConfig = {
    simultaneous: 2,
    parallel: 3,
    retries: 3,
    auto_start: true,
    auto_remove: false,
    remove_after_ms: -1,
};

/** Configure the manager settings */
export function configureUploadManager(options: Partial<ManagerConfig>) {
    console.debug('[UPLOADS] Configured upload manager');
    _config = { ..._config, ...options };
}

/** Calculate MD5 hash of a blob/file chunk using ts-md5 ParallelHasher */
async function md5Hash(blob: Blob): Promise<HashCacheEntry> {
    const { worker, index } = await acquireHashWorker();
    try {
        const hash = await worker.hash(blob);
        const hashStr = hash as string;

        // Remove any non-hex characters (spaces, etc.) before converting
        const hex = hashStr.replace(/[^0-9a-fA-F]/g, '');
        const base64 = window.btoa(hexToBinary(hex));

        return { hex, base64 };
    } finally {
        releaseHashWorker(index);
    }
}

/** Clear hash cache for an upload */
function clearHashCache(uploadId: string): void {
    // Remove all entries for this upload
    for (const key of _hash_cache.keys()) {
        if (key.startsWith(`${uploadId}:`)) {
            _hash_cache.delete(key);
        }
    }
}

/** Get the total number of parts for a file */
function getTotalParts(file: File, partSize: number): number {
    return Math.ceil(file.size / partSize);
}

/** Slice a file into a chunk */
function getChunk(file: File, part: number, partSize: number): Blob {
    const start = (part - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    return file.slice(start, end);
}

/** Update upload state */
function updateState(upload: Upload, updates: Partial<UploadState>) {
    const current = upload.state.getValue();
    upload.state.next({ ...current, ...updates });
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    return 'Unknown upload error';
}

/**
 * Anything that did not come back with a status is treated as transient, since
 * that is the shape of a dropped connection.
 */
function isRetryable(error: unknown): boolean {
    return error instanceof UploadError ? error.retryable : true;
}

function delay(duration: number) {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

/** Claim one of the simultaneous upload slots, if any are free */
function acquireUploadSlot(upload: Upload): boolean {
    if (_active_upload_ids.has(upload.id)) return true;
    if (_active_upload_ids.size >= _config.simultaneous) return false;
    _active_upload_ids.add(upload.id);
    return true;
}

/** Release an upload's slot and start whatever is waiting on it */
function releaseUploadSlot(upload_id: string) {
    if (!_active_upload_ids.delete(upload_id)) return;
    processNextPendingUpload();
}

/** Mark an upload as failed, recording why, and free its slot */
function failUpload(upload: Upload, error: unknown, context: string) {
    console.error(`[UPLOADS] ${context} for ${upload.file.name}:`, error);
    clearHashCache(upload.id);
    _chunk_queue = _chunk_queue.filter((task) => task.upload_id !== upload.id);
    updateState(upload, {
        status: 'FAILED',
        working: [],
        error: errorMessage(error),
    });
    releaseUploadSlot(upload.id);
}

/**
 * The lowest part that still needs uploading. Parts complete out of order, so
 * resuming from `max(completed) + 1` would strand any earlier gap and the
 * upload could never reach its part count to finalise.
 */
function firstIncompletePart(upload: Upload): number {
    const completed = new Set(upload.state.getValue().completed);
    const total = getTotalParts(upload.file, upload.provider.part_size);
    for (let part = 1; part <= total; part++) {
        if (!completed.has(part)) return part;
    }
    return total + 1;
}

/** Start or continue the work outstanding for an upload holding a slot */
function startUploadWork(upload: Upload) {
    if (upload.is_direct) {
        void processDirectUpload(upload);
        return;
    }
    const next_part = firstIncompletePart(upload);
    const total = getTotalParts(upload.file, upload.provider.part_size);
    if (next_part > total) {
        // Every chunk is uploaded and only finalisation is outstanding, which
        // is the state a failed finalise leaves behind.
        void finalizeUpload(upload).catch((error) =>
            failUpload(upload, error, 'Finalisation failed'),
        );
        return;
    }
    void queueChunks(upload, next_part).catch((error) =>
        failUpload(upload, error, 'Failed to queue chunks'),
    );
}

/** Upload a single chunk to the blob storage */
async function uploadChunk(
    signature: UploadSignature,
    chunk: Blob,
): Promise<string> {
    let response: Response;
    try {
        response = await fetch(signature.url, {
            method: signature.verb,
            headers: signature.headers,
            body: chunk,
        });
    } catch (error) {
        // Network error or fetch was aborted
        const message =
            error instanceof Error ? error.message : 'Unknown network error';
        throw new UploadError(`Chunk upload failed: ${message}`);
    }

    if (!response.ok) {
        // Server returned an error status
        let errorBody = '';
        try {
            errorBody = await response.text();
        } catch {
            // Ignore errors reading error body
        }
        throw new UploadError(
            `Chunk upload failed with status ${response.status}: ${errorBody || response.statusText}`,
            response.status,
            errorBody,
        );
    }

    // Return the ETag or response text for part tracking
    return response.headers.get('ETag') || (await response.text());
}

/** Process the next chunk in the queue */
async function processNextChunk(): Promise<void> {
    if (_chunk_queue.length === 0 || _active_chunks >= _config.parallel) {
        return;
    }

    const task = _chunk_queue.shift();
    if (!task) return;

    const upload = getUpload(task.upload_id);
    if (!upload || _paused_uploads.has(task.upload_id)) {
        // Upload was removed or paused; drop this chunk but keep draining the
        // queue, otherwise chunks queued behind it stall indefinitely.
        processNextChunk();
        return;
    }

    _active_chunks++;
    const state = upload.state.getValue();

    // Mark chunk as working
    updateState(upload, {
        status: 'UPLOADING',
        working: [...state.working, task.part],
    });

    try {
        // Get pre-computed hash from cache (use base64 for API calls)
        const partHashEntry = _hash_cache.get(`${upload.id}:${task.part}`);
        const partHash = partHashEntry?.base64 ?? '';
        const totalParts = getTotalParts(
            upload.file,
            upload.provider.part_size,
        );
        const completedParts = upload.state.getValue().completed;

        // Get signature for this part
        let signature: UploadSignature;
        if (completedParts.length === 0) {
            // First part - use preparePart
            signature = await preparePart(
                upload.id,
                upload.resume_id,
                task.part,
                partHash,
            );
        } else {
            // Build finished parts details for all completed parts
            const finishedParts: UploadPartDetails = {
                part_list: completedParts,
                part_data: completedParts.map((part) => ({
                    part,
                    md5: _hash_cache.get(`${upload.id}:${part}`)?.base64 ?? '',
                })),
            };

            // Subsequent parts - notify previous completion and get next signature
            signature = await prepareNextPart(
                upload.id,
                task.part,
                partHash,
                finishedParts,
            );
        }

        // Create chunk only when needed for upload
        const chunk = getChunk(
            upload.file,
            task.part,
            upload.provider.part_size,
        );

        // Upload the chunk to blob storage
        await uploadChunk(signature, chunk);

        // Update state - mark as completed
        const currentState = upload.state.getValue();
        const newCompleted = [...currentState.completed, task.part].sort(
            (a, b) => a - b,
        );
        const newWorking = currentState.working.filter((p) => p !== task.part);

        updateState(upload, {
            completed: newCompleted,
            working: newWorking,
            progress: Math.round((newCompleted.length / totalParts) * 100),
        });

        // Check if upload is complete
        if (newCompleted.length === totalParts) {
            try {
                await finalizeUpload(upload);
            } catch (finalizeError) {
                failUpload(upload, finalizeError, 'Finalisation failed');
                return;
            }
        }
    } catch (error) {
        const currentState = upload.state.getValue();
        const newWorking = currentState.working.filter((p) => p !== task.part);

        // Retry if the failure is transient and we have attempts left. A
        // rejected signature (403) never succeeds on replay; failing fast
        // hands it back to resume, which signs the part again.
        if (isRetryable(error) && task.retries < _config.retries) {
            const wait =
                RETRY_DELAYS[Math.min(task.retries, RETRY_DELAYS.length - 1)];
            console.warn(
                `Chunk upload failed for part ${task.part}, retrying in ${wait}ms (${task.retries + 1}/${_config.retries})...`,
                error,
            );
            updateState(upload, { working: newWorking });
            // Backoff before re-queuing; an immediate retry just burns the
            // budget against a server that is still failing.
            void delay(wait).then(() => {
                if (!getUpload(task.upload_id)) return;
                _chunk_queue.push({ ...task, retries: task.retries + 1 });
                processNextChunk();
            });
        } else {
            failUpload(
                upload,
                error,
                `Chunk ${task.part} failed after ${_config.retries} retries`,
            );
        }
    } finally {
        _active_chunks -= 1;
        // Process next chunk
        processNextChunk();
    }
}

/** Finalize a completed upload */
async function finalizeUpload(upload: Upload): Promise<void> {
    const state = upload.state.getValue();
    const partData: UploadPart[] = [];

    // Build part data with pre-computed hashes from cache
    for (const part of state.completed) {
        const hashEntry = _hash_cache.get(`${upload.id}:${part}`);
        partData.push({
            part,
            md5: hashEntry?.base64 ?? '',
            md5_hex: hashEntry?.hex ?? '',
        });
    }

    // Get finalization signature
    const signature = await finishUpload(upload.id, {
        part_list: state.completed,
        part_data: partData,
    });

    // If signature has a URL, send the finalization request to blob storage
    if (signature.url) {
        let response: Response;
        try {
            response = await fetch(signature.url, {
                method: signature.verb,
                headers: signature.headers,
                body:
                    signature.body ||
                    upload.provider.finalise_body(upload, partData),
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown network error';
            throw new UploadError(`Finalization request failed: ${message}`);
        }

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch {
                // Ignore errors reading error body
            }
            throw new UploadError(
                `Finalization request failed with status ${response.status}: ${errorBody || response.statusText}`,
                response.status,
                errorBody,
            );
        }
    }

    // Commit the upload in PlaceOS
    await commitUpload(upload.id);

    // Clear hash cache for this upload - no longer needed
    clearHashCache(upload.id);

    updateState(upload, {
        status: 'COMPLETED',
        progress: 100,
        error: undefined,
    });

    releaseUploadSlot(upload.id);

    // Handle auto-removal
    if (_config.auto_remove) {
        if (_config.remove_after_ms >= 0) {
            // Schedule removal after specified delay
            const timer = setTimeout(() => {
                removeUpload(upload.id);
                _removal_timers.delete(upload.id);
            }, _config.remove_after_ms);
            _removal_timers.set(upload.id, timer);
        } else {
            // Remove immediately
            removeUpload(upload.id);
        }
    }
}

/** Process the next pending upload if under the simultaneous limit */
function processNextPendingUpload(): void {
    if (
        _pending_uploads.length === 0 ||
        _active_upload_ids.size >= _config.simultaneous
    ) {
        return;
    }

    const pending = _pending_uploads.shift();
    if (!pending) return;
    if (!acquireUploadSlot(pending)) {
        _pending_uploads.unshift(pending);
        return;
    }

    updateState(pending, { status: 'UPLOADING' });
    startUploadWork(pending);
}

/** Process a direct (non-chunked) upload */
async function processDirectUpload(
    upload: Upload,
    retries: number = 0,
): Promise<void> {
    if (!upload.direct_signature) {
        failUpload(
            upload,
            new Error(`Direct upload ${upload.id} is missing its signature`),
            'Direct upload could not start',
        );
        return;
    }

    console.debug(
        `[UPLOADS] Processing direct upload for ${upload.file.name}...`,
    );
    updateState(upload, { status: 'UPLOADING', progress: 0 });

    try {
        // Upload the file directly
        const response = await fetch(upload.direct_signature.url, {
            method: upload.direct_signature.verb,
            headers: upload.direct_signature.headers,
            body: upload.file,
        });

        if (!response.ok) {
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch {
                // Ignore errors reading error body
            }
            throw new UploadError(
                `Upload failed with status ${response.status}: ${errorBody || response.statusText}`,
                response.status,
                errorBody,
            );
        }

        console.debug(
            `[UPLOADS] Direct upload complete for ${upload.file.name}, committing...`,
        );

        // Commit the upload in PlaceOS
        await commitUpload(upload.id);

        updateState(upload, {
            status: 'COMPLETED',
            progress: 100,
            error: undefined,
        });

        releaseUploadSlot(upload.id);

        // Handle auto-removal
        if (_config.auto_remove) {
            if (_config.remove_after_ms >= 0) {
                const timer = setTimeout(() => {
                    removeUpload(upload.id);
                    _removal_timers.delete(upload.id);
                }, _config.remove_after_ms);
                _removal_timers.set(upload.id, timer);
            } else {
                removeUpload(upload.id);
            }
        }
    } catch (error) {
        // Retry if the failure is transient and we have attempts left
        if (isRetryable(error) && retries < _config.retries) {
            const wait =
                RETRY_DELAYS[Math.min(retries, RETRY_DELAYS.length - 1)];
            console.warn(
                `[UPLOADS] Direct upload failed for ${upload.file.name}, retrying in ${wait}ms (${retries + 1}/${_config.retries})...`,
                error,
            );
            await delay(wait);
            if (!getUpload(upload.id) || _paused_uploads.has(upload.id)) return;
            await processDirectUpload(upload, retries + 1);
        } else {
            failUpload(
                upload,
                error,
                `Direct upload failed after ${_config.retries} retries`,
            );
        }
    }
}

/** Queue chunks for an upload, hashing in parallel and queuing as each completes */
async function queueChunks(
    upload: Upload,
    startPart: number = 1,
): Promise<void> {
    // Validate provider has a valid part size
    if (!upload.provider.part_size || upload.provider.part_size <= 0) {
        throw new Error(
            `Invalid provider part_size: ${upload.provider.part_size}. Provider: ${upload.provider.name}`,
        );
    }

    if (!upload.resume_id) {
        throw new Error(
            `Invalid resume_id: ${upload.resume_id}. Upload: ${upload.id}`,
        );
    }

    const totalParts = getTotalParts(upload.file, upload.provider.part_size);
    const state = upload.state.getValue();
    const workerCount = getHashWorkerCount();

    console.debug(
        `[UPLOADS] Queuing ${totalParts} chunks for ${upload.file.name} (part size: ${upload.provider.part_size}, workers: ${workerCount})`,
    );

    // Track pending hash operations for parallel execution
    const pending: Set<Promise<void>> = new Set();

    /** Hash a single part and queue it for upload */
    const hashAndQueue = async (part: number): Promise<void> => {
        const cacheKey = `${upload.id}:${part}`;
        if (!_hash_cache.has(cacheKey)) {
            console.debug(
                `[UPLOADS] Computing hash for part ${part}/${totalParts}...`,
            );
            const chunk = getChunk(
                upload.file,
                part,
                upload.provider.part_size,
            );
            const hash = await md5Hash(chunk);
            _hash_cache.set(cacheKey, hash);
            console.debug(`[UPLOADS] Part ${part}/${totalParts} hash cached`);
        }

        // Queue this chunk immediately after hash is computed
        const start = (part - 1) * upload.provider.part_size;
        const end = Math.min(
            start + upload.provider.part_size,
            upload.file.size,
        );

        _chunk_queue.push({
            upload_id: upload.id,
            part,
            start,
            end,
            retries: 0,
        });

        // Start processing if we have capacity
        processNextChunk();
    };

    // Hash and queue chunks in parallel up to worker count
    for (let part = startPart; part <= totalParts; part++) {
        // Skip already completed parts
        if (state.completed.includes(part)) continue;

        // Check if paused or removed
        if (_paused_uploads.has(upload.id) || !getUpload(upload.id)) {
            console.debug(
                `[UPLOADS] Chunk queuing cancelled for ${upload.file.name}`,
            );
            await Promise.all(pending);
            return;
        }

        // Start hashing this part - promise removes itself when done
        const promise = hashAndQueue(part).finally(() => {
            pending.delete(promise);
        });
        pending.add(promise);

        // If at capacity, wait for one to complete before starting next
        if (pending.size >= workerCount) {
            await Promise.race(pending);
        }
    }

    // Wait for remaining hashes to complete
    await Promise.all(pending);

    console.debug(`[UPLOADS] All chunks queued for ${upload.file.name}`);
}

/** Add an upload to the manager and optionally start uploading */
export function addUpload(upload: Upload, completedParts: number[] = []) {
    console.debug(
        `[UPLOADS] Adding upload to manager (${upload.file.name})...`,
    );
    _upload_list.push(upload);
    _paused_uploads.delete(upload.id);

    // Handle direct uploads differently
    if (upload.is_direct) {
        console.debug(`[UPLOADS] Upload is direct (${upload.file.name})`);
        updateState(upload, {
            status: _config.auto_start ? 'UPLOADING' : 'PAUSED',
            completed: [],
            pending_complete: [],
            working: [],
            progress: 0,
        });

        if (!_config.auto_start) {
            return;
        }

        // Check if we're at the simultaneous upload limit
        if (!acquireUploadSlot(upload)) {
            _pending_uploads.push(upload);
            updateState(upload, { status: 'PAUSED' });
            return;
        }

        void processDirectUpload(upload);
        return;
    }
    console.debug(`[UPLOADS] Upload is chunked (${upload.file.name})`);

    // Handle chunked uploads
    const totalParts = getTotalParts(upload.file, upload.provider.part_size);
    const sortedCompleted = [...completedParts].sort((a, b) => a - b);
    const progress = Math.round((sortedCompleted.length / totalParts) * 100);

    // Initialize state with any previously completed parts
    updateState(upload, {
        status: _config.auto_start ? 'UPLOADING' : 'PAUSED',
        completed: sortedCompleted,
        pending_complete: [],
        working: [],
        progress,
    });

    // If auto_start is disabled, don't start uploading
    if (!_config.auto_start) {
        return;
    }
    console.debug(`[UPLOADS] Staring upload (${upload.file.name})...`);

    // Check if we're at the simultaneous upload limit
    if (!acquireUploadSlot(upload)) {
        // Queue this upload for later
        _pending_uploads.push(upload);
        updateState(upload, { status: 'PAUSED' });
        return;
    }

    console.debug(
        `[UPLOADS] Queuing chunks to upload (${upload.file.name})...`,
    );

    startUploadWork(upload);
}

/** Get an upload by ID */
export function getUpload(id: string): Upload | undefined {
    return _upload_list.find((upload) => upload.id === id);
}

/** Clear all uploads */
export function clearUploads() {
    // Clear any pending removal timers
    _removal_timers.forEach((timer) => clearTimeout(timer));
    _removal_timers.clear();

    // Clear hash cache
    _hash_cache.clear();

    _upload_list = [];
    _chunk_queue = [];
    _pending_uploads = [];
    _paused_uploads.clear();
    _active_chunks = 0;
    _active_upload_ids.clear();
}

/** Pause an upload */
export function pauseUpload(id: string) {
    const upload = getUpload(id);
    if (!upload) return;

    _paused_uploads.add(id);

    // Remove pending chunks for this upload from queue
    _chunk_queue = _chunk_queue.filter((task) => task.upload_id !== id);

    updateState(upload, { status: 'PAUSED' });
    // Free the slot while paused so other queued uploads can run; resuming
    // claims a slot again.
    releaseUploadSlot(id);
}

/** Resume a paused upload */
export function resumeUpload(id: string) {
    const upload = getUpload(id);
    if (!upload) return;

    // Already running, so there is nothing to restart and taking a second slot
    // would leak one.
    if (upload.state.getValue().status === 'UPLOADING') return;

    _paused_uploads.delete(id);

    // Check if we're at the simultaneous upload limit
    if (!acquireUploadSlot(upload)) {
        if (!_pending_uploads.some((pending) => pending.id === id)) {
            _pending_uploads.push(upload);
        }
        updateState(upload, { status: 'PAUSED' });
        return;
    }

    updateState(upload, { status: 'UPLOADING', error: undefined });
    startUploadWork(upload);
}

/** Get all uploads */
export function listUploads(): Upload[] {
    return [..._upload_list];
}

/** Remove an upload by ID */
export function removeUpload(id: string) {
    // Clear any pending removal timer
    const timer = _removal_timers.get(id);
    if (timer) {
        clearTimeout(timer);
        _removal_timers.delete(id);
    }

    // Clear hash cache for this upload
    clearHashCache(id);

    _paused_uploads.add(id); // Prevent further chunk processing
    _chunk_queue = _chunk_queue.filter((task) => task.upload_id !== id);
    _pending_uploads = _pending_uploads.filter((upload) => upload.id !== id);
    _upload_list = _upload_list.filter((upload) => upload.id !== id);
    _paused_uploads.delete(id);
    // Hand the slot back, otherwise removing an in-flight upload strands it
    releaseUploadSlot(id);
}
