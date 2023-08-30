import { toQueryString } from './helpers';
import { ExtendedProviderResponse, ProviderResponse } from './types';
import { Upload } from './upload';

export let _api_endpoint = '';

let _token = '';
let _api_key = '';

export interface SignedRequestOptions {
    file_id?: string;
    mime_type?: string;
    parameters?: Record<string, any>;
    permissions?: string;
    public?: boolean;
    expires?: number;
}

export interface SignedReponse {
    type: 'direct_upload' | 'chunked_upload' | 'parts' | 'status';
    upload_id: string;
    residence: string;
    part_list?: number[];
    part_data?: any;
    data?: any;
    signature?: {
        url: string;
        verb: string;
        headers: Record<string, string>;
    };
}

export class SignedRequest {
    public upload_id: string;
    private _params: Record<string, any> = {};
    private _abort_ctrl = new AbortController();
    private _dispose?: () => void;

    constructor(private _upload: Upload, private _endpoint: string) {
        this._abort_ctrl.signal.addEventListener('abort', () =>
            this._dispose ? this._dispose() : ''
        );
    }

    public static setToken(token: string) {
        _token = token;
    }

    public static setApiKey(key: string) {
        _api_key = key;
    }

    public get encoded_id() {
        return encodeURIComponent(`${this.upload_id || ''}`);
    }

    public async initialise(): Promise<ProviderResponse> {
        const { signal } = this._abort_ctrl;
        const { file, mime_type } = this._upload;
        this._params.file_size = `${file.size}`;
        this._params.file_name = file.name;
        if (mime_type && mime_type !== 'binary/octet-stream')
            this._params.file_mime = mime_type;
        this._params = { ...this._params, ...this._upload.params };
        if ((file as any).dir_path?.length > 0) {
            this._params.file_path = (file as any).dir_path;
        }
        const headers = this.base_request_headers;
        const query = toQueryString(this._params);
        const resp = await fetch(
            `${this._endpoint}/new${query ? '?' + query : ''}`,
            {
                headers,
                signal,
            }
        );
        return resp.json();
    }

    public async create(options: SignedRequestOptions): Promise<SignedReponse> {
        const { signal } = this._abort_ctrl;
        const headers = this.base_request_headers;
        if (options.file_id) this._params.file_id = options.file_id;
        if (this._upload.mime_type) this._params.file_mime = options.mime_type;
        // TODO:: review this
        if (options.parameters) this._params.parameters = options.parameters;
        if (options.permissions) this._params.permissions = options.permissions;
        if (options.public) this._params.public = options.public;
        if (options.expires) this._params.expires = options.expires || 0;
        const resp = await fetch(`${this._endpoint}`, {
            body: JSON.stringify(this._params),
            method: 'POST',
            headers,
            signal,
        });
        const data = await resp.json();
        this.upload_id = data.upload_id;
        return data;
    }

    public async sign(
        part_number: number | string,
        part_id: string = ''
    ): Promise<SignedReponse> {
        if (!this.upload_id) throw new Error('Upload resource not initialised');
        const { signal } = this._abort_ctrl;
        const headers = this.base_request_headers;
        const search = new URLSearchParams();
        search.set('part', part_number.toString());
        if (part_id) search.set('file_id', encodeURIComponent(part_id));
        const resp = await fetch(
            `${this._endpoint}/${this.encoded_id}/edit?${search.toString()}`,
            {
                method: 'GET',
                headers,
                signal,
            }
        );
        return await resp.json();
    }

    public async update(params: Record<string, any> = {}) {
        if (!this.upload_id) throw new Error('Upload resource not initialised');
        const { signal } = this._abort_ctrl;
        const headers = this.base_request_headers;
        const resp = await fetch(`${this._endpoint}/${this.encoded_id}`, {
            body: JSON.stringify(params),
            method: 'PUT',
            headers,
            signal,
        });
        return await resp.json();
    }

    public async signedRequest(req: SignedReponse) {
        const resp = await fetch(req.signature.url, {
            body: req.data,
            method: req.signature.verb,
            headers: req.signature.headers,
        });
        const data: any = { body: await resp.text(), responseXML: null };
        try {
            data.responseXML = new window.DOMParser().parseFromString(
                data.body,
                'text/xml'
            );
        } catch (e) {}
        return data;
    }

    public async signNextChunk(
        num: number,
        id: string,
        parts: number[],
        data: any = null
    ) {
        if (!this.upload_id) throw new Error('Upload resource not initialised');
        const { signal } = this._abort_ctrl;
        const body: Record<string, any> = { part_list: parts };
        if (data) body.part_data = data;
        const headers = this.base_request_headers;
        const query = toQueryString({
            part: `${num}`,
            file_id: id,
            file_mime: this._upload.mime_type,
        });
        const resp = await fetch(
            `${this._endpoint}/${this.encoded_id}${query ? '?' + query : ''}`,
            {
                body: JSON.stringify(body),
                method: 'PUT',
                headers,
                signal,
            }
        );
        return await resp.json();
    }

    public async signChunk(num: number, id: string = null) {
        const { signal } = this._abort_ctrl;
        const headers = this.base_request_headers;
        const query = toQueryString({
            part: `${num}`,
            file_id: id,
        });
        const resp = await fetch(
            `${this._endpoint}/edit${query ? '?' + query : ''}`,
            {
                headers,
                signal,
            }
        );
        return await resp.json();
    }

    public async updateStatus(params: Record<string, any> = {}) {
        if (!this.upload_id) throw new Error('Upload resource not initialised');
        const { signal } = this._abort_ctrl;
        const headers = this.base_request_headers;
        const resp = await fetch(`${this._endpoint}/${this.encoded_id}`, {
            headers,
            method: 'PUT',
            body: JSON.stringify(params),
            signal,
        });
        return await resp.json();
    }

    public abort() {
        this._abort_ctrl.abort();
    }

    private get base_request_headers() {
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        headers.append('Content-Type', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
        return headers;
    }

    public destroy() {
        this.abort();
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
        if (this.upload_id) {
            return fetch(`${this._endpoint}/${this.encoded_id}`, {
                headers,
                method: 'DELETE',
            });
        }
    }

    public performSignedRequest(
        options: ExtendedProviderResponse,
        on_progress: (e) => void = () => {}
    ) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            // For whatever reason, this event has to bound before
            // the upload starts or it does not fire (at least on Chrome)
            xhr.upload.addEventListener('progress', (evt: ProgressEvent) =>
                on_progress(evt)
            );
            xhr.addEventListener('load', (evt: ProgressEvent) => {
                on_progress(evt);
                // We are looking for a success response unless there is an expected response
                if (
                    (xhr.status >= 200 && xhr.status < 300) ||
                    xhr.status === options.expected
                ) {
                    resolve(xhr);
                } else reject(`${xhr.status}: ${xhr.statusText}`);
            });

            const on_error = (err) => {
                this._upload.onError(err);
                reject(err);
            };

            xhr.addEventListener('error', () =>
                on_error(`${xhr.status}: ${xhr.statusText || 'unknown error'}`)
            );
            xhr.addEventListener('abort', () =>
                on_error(xhr.statusText || 'browser aborted')
            );
            xhr.open(
                options.signature.verb,
                options.signature.url,
                true // async
            );

            // Set the headers
            const headers = options.signature.headers;
            for (const i in headers) {
                if (i in headers) {
                    xhr.setRequestHeader(i, headers[i]);
                }
            }

            // Allow the request to be cancelled (quack!)
            this._dispose = () => {
                xhr.abort();
                reject('user aborted');
            };
            xhr.send(options.data || null);
        });
    }
}
