import { CloudProvider, State } from "src/cloud-provider";
import { nextHashWorker } from "src/hash-workers";
import { hexToBinary } from "src/helpers";

/* istanbul ignore file */

export class Amazon extends CloudProvider {
    public static lookup: string = 'AmazonS3';

    // 5MiB part size
    private _part_size: number = 5242880;

    protected _start() {
        if (this._strategy === undefined) {
            this.state = State.Uploading;

            // Prevents this function being called twice
            this._strategy = null;

            // Update part size if required
            if ((this._part_size * 9999) < this.size) {
                this._part_size = Math.floor(this.size / 9999);

                // 5GB limit on part sizes
                if (this._part_size > (5 * 1024 * 1024 * 1024)) {
                    this._upload.cancel();
                    this._onError('file exceeds maximum size');
                    return;
                }
            }


            this._processPart(1).then((result) => {
                if (this.state !== State.Uploading) {
                    // upload was paused or aborted as we were reading the file
                    return;
                }

                this._request.signUpload({
                    file_id: window.btoa(hexToBinary(result.md5))
                })
                .then((response) => {
                    this._strategy = response.type;
                    if (response.signature) {
                        this._upload.setAccessUrl((response.signature.url || '').split('?')[0]);
                    }
                    if (response.type === 'direct_upload') this._direct(response, result);
                    else this._resume(response, result);
                }, (e) => this._onError(e));
            }, (e) => this._onError(e));
        } else if (this.state === State.Paused) {
            this._resume();
        }
    }


    // Calculates the MD5 of the part of the file we are uploading
    private _processPart(part: number) {
        return this._hashPart(part.toString(), () => {
            let data: any;
            let endbyte: number;

            // Calculate the part of the file that requires hashing
            if (this.size > this._part_size) {
                endbyte = part * this._part_size;
                if (endbyte > this.size) {
                    endbyte = this.size;
                }
                data = this._file.slice((part - 1) * this._part_size, endbyte);
            } else {
                data = this._file;
            }
            return data;
        }, (data) => {
            // We hash in here as not all cloud providers may use MD5
            const hasher = nextHashWorker();
            // Hash the part and return the result
            return hasher.hash(data).then((md5: string) => ({ md5, part }));
        });
    }

    private _resume(request = null, firstChunk = null) {
        let i: number;

        if (request) {
            if (request.type === 'parts') {
                // The upload has already started and we want to continue where we left off
                this._pending_parts = request.part_list as number[];
                if (request.part_data) {
                    this._memoization = request.part_data;
                }

                for (i = 0; i < this._upload.parallel; i += 1) {
                    this._nextPart();
                }
            } else {
                this._request.signUpload(request)
                .then((response) => {
                    // The upload was created on amazon - we need to track the upload id
                    const uploadId = response.responseXML.getElementsByTagName('UploadId')[0].textContent;
                    this._request.updateStatus({
                        resumable_id: uploadId,
                        file_id: window.btoa(hexToBinary(firstChunk.md5)),
                        part: 1,
                    }).then((data) => {
                        // We are provided with the first request
                        this._nextPartIndex();
                        this._setPart(data, firstChunk);

                        // Then we want to request any parallel parts
                        for (i = 1; i < this._upload.parallel; i += 1) {
                            this._nextPart();
                        }
                    }, (reason) => {
                        // We should start from the beginning
                        this._restart();
                        this._onError(reason);
                    });
                }, (reason) => {
                    this._restart();
                    this._onError(reason);
                });
            }
        } else {
            // Client side resume after the upload was paused
            for (i = 0; i < this._upload.parallel; i += 1) {
                this._nextPart();
            }
        }
    }

    private _generatePartManifest() {
        let list: string = '<CompleteMultipartUpload>';
        let i: number;
        let etag: any;

        for (i = 1; i < 10000; i += 1) {
            etag = this._memoization[i];

            if (etag) {
                list += '<Part><PartNumber>' + i + '</PartNumber><ETag>"' + etag.md5 + '"</ETag></Part>';
            } else break;
        }
        list += '</CompleteMultipartUpload>';

        return list;
    }

    private _nextPart() {
        const partNum = this._nextPartIndex();
        let details: any;

        if ((partNum - 1) * this._part_size < this.size) {
            this._processPart(partNum).then((result) => {
                if (this.state !== State.Uploading) {
                    // upload was paused or aborted as we were reading the file
                    return;
                }

                details = this._getPartData();

                this._request.signNextChunk(
                    partNum,
                    window.btoa(hexToBinary(result.md5)),
                    details.part_list,
                    details.part_data,
                ).then((response) => {
                    this._setPart(response, result);
                }, (e) => this._onError(e));
            }, (e) => this._onError(e));
        } else {
            if (this._currentParts.length === 1 && this._currentParts[0] === partNum) {
                // This is the final commit
                this._finishing = true;
                this._request.signChunk('finish' as any).then((request) => {
                    request.data = this._generatePartManifest();

                    this._request.signUpload(request as any)
                        .then(() => this._finalise(), (e) => this._onError(e));
                }, (e) => this._onError(e));
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
                details = this._getPartData();
                details.part_update = true;
                this._request.updateStatus(details);
            }
        }
    }

    private _setPart(request, partInfo) {
        const monitor = this._makeRequest(partInfo, request);
        monitor.then(() => this._nextPart(), (e) => this._onError(e));
    }

    private _direct(request, partInfo) {
        const monitor = this._makeRequest(partInfo, request);
        this._direct_upload = true;
        monitor.then(() => this._finalise(), (e) => this._onError(e));
    }
}