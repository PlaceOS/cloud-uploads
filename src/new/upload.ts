import { BehaviorSubject } from 'rxjs';

import {
    createNewUpload,
    hexToBinary,
    MD5_WORKER_URL,
    nextHashWorker,
    setAppKey,
    setToken,
    setupHashWorkers,
} from './function';
import {
    addUpload,
    configureUploadManager,
    pauseUpload,
    removeUpload,
    resumeUpload,
} from './manager';
import { Provider } from './providers';
import { UploadConfig, UploadSignature } from './types';

export interface Upload {
    /** ID of the upload */
    readonly id: string;
    /** Provider ID of the upload */
    readonly resume_id: string;
    /** File that is to be uploaded */
    readonly file: File;
    /** Upload State of a file */
    readonly state: BehaviorSubject<UploadState>;
    /** Provider that the file will be uploaded to */
    readonly provider: Provider;
    /** Whether this is a direct (non-chunked) upload */
    readonly is_direct: boolean;
    /** Signature for direct uploads */
    readonly direct_signature?: UploadSignature;
    /** Pause the upload */
    readonly pause: () => void;
    /** Resume the upload */
    readonly resume: () => void;
    /** Remove the upload */
    readonly remove: () => void;
}

export interface UploadState {
    status: 'PAUSED' | 'UPLOADING' | 'FAILED' | 'COMPLETED';
    completed: number[];
    pending_complete: number[];
    working: number[];
    progress: number;
}

export interface UploadOptions {
    /** User permissions required to access the uploaded file */
    permissions?: string;
    /** Whether direct URL of the uploading file is publicly accessible */
    public?: boolean;
}

/** Initialize the upload system */
export function initUploads(options: UploadConfig = {}) {
    const {
        token,
        api_key,
        worker_url = MD5_WORKER_URL,
        worker_options,
        simultaneous = 2,
        parallel = 3,
        retries = 3,
        auto_start = true,
        auto_remove = false,
        remove_after_ms = -1,
    } = options;
    console.debug('[UPLOADS] Initialising...');

    // Set authentication
    if (api_key) {
        setAppKey(api_key);
    } else if (token) {
        setToken(token);
    }

    // Configure manager settings
    configureUploadManager({
        simultaneous,
        parallel,
        retries,
        auto_start,
        auto_remove,
        remove_after_ms,
    });

    // Initialize hash workers
    setupHashWorkers(worker_url, worker_options);
}

export function createUpload(
    id: string,
    file: File,
    provider: Provider,
    resume_id: string,
    is_direct: boolean = false,
    direct_signature?: UploadSignature,
): Upload {
    return {
        id,
        resume_id,
        file,
        provider,
        is_direct,
        direct_signature,
        state: new BehaviorSubject<UploadState>({
            status: 'PAUSED',
            completed: [],
            pending_complete: [],
            working: [],
            progress: 0,
        }),
        pause: () => pauseUpload(id),
        resume: () => resumeUpload(id),
        remove: () => removeUpload(id),
    };
}

/** Upload a file to the cloud storage */
export async function uploadFile(
    file: File,
    options: UploadOptions = {},
): Promise<Upload> {
    const { permissions = 'none', public: isPublic = false } = options;

    // Calculate MD5 hash of the file
    const hasher = nextHashWorker();
    if (!hasher) throw new Error('No hash worker available');
    const fileHash = (await hasher.hash(file.slice())) as string;
    // Remove any non-hex characters (spaces, etc.) before converting
    const cleanFileHash = fileHash.replace(/[^0-9a-fA-F]/g, '');

    // Create upload record in PlaceOS
    const upload = await createNewUpload(
        {
            file_size: file.size,
            file_name: file.name,
            file_mime: file.type,
            file_id: window.btoa(hexToBinary(cleanFileHash)),
            permissions,
            public: isPublic,
        },
        file,
    );

    // Add to manager and start uploading
    addUpload(upload);

    return upload;
}

/** Resume a partially uploaded file */
export async function resumeUploadFile(
    file: File,
    uploadId: string,
    resumeId: string,
    provider: Provider,
    completedParts: number[],
): Promise<Upload> {
    // Create upload object with existing IDs
    const upload = createUpload(uploadId, file, provider, resumeId);

    // Add to manager with completed parts and start uploading remaining
    addUpload(upload, completedParts);

    return upload;
}
