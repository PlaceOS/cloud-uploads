import { BehaviorSubject } from 'rxjs';
import { CloudProvider } from './cloud-provider';
import { getUploadProvider } from './providers.fn';
import { getApiEndpoint } from './settings.fn';
import { SignedRequest } from './signed-request';

export type UploadStatus =
    | 'complete'
    | 'uploading'
    | 'cancelled'
    | 'error'
    | 'paused'
    | 'waiting';

export interface UploadState {
    status: UploadStatus;
    /** Current progress of the upload */
    progress: number;
    uploaded: number;
    metadata?: any;
    error?: string;
}

export class Upload {
    private _state = new BehaviorSubject<UploadState>({
        status: 'waiting',
        progress: 0,
        uploaded: 0
    });
    private _request?: SignedRequest;
    private _provider?: CloudProvider;
    private _access_url: string = '';
    /** Size of the uploaded file in bytes */
    public readonly size: number;
    /** Observer for the status of the upload */
    public readonly status = this._state.asObservable();

    public mime_type = 'binary/octet-stream';
    public metadata: any;

    constructor(
        public file: any,
        public retries: number,
        public parallel: number,
        public params: Record<string, any> = {},
        private _endpoint: string = getApiEndpoint(),
    ) {}

    /** URL of the uploaded resource */
    public get access_url() {
        return this._access_url;
    } 
    /** Whether resource is waiting to be uploaded */
    public get waiting() {
        return this._state.getValue()?.status === 'waiting';
    }
    /** Whether resource is currently being uploaded */
    public get in_progress() {
        return this._state.getValue()?.status === 'uploading';
    }
    /** Whether resource has been uploaded to the provider */
    public get completed() {
        return this._state.getValue()?.status === 'complete';
    }
    /** @hidden */
    public setAccessUrl(url: string) {
        this._access_url = url;
    }
    /** @hidden */
    public onProgress(bytes_complete: number) {
        const state = this._state.getValue();
        this._state.next({
            ...state,
            status: 'uploading',
            uploaded: bytes_complete,
            progress: Math.floor(bytes_complete / this.file.size * 1000) / 10
        })
    }
    /** @hidden */
    public onComplete() {
        const state = this._state.getValue();
        this._state.next({ ...state, status: 'complete', progress: 100 });
    }
    /** @hidden */
    public onError(error: string) {
        const state = this._state.getValue();
        this._state.next({ ...state, status: 'error', error });
    }
    /** Resume uploading the resource */
    public async resume(parallel?: number) {
        const state = this._state.getValue();
        if (!['complete', 'uploading', 'cancelled'].includes(state.status)) {
            if (parallel) this.parallel = parallel;
            this._request = new SignedRequest(this, this._endpoint);
            const resp = await this._request.initialiseSignedRequest();
            const Provider = getUploadProvider(resp.residence) as any;
            if (Provider) {
                this._provider = new Provider(this._request, this);
                this._state.next({ ...state, status: 'uploading' });
            } else this.onError('No provider available to upload to');
        }
    }
    /** Pause the uploading of the resource */
    public pause() {
        const state = this._state.getValue();
        if (state.status === 'uploading') {
            this._provider?.pause();
            this._state.next({ ...state, status: 'paused' });
        }
    }
    /** Cancel the upload of the resource */
    public cancel() {
        const state = this._state.getValue();
        if (!['complete', 'cancelled'].includes(state.status)) {
            if (state.status === 'uploading') {
                this._provider?.destroy();
            }
            this._state.next({ ...state, status: 'cancelled' });
        }
    }
}
