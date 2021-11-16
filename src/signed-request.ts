import { toQueryString } from './helpers';
import { ExtendedProviderResponse, ProviderResponse } from './types';
import { Upload } from './upload';

export let _api_endpoint = '';

let _token = '';
let _api_key = '';

export class SignedRequest {
    private _upload_id: string;
    private _params: Record<string, string> = {};
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

    public async initialiseSignedRequest(): Promise<ProviderResponse> {
        const { signal } = this._abort_ctrl;
        const { file } = this._upload;
        this._params.file_size = `${file.size}`;
        this._params.file_name = file.name;
        this._params = { ...this._params, ...this._upload.params };
        if ((file as any).dir_path?.length > 0) {
            this._params.file_path = (file as any).dir_path;
        }
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        headers.append('Content-Type', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
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

    public async signUpload(options: Record<string, string>) {
        const { signal } = this._abort_ctrl;
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        headers.append('Content-Type', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
        if (options.file_id) this._params.file_id = options.file_id;
        if (this._upload.mime_type) this._params.file_mime = options.mime_type;
        // TODO:: review this
        if (options.parameters) this._params.parameters = options.parameters;
        const resp = await fetch(this._endpoint, {
            body: JSON.stringify(this._params),
            method: 'POST',
            headers,
            signal,
        });
        const data = await resp.json();
        this._upload_id = data.upload_id;
        return data;
    }

    public async signNextChunk(
        num: number,
        id: string,
        parts: number[],
        data: any = null
    ) {
        const { signal } = this._abort_ctrl;
        const headers = new Headers();
        const body: Record<string, any> = { part_list: parts };
        if (data) body.part_data = data;
        const query = toQueryString({
            part: `${num}`,
            file_id: id,
            file_mime: this._upload.mime_type,
        });
        const resp = await fetch(
            `${this._endpoint}${query ? '?' + query : ''}`,
            {
                body: JSON.stringify(body),
                method: 'PUT',
                headers,
                signal,
            }
        );
        return resp.json();
    }

    public async signChunk(num: number, id: string = null) {
        const { signal } = this._abort_ctrl;
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
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
        return resp.json();
    }

    public async updateStatus(params: Record<string, any> = {}) {
        const { signal } = this._abort_ctrl;
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        headers.append('Content-Type', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
        const resp = await fetch(
            `${this._endpoint}/${encodeURIComponent(this._upload_id)}`,
            { headers, method: 'PUT', body: JSON.stringify(params), signal }
        );
        return resp.text();
    }

    public abort() {
        this._abort_ctrl.abort();
    }

    public destroy() {
        this.abort();
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        if (_token) headers.append('Authorization', `Bearer ${_token}`);
        else if (_api_key) headers.append('X-API-Key', `${_api_key}`);
        if (this._upload_id) {
            return fetch(
                `${this._endpoint}/${encodeURIComponent(this._upload_id)}`,
                { headers, method: 'DELETE' }
            );
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
            xhr.upload.addEventListener('progress', (evt: ProgressEvent) => on_progress(evt));
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
                if (
                    i in headers &&
                    (i.toLowerCase() !== 'content-type' ||
                        !this._upload.mime_type)
                ) {
                    xhr.setRequestHeader(i, headers[i]);
                }
            }
            if (this._upload.mime_type) {
                xhr.setRequestHeader('Content-Type', this._upload.mime_type);
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
