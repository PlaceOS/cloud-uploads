
import { ParallelHasher } from 'ts-md5/dist/parallel_hasher';

/* istanbul ignore file */

let WORKERS: ParallelHasher[] = [];
const WORKER_COUNT = 3;
let _index = -1;

// This allows the href of the MD5 worker to be configurable
export const MD5_WORKER_URL: string = '/node_modules/ts-md5/dist/md5_worker.js';

/** Initialise hash workers */
export function setupHashWorkers(url: string = MD5_WORKER_URL, options?: WorkerOptions) {
    if (WORKERS?.length > 0) WORKERS.forEach(_ => _.terminate());
    WORKERS = [];
    for (let i = 0; i < WORKER_COUNT; i += 1) {
        WORKERS.push(new ParallelHasher(url, options));
    }
}

/** Get the next hash worker */
export function nextHashWorker() {
    _index += 1;
    _index = _index % WORKER_COUNT;
    return WORKERS[_index];
}

