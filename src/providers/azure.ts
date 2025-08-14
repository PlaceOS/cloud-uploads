import { CloudProvider, State } from '../cloud-provider';
import { nextHashWorker } from '../hash-workers';
import { hexToBinary } from '../helpers';
import { SignedResponse } from '../signed-request';

/* istanbul ignore file */

export class Azure extends CloudProvider {
    public static lookup: string = 'AzureStorage';
    // 2MB part size
    private _part_size: number = 2097152;

    protected _start() {
        if (this._strategy === undefined) {
            this.state = State.Uploading;
            // Prevents this function being called twice
            this._strategy = null;
            // Update part size
            // Not because we have to, no limits as such with openstack
            // This ensures requests don't break any limits on our system
            if (this._part_size * 50000 < this.size) {
                this._part_size = Math.floor(this.size / 50000);
                // 4MB limit on part sizes
                if (this._part_size > 4 * 1024 * 1024) {
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
                if (this.size > this._part_size) {
                    endbyte = part * this._part_size;
                    if (endbyte > this.size) {
                        endbyte = this.size;
                    }
                    data = this._file.slice(
                        (part - 1) * this._part_size,
                        endbyte,
                    );
                } else {
                    data = this._file;
                }
                return data;
            },
            (data) => {
                // We hash in here as not all cloud providers may use MD5
                const hasher = nextHashWorker() as any;
                // Hash the part and return the result
                return hasher.hash(data).then((md5: string) => {
                    return {
                        md5: window.btoa(hexToBinary(md5)),
                        part,
                    };
                });
            },
        );
    }

    private async _resume(
        request: SignedResponse | null = null,
        firstChunk: any = null,
    ) {
        let i: number;

        if (request) {
            if (request.type === 'parts') {
                // The upload has already started and we want to continue where we left off
                this._pending_parts = request.part_list!;
                if (request.part_data) {
                    this._memoization = request.part_data;
                }

                for (i = 0; i < this._upload.parallel; i += 1) {
                    this._nextPart();
                }
            } else {
                const response = await this._request
                    .signedRequest(request)
                    .catch((reason) => {
                        this._restart();
                        this._onError(reason);
                    });
                if (!response) return;
                // The upload was created on amazon - we need to track the upload id
                const uploadId =
                    response.responseXML.getElementsByTagName('UploadId')[0]
                        .textContent;
                const data = await this._request
                    .updateStatus({
                        resumable_id: uploadId,
                        file_id: window.btoa(hexToBinary(firstChunk.md5)),
                        part: 1,
                    })
                    .catch((reason) => {
                        // We should start from the beginning
                        this._restart();
                        this._onError(reason);
                    });
                if (!data) return;
                // We are provided with the first request
                // this._nextPartIndex();

                // Then we want to request any parallel parts
                for (i = 1; i < this._upload.parallel; i += 1) {
                    this._nextPart();
                }
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
            if (i * this._part_size < this.size) {
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
        const part_index = this._nextPartIndex();
        let details: any;
        if ((part_index - 1) * this._part_size < this.size) {
            this._processPart(part_index).then(
                (result) => {
                    if (this.state !== State.Uploading) {
                        // upload was paused or aborted as we were reading the file
                        return;
                    }

                    details = this._getPartData();

                    this._request
                        .signNextChunk(
                            part_index,
                            result.md5,
                            details.part_list,
                            details.part_data,
                        )
                        .then(
                            () =>
                                this._request
                                    .signChunk(part_index, result.md5)
                                    .then(
                                        (r) => this._setPart(r, result),
                                        (e) => this._onError(e),
                                    ),
                            (e) => this._onError(e),
                        );
                },
                (e) => this._onError(e),
            );
        } else {
            if (
                this._currentParts().length === 1 &&
                this._currentParts()[0] === part_index
            ) {
                // This is the final commit
                this._finishing = true;
                this._request.sign('finish').then(
                    (request) => {
                        request.data = this._generatePartManifest();
                        this._request.signedRequest(request as any).then(
                            () => this._finalise(),
                            (e) => this._onError(e),
                        );
                    },
                    (e) => this._onError(e),
                );
            } else if (!this._finishing) {
                // Remove part just added to _currentParts
                // We need this logic when performing parallel uploads
                this._completePart(part_index);

                // We should update upload progress
                // NOTE:: no need to subscribe as API does this for us
                // also this is a non-critical request.
                //
                // Also this is only executed towards the end of an upload
                // as no new parts are being requested to update the status
                details = this._getPartData();
                details.part_update = true;
                this._request.updateStatus(details);
            }
        }
    }

    private _setPart(request: any, partInfo: any) {
        const monitor = this._makeRequest(partInfo, request);
        monitor.then(() => {
            this._completePart(partInfo.part);
            this._nextPart();
        }, this._onError.bind(this));
    }

    private _direct(request: any, partInfo: any) {
        const monitor = this._makeRequest(partInfo, request);
        this._direct_upload = true;
        monitor.then(() => this._finalise(), this._onError.bind(this));
    }
}
