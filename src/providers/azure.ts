import { CloudProvider, State } from 'src/cloud-provider';
import { nextHashWorker } from 'src/hash-workers';
import { hexToBinary } from 'src/helpers';

/* istanbul ignore file */

export class Azure extends CloudProvider {
    public static lookup: string = 'MicrosoftAzure';
    // 2MB part size
    private _partSize: number = 2097152;

    protected _start() {
        if (this._strategy === undefined) {
            this.state = State.Uploading;
            // Prevents this function being called twice
            this._strategy = null;
            // Update part size
            // Not because we have to, no limits as such with openstack
            // This ensures requests don't break any limits on our system
            if (this._partSize * 50000 < this.size) {
                this._partSize = Math.floor(this.size / 50000);
                // 4MB limit on part sizes
                if (this._partSize > 4 * 1024 * 1024) {
                    this._upload.cancel();
                    this._onError('file exceeds maximum size of 195GB');
                    return;
                }
            }

            this._processPart(1).then((result) => {
                if (this.state !== State.Uploading) {
                    // upload was paused or aborted as we were reading the file
                    return;
                }

                this._request
                    .create({ file_id: result.md5 })
                    .then((response) => {
                        this._strategy = response.type;
                        if (response.type === 'direct_upload') {
                            this._direct(response, result);
                        } else {
                            this._resume(response, result);
                        }
                    }, this._onError.bind(this));
            }, this._onError.bind(this));
        } else if (this.state === State.Paused) {
            this._resume();
        }
    }

    // Calculates the MD5 of the part of the file we are uploading
    private _processPart(part: number) {
        return this._hashPart(
            part.toString(),
            () => {
                let data: any;
                let endbyte: number;
                // Calculate the part of the file that requires hashing
                if (this.size > this._partSize) {
                    endbyte = part * this._partSize;
                    if (endbyte > this.size) {
                        endbyte = this.size;
                    }
                    data = this._file.slice(
                        (part - 1) * this._partSize,
                        endbyte
                    );
                } else {
                    data = this._file;
                }
                return data;
            },
            (data) => {
                // We hash in here as not all cloud providers may use MD5
                const hasher = nextHashWorker();
                // Hash the part and return the result
                return hasher.hash(data).then((md5: string) => {
                    return {
                        md5: window.btoa(hexToBinary(md5)),
                        part,
                    };
                });
            }
        );
    }

    private _resume(request = null, firstChunk = null) {
        let i: number;
        if (request) {
            if (request.type === 'parts') {
                // The upload has already started and we want to continue where we left off
                this._pending_parts = request.part_list as number[];

                for (i = 0; i < this._upload.parallel; i += 1) {
                    this._nextPart();
                }
            } else {
                this._request
                    .updateStatus({
                        resumable_id: 'n/a',
                        file_id: firstChunk.md5,
                        part: 1,
                    })
                    .then(
                        (data) => {
                            // We are provided with the first request
                            this._nextPartIndex();
                            this._setPart(data, firstChunk);

                            // Then we want to request any parallel parts
                            for (i = 1; i < this._upload.parallel; i += 1) {
                                this._nextPart();
                            }
                        },
                        function (reason) {
                            // We should start from the beginning
                            this._restart();
                            this._onError(reason);
                        }
                    );
            }
        } else {
            // Client side resume after the upload was paused
            for (i = 0; i < this._upload.parallel; i += 1) {
                this._nextPart();
            }
        }
    }

    private _generatePartManifest() {
        let list: string = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
        for (let i = 0; i < 50000; i += 1) {
            if (i * this._partSize < this.size) {
                list += `<Latest>${window.btoa(this._pad(i + 1))}</Latest>`;
            } else {
                break;
            }
        }
        list += '</BlockList>';
        return list;
    }

    private _pad(num: number) {
        let str: string = num.toString();
        while (str.length < 6) str = '0' + str;
        return str;
    }

    private _nextPart() {
        let partNum = this._nextPartIndex();

        if ((partNum - 1) * this._partSize < this.size) {
            this._processPart(partNum).then((result) => {
                if (this.state !== State.Uploading) {
                    // upload was paused or aborted as we were reading the file
                    return;
                }

                this._request
                    .signNextChunk(partNum, result.md5, this._currentParts())
                    .then((response) => {
                        this._setPart(response, result);
                    }, this._onError.bind(this));
            }, this._onError.bind(this));
        } else {
            if (
                this._currentParts.length === 1 &&
                this._currentParts[0] === partNum
            ) {
                // This is the final commit
                this._finishing = true;
                this._request.sign('finish').then((request) => {
                    request.data = this._generatePartManifest();
                    this._request
                        .signedRequest(request as any)
                        .then(
                            this._finalise.bind(this),
                            this._onError.bind(this)
                        );
                }, this._onError.bind(this));
            } else if (!this._finishing) {
                // Remove part just added to _currentParts
                // We need this logic when performing parallel uploads
                this._completePart(partNum);

                // We should update upload progress
                // NOTE:: no need to subscribe as API does this for us
                // also this is a non-critical request.
                //
                // Also this is only executed towards the end of an upload
                // as no new parts are being requested to update the status
                this._request.updateStatus({
                    part_update: true,
                    part_list: this._currentParts(),
                });
            }
        }
    }

    private _setPart(request, partInfo) {
        const monitor = this._makeRequest(partInfo, request);
        monitor.then(() => {
            this._completePart(partInfo.part);
            this._nextPart();
        }, this._onError.bind(this));
    }

    private _direct(request, partInfo) {
        const monitor = this._makeRequest(partInfo, request);
        this._direct_upload = true;
        monitor.then(() => this._finalise(), this._onError.bind(this));
    }
}
