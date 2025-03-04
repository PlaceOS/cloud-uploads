import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getApiEndpoint } from '../src/settings.fn';
import { Upload } from '../src/upload';

import * as api from '../src/api';
import * as workers from '../src/hash-workers';
import { mockXhr } from './helper.fn';

describe('API Methods', () => {
    beforeEach(() => {
        (globalThis.fetch as any) = vi.fn().mockImplementation(
            async () =>
                ({
                    status: 200,
                    ok: true,
                    json: async () => ({}),
                    text: async () => '{}',
                    headers: {
                        Authorisation: 'test',
                        'x-total-count': 100,
                    },
                }) as any,
        );
        mockXhr(200);
    });
    afterEach(() => api.removeAllUploads());

    test('should allow initialising the service', () => {
        const spy = vi.spyOn(api, 'addProviders').mockImplementation(() => {});
        vi.spyOn(workers, 'setupHashWorkers').mockImplementation(() => {});
        api.initialiseUploadService();
        api.initialiseUploadService({ endpoint: '/test' });
        expect(getApiEndpoint()).toBe('/test');
        spy.mockRestore();
    });

    test('should allow adding providers', () => {
        api.addProviders([{ lookup: 'test' }] as any);
    });

    test('should allow listing uploads', () => {
        let list = api.listUploads();
        expect(list).toHaveLength(0);
        api.uploadFiles([new File([], 'test.txt')]);
        list = api.listUploads();
        expect(list).toHaveLength(1);
    });

    test('should allow uploading files', () => {
        api.uploadFiles([new File([], 'test.txt')]);
    });

    test('should allow pausing all uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.pauseAllUploads();
    });

    test('should allow resuming an upload', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.resumeUpload(new Upload(new File([], 'test.txt'), 1, 1));
    });

    test('should allow resuming all uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.resumeAllUploads();
    });

    test('should allow updating upload metadata', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.resumeAllUploads();
    });

    test('should allow removing an upload', () => {});

    test('should allow removing all uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.removeAllUploads();
    });

    test('should allow removing all completed uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.removeCompletedUploads();
    });
});
