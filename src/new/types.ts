export interface UploadDetails {
    /** Size of the file in bytes */
    file_size: number;
    /** Name of the file */
    file_name: string;
    /** User permissions required to access the uploaded file */
    permissions: string;
    /** Whether direct URL of the uploading file is publicly accessible */
    public: boolean;
    /** MD5 hash of the file used as a checksum */
    file_id: string;
    /** MIME type of the file */
    file_mime?: string;
}

export interface UploadSignature {
    verb: 'PUT' | 'GET' | 'PATCH' | 'POST';
    url: string;
    headers: Record<string, string>;
    body?: string;
}

export interface UploadResponse {
    type:
        | 'direct_upload'
        | 'chunked_upload'
        | 'parts'
        | 'part_upload'
        | 'finish';
    signature: UploadSignature;
    upload_id: string;
    residence: string;
    body?: string;
}

export interface UploadPartDetails {
    part_list?: number[];
    part_data?: UploadPart[];
}

export interface UploadPartResponse extends UploadResponse {
    type: 'part_upload';
}

export interface UploadPart {
    part: number;
    /** Base64-encoded MD5 hash */
    md5: string;
    /** Hex MD5 hash (used by some providers like S3 for ETags) */
    md5_hex?: string;
}

export interface UploadConfig {
    /** Automatically start uploading the file. Defaults to `true` */
    auto_start?: boolean;
    /** Automatically remove upload details after finishing. Defaults to `false` */
    auto_remove?: boolean;
    /** Auto-remove upload details X milliseconds after finish. `-1` to never remove . Defaults to `-1` */
    remove_after_ms?: number;
    /** Number of simultaneous files that can be uploaded at once. Defaults to `2` */
    simultaneous?: number;
    /** Number of chunks to upload in parallel. Defaults to `3` */
    parallel?: number;
    /** Number of times to retry chunk uploads before setting as failed. Defaults to `3` */
    retries?: number;
    /**
     * Authorization token to apply to PlaceOS endpoint calls. Pass a function
     * to have the credential resolved per request, so uploads that outlive the
     * current token pick up a refreshed one instead of failing with a 401.
     */
    token?: string | (() => string);
    /**
     * API key to apply to PlaceOS API endpoint calls. Pass a function to have
     * the credential resolved per request.
     */
    api_key?: string | (() => string);
    /** Custom endpoint to apply to PlaceOS API calls */
    endpoint?: string;
    /** URL or path to the hash worker JS file */
    worker_url?: string;
    /** Configuration options for the hash worker */
    worker_options?: WorkerOptions;
}
