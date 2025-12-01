import { ParallelHasher } from 'ts-md5';

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

let _token: string;
let _api_key: string;

/** Set the authentication token for API requests */
export function setToken(token: string) {
    console.debug('[UPLOADS] Set a token');
    _token = token;
}

/** Set the API key for API requests */
export function setAppKey(key: string) {
    console.debug('[UPLOADS] Set an API key');
    _token = 'API_KEY';
    _api_key = key;
}

function authHeader(): Record<string, string> {
    return _token === 'API_KEY'
        ? { 'x-api-key': _api_key }
        : { Authorization: `Bearer ${_token}` };
}

function headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...authHeader() };
}

/** Get the provider for an upload based on file details */
export async function getProvider(details: UploadDetails): Promise<Provider> {
    const query = toQueryString(details);
    const result = await fetch(`${API_ENDPOINT}/new?${query}`, {
        headers: { ...headers() },
    });
    const data: { residence: string } = await result.json();
    return providerByName(data.residence);
}

/** Create a new upload */
export async function createNewUpload(
    details: UploadDetails,
    file: File,
): Promise<Upload> {
    console.debug(`[UPLOADS] Creating upload for ${file.name}...`);
    const result = await fetch(`${API_ENDPOINT}`, {
        method: 'POST',
        body: JSON.stringify(details),
        headers: { ...headers() },
    });
    const data: UploadResponse = await result.json();
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
        const init_result = await fetch(data.signature.url, {
            method: data.signature.verb,
            headers: data.signature.headers,
        });
        const provider_data = await init_result.text();
        resume_id = provider.resume_id(provider_data);
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
    const result = await fetch(
        `${API_ENDPOINT}/${upload_id}?part=${part_id}&file_id=${encodeURIComponent(part_hash)}`,
        {
            method: 'PATCH',
            body: JSON.stringify({ resumable_id }),
            headers: { ...headers() },
        },
    );
    const data: UploadResponse = await result.json();
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
    const result = await fetch(
        `${API_ENDPOINT}/${upload_id}?part=${next_part_id}&file_id=${encodeURIComponent(next_part_hash)}`,
        {
            method: 'PATCH',
            body: JSON.stringify(finished_parts),
            headers: { ...headers() },
        },
    );
    const data: UploadResponse = await result.json();
    return data.signature;
}

/** Finalize all parts and get the commit signature */
export async function finishUpload(
    upload_id: string,
    parts: UploadPartDetails,
): Promise<UploadSignature> {
    console.debug(`[UPLOADS] Finalising upload ${upload_id}...`);
    const result = await fetch(`${API_ENDPOINT}/${upload_id}?`, {
        method: 'PATCH',
        body: JSON.stringify(parts),
        headers: { ...headers() },
    });
    const data: UploadResponse = await result.json();
    return { ...data.signature, body: data.body };
}

/** Commit the upload in PlaceOS */
export async function commitUpload(upload_id: string): Promise<void> {
    console.debug(`[UPLOADS] Commiting upload ${upload_id}...`);
    await fetch(`${API_ENDPOINT}/${upload_id}`, {
        method: 'PUT',
        headers: { ...headers() },
    });
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
