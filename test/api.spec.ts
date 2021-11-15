
import * as api from '../src/api';
import * as workers from '../src/hash-workers';
import { getApiEndpoint } from '../src/settings.fn';
import { Upload } from '../src/upload';

describe('API Methods', () => {

    afterEach(() => api.removeAllUploads());

    it('should allow initialising the service', () => {
        const spy = jest.spyOn(api, 'addProviders').mockImplementation();
        jest.spyOn(workers, 'setupHashWorkers').mockImplementation();
        api.initialiseUploadService();
        api.initialiseUploadService({ endpoint: '/test' });
        expect(getApiEndpoint()).toBe('/test');
        spy.mockRestore();
    });

    it('should allow adding providers', () => {
        api.addProviders([{ lookup: 'test' }] as any);
    });

    it('should allow listing uploads', () => {
        let list = api.listUploads();
        expect(list).toHaveLength(0);
        api.uploadFiles([new File([], 'test.txt')]);
        list = api.listUploads();
        expect(list).toHaveLength(1);
    });

    it('should allow uploading files', () => {
        api.uploadFiles([new File([], 'test.txt')]);
    });

    it('should allow pausing all uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.pauseAllUploads();
    });
    it('should allow resuming an upload', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.resumeUpload(new Upload(new File([], 'test.txt'), 1, 1));
    });
    it('should allow resuming all uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.resumeAllUploads();
    });
    it('should allow updating upload metadata', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.resumeAllUploads();
    });
    it('should allow removing an upload', () => {});
    it('should allow removing all uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.removeAllUploads();
    });
    it('should allow removing all completed uploads', () => {
        api.uploadFiles([new File([], 'test.txt')]);
        api.removeCompletedUploads();
    });
})
