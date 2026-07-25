import { Md5, ParallelHasher } from 'ts-md5';

import { toQueryString } from '../helpers';
import { Provider, providerByName } from './providers';
import {
    UploadDetails,
    UploadPartDetails,
    UploadResponse,
    UploadSignature,
} from './types';
import { createUpload, Upload } from './upload';

const API_ENDPOINT = `/api/engine/v2/uploads`;

/** Backoff between retries of a failed PlaceOS API call, in milliseconds */
const RETRY_DELAYS = [300, 900, 2700];

type Credential = string | (() => string);

let _token: Credential = '';
let _api_key: Credential = '';
let _use_api_key = false;
let _retries = RETRY_DELAYS.length;

/** Failure of a PlaceOS uploads API call */
export class UploadError extends Error {
    constructor(
        message: string,
        /** HTTP status of the failed response, `0` for transport failures */
        public readonly status: number = 0,
        /** Response body, when one could be read */
        public readonly body: string = '',
    ) {
        super(message);
        this.name = 'UploadError';
    }

    /** Whether the failure is transient enough to be worth another attempt */
    get retryable(): boolean {
        // A transport failure never reached the server, and a 401 may clear
        // once the host application refreshes the credential.
        if (this.status === 0 || this.status === 401) return true;
        if (this.status === 408 || this.status === 429) return true;
        return this.status >= 500;
    }
}

/** Set the authentication token for API requests */
export function setToken(token: Credential) {
    console.debug('[UPLOADS] Set a token');
    _token = token;
    _use_api_key = false;
}

/** Set the API key for API requests */
export function setAppKey(key: Credential) {
    console.debug('[UPLOADS] Set an API key');
    _api_key = key;
    _use_api_key = true;
}

/** Set how many times a failed API call is retried before giving up */
export function setApiRetries(retries: number) {
    _retries = Math.max(0, retries);
}

function resolveCredential(credential: Credential): string {
    return typeof credential === 'function' ? credential() : credential;
}

function authHeader(): Record<string, string> {
    return _use_api_key
        ? { 'x-api-key': resolveCredential(_api_key) }
        : { Authorization: `Bearer ${resolveCredential(_token)}` };
}

function headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...authHeader() };
}

function delay(duration: number) {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * Perform a PlaceOS API request, raising an `UploadError` for transport
 * failures and error statuses. Without this the caller cannot tell a committed
 * upload from a rejected one.
 */
async function apiRequest(
    url: string,
    init: RequestInit,
    description: string,
): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown network error';
        throw new UploadError(`${description} failed: ${message}`);
    }
    if (!response.ok) {
        let body = '';
        try {
            body = await response.text();
        } catch {
            // Reading the error body is best effort only
        }
        throw new UploadError(
            `${description} failed with status ${response.status}: ${
                body || response.statusText
            }`,
            response.status,
            body,
        );
    }
    return response;
}

/**
 * Every PlaceOS uploads endpoint is safe to repeat: the signing calls are pure,
 * the commit is idempotent, and create is keyed on the file's content hash.
 */
async function retryRequest<T>(
    operation: () => Promise<T>,
    description: string,
): Promise<T> {
    let last_error: unknown;
    for (let attempt = 0; ; attempt++) {
        try {
            return await operation();
        } catch (error) {
            last_error = error;
            const retryable =
                error instanceof UploadError ? error.retryable : false;
            if (!retryable || attempt >= _retries) break;
            const wait =
                RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
            console.warn(
                `[UPLOADS] ${description} failed, retrying in ${wait}ms (${
                    attempt + 1
                }/${_retries})...`,
                error,
            );
            await delay(wait);
        }
    }
    throw last_error;
}

async function apiRequestJson<T>(
    url: string,
    init: RequestInit,
    description: string,
): Promise<T> {
    return retryRequest(async () => {
        const response = await apiRequest(url, init, description);
        try {
            return (await response.json()) as T;
        } catch {
            throw new UploadError(
                `${description} returned a malformed response body`,
                response.status,
            );
        }
    }, description);
}

/** Get the provider for an upload based on file details */
export async function getProvider(details: UploadDetails): Promise<Provider> {
    const query = toQueryString(details);
    const data = await apiRequestJson<{ residence: string }>(
        `${API_ENDPOINT}/new?${query}`,
        { headers: { ...headers() } },
        'Upload provider lookup',
    );
    return providerByName(data.residence);
}

/** Create a new upload */
export async function createNewUpload(
    details: UploadDetails,
    file: File,
): Promise<Upload> {
    console.debug(`[UPLOADS] Creating upload for ${file.name}...`);
    const data = await apiRequestJson<UploadResponse>(
        `${API_ENDPOINT}`,
        {
            method: 'POST',
            body: JSON.stringify(details),
            headers: { ...headers() },
        },
        `Creating upload for ${file.name}`,
    );
    const provider = providerByName(data.residence);

    // Handle direct uploads (small files)
    if (data.type === 'direct_upload') {
        console.debug(`[UPLOADS] Direct upload for ${file.name}`);
        return createUpload(
            data.upload_id,
            file,
            provider,
            '',
            true,
            data.signature,
        );
    }
    console.debug(`[UPLOADS] Chunked upload for ${file.name}`);

    // Handle chunked uploads (large files)
    let resume_id = '';
    // Initialise file in blob store if required
    if (data.signature.url) {
        // An unchecked error body here would be parsed into a bogus resume id
        const init_result = await retryRequest(
            () =>
                apiRequest(
                    data.signature.url,
                    {
                        method: data.signature.verb,
                        headers: data.signature.headers,
                    },
                    `Initialising blob storage for ${file.name}`,
                ),
            `Initialising blob storage for ${file.name}`,
        );
        const provider_data = await init_result.text();
        resume_id = provider.resume_id(provider_data);
    } else {
        resume_id = `${Md5.hashStr(`${Date.now()}|${file.name}`)}`;
    }
    console.debug(
        `[UPLOADS] Initialised upload for ${file.name} (${resume_id})`,
    );
    return createUpload(data.upload_id, file, provider, resume_id, false);
}

