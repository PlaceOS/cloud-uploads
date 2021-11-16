import { Upload } from '../src/upload';
import { take } from 'rxjs/operators';

import * as provider_fn from '../src/providers.fn';
import * as sr from '../src/signed-request';

jest.mock('../src/signed-request.ts');
jest.mock('../src/providers.fn.ts');

class Dummy { start() {} }

describe('Upload', () => {
    let upload: Upload;

    beforeEach(() => upload = new Upload(new Blob(), 4, 3));

    it('should create object', () => {
        expect(upload).toBeInstanceOf(Upload);
    });

    it('should have an access URL', () => {
        expect(upload.access_url).toBe('');
        upload.setAccessUrl('http://locahost/file.jpg');
        expect(upload.access_url).toBe('http://locahost/file.jpg');
    });

    it('should show whether upload is waiting', () => {
        expect(upload.waiting).toBeTruthy();
        upload.onComplete();
        expect(upload.waiting).not.toBeTruthy();
    });

    it('should show whether upload is in progress', () => {
        expect(upload.in_progress).not.toBeTruthy();
        upload.onProgress(100);
        expect(upload.in_progress).toBeTruthy();
    });

    it('should show whether upload is completed', () => {
        expect(upload.completed).not.toBeTruthy();
        upload.onComplete();
        expect(upload.completed).toBeTruthy();
    });

    it('should allow resuming of upload', async () => {
        expect(upload.in_progress).not.toBeTruthy();
        (sr as any).SignedRequest = jest.fn().mockImplementation(() => ({ initialiseSignedRequest: async () => ({}) }));
        (provider_fn as any).getUploadProvider = jest.fn().mockImplementation(() => Dummy);
        await upload.resume(4);
        expect(upload.in_progress).toBeTruthy();
    });

    it('should allow pausing of upload', () => {

    });

    it('should allow cancelling of upload', async () => {
        let status = await upload.status.pipe(take(1)).toPromise();
        expect(status.status).not.toBe('cancelled');
        upload.cancel();
        status = await upload.status.pipe(take(1)).toPromise();
        expect(status.status).toBe('cancelled');
    });
});
