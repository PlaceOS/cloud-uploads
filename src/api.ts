import { first } from 'rxjs/operators';
import { CloudProvider } from './cloud-provider';
import { setupHashWorkers } from './hash-workers';
import { registerUploadProvider } from './providers.fn';
import { getApiEndpoint, setApiEndpoint } from './settings.fn';
import { Type } from './types';
import { Upload } from './upload';

export interface UploadServiceOptions {
    auto_start: boolean;
    auto_remove: boolean;
    remove_after: number;
    simultaneous: number;
    parallel: number;
    retries: number;
    providers: Type<CloudProvider>[];
    metadata?: any;
    token?: string;
    endpoint?: string;
    worker_url?: string;
    worker_options?: WorkerOptions;
}

const DEFAULT_OPTIONS: UploadServiceOptions = {
    auto_start: true,
    auto_remove: false,
    remove_after: 0,
    simultaneous: 2,
    parallel: 3,
    retries: 4,
    providers: [],
};

let _options: UploadServiceOptions = DEFAULT_OPTIONS;
let _uploads: Upload[] = [];
/** Initialise the upload service library */
export function initialiseUploadService(
    options: Partial<UploadServiceOptions> = {}
) {
    _options = { ...DEFAULT_OPTIONS, ...options };
    if (_options.endpoint) setApiEndpoint(_options.endpoint);
    setupHashWorkers(_options.worker_url, _options.worker_options);
    addProviders(_options.providers);
}
/** Register a list of cloud upload providers to the system */
export function addProviders(providers: Type<CloudProvider>[]) {
    providers.forEach((_: any) => registerUploadProvider(_.lookup, _));
}
/** Upload a list of files */
export function uploadFiles(
    files: File[],
    params: Record<string, string> = {}
): Upload[] {
    if (!getApiEndpoint()) {
        throw 'No API endpoint set';
    }
    const uploads: Upload[] = [];
    files.forEach((file) => {
        const upload: Upload = new Upload(
            file as any,
            this.retries,
            this.parallel,
            params
        );
        uploads.push(upload);
        _uploads.push(upload);
        // Apply metadata
        upload.metadata = this.metadata;
        upload.status
            .pipe(first(({ status }) => status === 'complete'))
            .subscribe((_) => _onUploadComplete(upload));
        // Only autostart if we under our simultaneous limit
        if (_options.auto_start && _checkAutostart())
            upload.resume(this.parallel);
    });
    return uploads;
}

/** List of the uploads */
export function listUploads() {
    return [..._uploads];
}

/** Pause all active uploads */
export function pauseAllUploads() {
    _uploads.forEach((_) => _.pause());
}
/** Resume an upload */
export function resumeUpload(upload: Upload) {
    upload.resume(_options.parallel);
}
/** Resume all available uploads */
export function resumeAllUploads() {
    _uploads.forEach((_) => _.resume(_options.parallel));
}
/** Update the metadata set for all uploads */
export function updateUploadMetadata(metadata: any) {
    _options.metadata = metadata;
    _uploads.forEach((_) => (_.metadata = metadata));
}
/** Remove an upload from the list */
export function removeUpload(upload: Upload) {
    upload.cancel();
    _uploads = _uploads.filter((_) => _ !== upload);
}
/** Remove all uploads from the list */
export function removeAllUploads() {
    _uploads.forEach((_) => _.cancel());
    _uploads = [];
}
/** Remove completed uploads from the list */
export function removeCompletedUploads() {
    _uploads = _uploads.filter((_) => !_.completed);
}

function _checkAutostart() {
    const active_uploads = _uploads.filter((_) => _.in_progress);
    return active_uploads.length < _options.simultaneous;
}

function _onUploadComplete(upload: Upload) {
    const { auto_start, auto_remove, remove_after } = _options;
    if (auto_remove) {
        if (!remove_after) removeUpload(upload);
        else setTimeout(() => removeUpload(upload), remove_after);
    }
    const waiting_uploads = _uploads.filter((_) => _.waiting);
    if (auto_start && waiting_uploads.length && _checkAutostart()) {
        waiting_uploads[0].resume(_options.parallel);
    }
}