/** Get signature for the first part of a chunked upload */
export async function preparePart(
    upload_id: string,
    resumable_id: string,
    part_id: number,
    part_hash: string,
): Promise<UploadSignature> {
    console.debug(
        `[UPLOADS] Starting upload ${upload_id}, initialising part ${part_id}...`,
    );
    const data = await apiRequestJson<UploadResponse>(
        `${API_ENDPOINT}/${upload_id}?part=${part_id}&file_id=${encodeURIComponent(part_hash)}`,
        {
            method: 'PATCH',
            body: JSON.stringify({ resumable_id }),
            headers: { ...headers() },
        },
        `Signing part ${part_id} of upload ${upload_id}`,
    );
    return data.signature;
}

/** Notify completion of a part and get signature for the next part */
export async function prepareNextPart(
    upload_id: string,
    next_part_id: number,
    next_part_hash: string,
    finished_parts: UploadPartDetails,
): Promise<UploadSignature> {
    console.debug(
        `[UPLOADS] Finished parts for upload ${upload_id}(${finished_parts.part_list?.join(', ')})`,
    );
    console.debug(`[UPLOADS] Initialising next part ${next_part_id}...`);
    const data = await apiRequestJson<UploadResponse>(
        `${API_ENDPOINT}/${upload_id}?part=${next_part_id}&file_id=${encodeURIComponent(next_part_hash)}`,
        {
            method: 'PATCH',
            body: JSON.stringify(finished_parts),
            headers: { ...headers() },
        },
        `Signing part ${next_part_id} of upload ${upload_id}`,
    );
    return data.signature;
}

/** Finalize all parts and get the commit signature */
export async function finishUpload(
    upload_id: string,
    parts: UploadPartDetails,
): Promise<UploadSignature> {
    console.debug(`[UPLOADS] Finalising upload ${upload_id}...`);
    const data = await apiRequestJson<UploadResponse>(
        `${API_ENDPOINT}/${upload_id}?`,
        {
            method: 'PATCH',
            body: JSON.stringify(parts),
            headers: { ...headers() },
        },
        `Finalising upload ${upload_id}`,
    );
    return { ...data.signature, body: data.body };
}

/** Commit the upload in PlaceOS */
export async function commitUpload(upload_id: string): Promise<void> {
    console.debug(`[UPLOADS] Commiting upload ${upload_id}...`);
    await retryRequest(
        () =>
            apiRequest(
                `${API_ENDPOINT}/${upload_id}`,
                { method: 'PUT', headers: { ...headers() } },
                `Committing upload ${upload_id}`,
            ),
        `Committing upload ${upload_id}`,
    );
}

///////////////////////////////////////////////////////////////
/////////////////////   Hashing Methods   /////////////////////
///////////////////////////////////////////////////////////////

const WORKER_COUNT = 3;
let _workers: ParallelHasher[] = [];
let _index = -1;
let _busy_workers: Set<number> = new Set();
let _worker_waiters: Array<(index: number) => void> = [];

// This allows the href of the MD5 worker to be configurable
export const MD5_WORKER_URL: string = '/node_modules/ts-md5/dist/md5_worker.js';

/** Initialise hash workers */
export function setupHashWorkers(
    url: string = MD5_WORKER_URL,
    options?: WorkerOptions,
) {
    console.debug('[UPLOADS] Setting up hash workers...');
    if (_workers?.length > 0) _workers.forEach((_) => _.terminate());
    _workers = [];
    _busy_workers.clear();
    _worker_waiters = [];
    for (let i = 0; i < WORKER_COUNT; i += 1) {
        _workers.push(new ParallelHasher(url, options));
    }
}

/** Get the next hash worker (simple round-robin, doesn't track availability) */
export function nextHashWorker() {
    _index += 1;
    _index = _index % WORKER_COUNT;
    return _workers[_index];
}

/** Get the number of available hash workers */
export function getHashWorkerCount(): number {
    return _workers.length || WORKER_COUNT;
}

/** Acquire a free hash worker, waiting if all are busy */
export async function acquireHashWorker(): Promise<{
    worker: ParallelHasher;
    index: number;
}> {
    // Find a free worker
    for (let i = 0; i < _workers.length; i++) {
        if (!_busy_workers.has(i)) {
            _busy_workers.add(i);
            return { worker: _workers[i], index: i };
        }
    }

    // All workers busy, wait for one to become free
    return new Promise((resolve) => {
        _worker_waiters.push((index: number) => {
            _busy_workers.add(index);
            resolve({ worker: _workers[index], index });
        });
    });
}

/** Release a hash worker back to the pool */
export function releaseHashWorker(index: number): void {
    _busy_workers.delete(index);

    // If anyone is waiting for a worker, give them this one
    if (_worker_waiters.length > 0) {
        const waiter = _worker_waiters.shift()!;
        waiter(index);
    }
}

///////////////////////////////////////////////////////////////
//////////////////////   Helper Methods   /////////////////////
///////////////////////////////////////////////////////////////

export function hexToBinary(input: string) {
    let result = '';
    if (input.length % 2 > 0) input = '0' + input;
    for (let i = 0, length = input.length; i < length; i += 2) {
        result += String.fromCharCode(parseInt(input.slice(i, i + 2), 16));
    }
    return result;
}
