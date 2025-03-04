import { lastValueFrom, take } from 'rxjs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Upload } from '../src/upload';

import * as provider_fn from '../src/providers.fn';

vi.mock('../src/signed-request.ts', () => {
    const SignedRequest = vi
        .fn()
        .mockReturnValue({ initialise: vi.fn(() => ({})) });
    return { SignedRequest };
});
vi.mock('../src/providers.fn.ts');

class Dummy {
    start() {}
}

describe('Upload', () => {
    let upload: Upload;

    beforeEach(() => {
        upload = new Upload(new Blob(), 4, 3);
    });

    test('should create object', () => {
        expect(upload).toBeInstanceOf(Upload);
    });

    test('should have an access URL', () => {
        expect(upload.access_url).toBe('');
        upload.setAccessUrl('http://locahost/file.jpg');
        expect(upload.access_url).toBe('http://locahost/file.jpg');
    });

    test('should show whether upload is waiting', () => {
        expect(upload.waiting).toBeTruthy();
        upload.onComplete();
        expect(upload.waiting).not.toBeTruthy();
    });

    test('should show whether upload is in progress', () => {
        expect(upload.in_progress).not.toBeTruthy();
        upload.onProgress(100);
        expect(upload.in_progress).toBeTruthy();
    });

    test('should show whether upload is completed', () => {
        expect(upload.completed).not.toBeTruthy();
        upload.onComplete();
        expect(upload.completed).toBeTruthy();
    });

    test('should allow resuming of upload', async () => {
        expect(upload.in_progress).not.toBeTruthy();
        (provider_fn as any).getUploadProvider = vi
            .fn()
            .mockImplementation(() => Dummy);
        await upload.resume(4);
        expect(upload.in_progress).toBeTruthy();
    });

    test('should allow pausing of upload', () => {});

    test('should allow cancelling of upload', async () => {
        let status = await lastValueFrom(upload.status.pipe(take(1)));
        expect(status.status).not.toBe('cancelled');
        upload.cancel();
        status = await lastValueFrom(upload.status.pipe(take(1)));
        expect(status.status).toBe('cancelled');
    });
});
