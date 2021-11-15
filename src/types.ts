
/** Response from Condo API requests */
export interface ProviderResponse {
    /** Name of the service provider to upload to */
    residence: string;
}

export interface ExtendedProviderResponse extends ProviderResponse {
    /** Type of upload to perform */
    type: string;
    /** Upload request details */
    signature: ProviderUploadSignature;
    /** Reference ID of the upload for Condo API */
    upload_id: string;
    /** Custom response status expected from request */
    expected?: number;
    /** Body to add to upload request */
    data?: any;
}

export interface ProviderUploadSignature {
    /** Upload request HTTP verb */
    verb: HttpVerb;
    /** URL to upload the file to */
    url: string;
    /** Map of headers to add to the upload request */
    headers: Record<string, string>;
}

/** Valid HTTP Verbs. */
export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Type<T> extends Function {
    constructor(...args: any[]): T;
}
