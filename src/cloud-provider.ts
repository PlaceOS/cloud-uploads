import { SignedRequest } from './signed-request';
import { ExtendedProviderResponse } from './types';
import { Upload } from './upload';

export enum State {
    Paused,
    Uploading,
    Completed,
    Aborted,
}

export abstract class CloudProvider {
    public state: State = State.Paused;
    public size: number;
    public progress: number = 0;

    protected _file: any;
    // Strategy is used to indicate progress
    // * undefined == not started
    // * null      == we have made a call to create
    // * string    == upload in progress
    protected _strategy: string;
    protected _finalising: boolean;
    protected _direct_upload: boolean;
    protected _progress: Record<string, { loaded: number; total: number }> = {};
    protected _current_parts: number[] = [];
    protected _pending_parts: number[] = [];
    protected _last_part: number = 0;
    protected _memoization: any = {};
    protected _finishing = false;

    constructor(protected _request: SignedRequest, protected _upload: Upload) {
        this._file = this._upload.file;
        this.size = this._file.size;
    }

    public start() {
        if (this.state < State.Uploading) {
            if (this._finalising) this._finalise();
            else this._start();
        }
    }

    public pause() {
        if (
            this._strategy &&
            this.state === State.Uploading &&
            !this._direct_upload
        ) {
            this.state = State.Paused;
            this._request.abort();
            this._pending_parts = this._currentParts();
            this._current_parts = [];
        } else if (!this._strategy || this._direct_upload) {
            // We don't have a strategy yet
            this.state = State.Paused;
            this._request.abort();
            this._restart();
        }
        for (const key in this._progress) {
            if (this._progress[key].loaded !== this._progress[key].total) {
                this._progress[key].loaded = 0;
            }
        }
        this._updateProgress();
    }

    public destroy() {
        // Check the upload has not finished
        if (this._strategy !== undefined && this.state < State.Completed) {
            this._request.destroy();
            // nullifies strategy
            this._restart();
            this.state = State.Aborted;
        }
    }

    protected abstract _start(): void;

    protected _restart() {
        this._strategy = undefined;
        this._current_parts = [];
        this._pending_parts = [];
    }
    /* istanbul ignore next */
    protected _makeRequest(part_info: any, details: ExtendedProviderResponse) {
        details.data = part_info.data;
        return this._request.performSignedRequest(details, (e) =>
            this._onProgress(part_info.part, e)
        );
    }
    /* istanbul ignore next */
    protected _nextPartIndex() {
        if (this._pending_parts.length > 0) {
            this._last_part = this._pending_parts.shift();
        } else this._last_part += 1;
        this._current_parts.push(this._last_part);

        return this._last_part;
    }
    /* istanbul ignore next */
    protected _currentParts() {
        return this._current_parts.concat(this._pending_parts);
    }
    /* istanbul ignore next */
    protected _completePart(num: number) {
        this._current_parts = this._current_parts.filter((val) => val !== num);
    }
    /* istanbul ignore next */
    protected _isComplete(index: number) {
        const { loaded, total } = this._progress[index] || {};
        return loaded && loaded === total;
    }
    /* istanbul ignore next */
    protected _onProgress(index: number, event: ProgressEvent) {
        this._progress[index] = { ...event };
        this._updateProgress();
    }
    /* istanbul ignore next */
    protected _onError(reason: string) {
        console.error('Error:', reason);
        this.pause();
        this._upload.onError(reason);
    }

    protected _updateProgress() {
        let loaded = 0;
        for (const key in this._progress) {
            loaded += this._progress[key].loaded || 0;
        }
        this._upload.onProgress(loaded);
    }
    /* istanbul ignore next */
    protected async _finalise() {
        this._request.updateStatus().then(
            () => this._upload.onComplete(),
            (_) => this._onError(_)
        );
    }
    /* istanbul ignore next */
    protected async _hashPart(id: string, data_fn, hash_fn) {
        const result = this._memoization[id];
        const data = data_fn();
        return result
            ? {
                  data,
                  md5: result.md5,
                  part: result.part,
              }
            : hash_fn(data).then((hash) => {
                  this._memoization[id] = hash;
                  return {
                      data,
                      md5: hash.md5,
                      part: hash.part,
                  };
              });
    }
    /* istanbul ignore next */
    protected _getPartData() {
        const list = this._currentParts().filter((_) => typeof _ === 'number');
        const data = [];
        list.forEach((num) => {
            const details = this._memoization[`${num}`];
            if (details) data.push(details);
        });
        return {
            part_list: list,
            part_data: data,
        };
    }
}
