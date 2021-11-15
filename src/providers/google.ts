import { CloudProvider, State } from 'src/cloud-provider';
import { nextHashWorker } from 'src/hash-workers';
import { hexToBinary } from 'src/helpers';

/* istanbul ignore file */

export class Google extends CloudProvider {
    public static lookup: string = 'GoogleCloudStorage';

    protected _start() {
        if (this._strategy === undefined || this.state === State.Paused) {
            this.state = State.Uploading;
            // Prevents this function being called twice
            this._strategy = null;
            this._processPart(this._file).then((result) => {
                if (this.state !== State.Uploading) {
                    // upload was paused or aborted as we were reading the file
                    return;
                }
                this._request
                    .signUpload({ file_id: result.md5 })
                    .then((response) => {
                        this._strategy = response.type;
                        if (response.type === 'direct_upload') {
                            this._direct(response, result);
                        } else {
                            this._resume(response, result);
                        }
                    }, this._onError.bind(this));
            }, this._onError.bind(this));
        }
    }

    // Calculates the MD5 of the part of the file we are uploading
    private _processPart(chunk: Blob, part: number = 0) {
        return this._hashPart(
            part.toString(),
            () => chunk,
            (data) => {
                // We hash in here as not all cloud providers may use MD5
                const hasher = nextHashWorker();
                // Hash the part and return the result
                return hasher.hash(data).then((md5: string) => ({
                    md5: window.btoa(hexToBinary(md5)),
                    part,
                }));
            }
        );
    }

    private _resume(request, firstChunk) {
        this._request.signUpload(request).then((xhr) => {
            if (request.type === 'status') {
                if (xhr.status === request.expected) {
                    // We need to resume the upload
                    const rangeStart: number =
                        parseInt(
                            xhr.getResponseHeader('Range').split('-')[1],
                            10
                        ) + 1;
                    this._processPart(
                        this._file.slice(rangeStart),
                        rangeStart
                    ).then((partInfo) => {
                        if (this.state !== State.Uploading) {
                            // upload was paused or aborted as we were reading the file
                            return;
                        }
                        this._request
                            .signChunk(rangeStart, partInfo.md5)
                            .then((data) => {
                                this._performUpload(data, partInfo);
                            }, this._onError.bind(this));
                    }, this._onError.bind(this));
                } else {
                    // The upload is complete
                    this._finalise();
                }
            } else {
                // We've created the upload - we need to inform our server
                this._request
                    .updateStatus({
                        // grab the upload_id from the Location header
                        resumable_id: this._getQueryParams(
                            xhr.getResponseHeader('Location').split('?')[1]
                        ).upload_id,
                        file_id: firstChunk.md5,
                        part: 0,
                    })
                    .then(
                        (data) => this._performUpload(data, firstChunk),
                        function (reason) {
                            // We should start from the beginning
                            this._restart();
                            this._onError(reason);
                        }
                    );
            }
        }, this._onError.bind(this));
    }

    private _performUpload(request, partInfo) {
        const monitor = this._makeRequest(partInfo, request);
        monitor.then(() => this._finalise(), this._onError.bind(this));
    }

    private _direct(request, partInfo) {
        const monitor = this._makeRequest(partInfo, request);
        this._direct_upload = true;
        monitor.then(() => {
            this._finalise();
        }, this._onError.bind(this));
    }

    private _getQueryParams(qs) {
        qs = qs.split('+').join(' ');
        const params: any = {};
        let tokens: any;
        const re = /[?&]?([^=]+)=([^&]*)/g;
        // NOTE:: assignment in while loop is deliberate
        while ((tokens = re.exec(qs))) {
            params[decodeURIComponent(tokens[1])] = decodeURIComponent(
                tokens[2]
            );
        }
        return params;
    }
}
