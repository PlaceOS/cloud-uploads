import { SignedRequest } from '../src/signed-request';
import { mockXhr } from './helper.fn';

describe('SignedRequest', () => {
    let request: SignedRequest;

    beforeEach(() => {
        request = new SignedRequest({ file: {} } as any, '/endpoint');
        (global as any).fetch = jest.fn(() =>
            Promise.resolve({
                json: () => Promise.resolve({}),
                text: () => Promise.resolve('{}'),
            })
        );
        mockXhr(200);
    });

    afterEach(() => {
        (global as any).fetch.mockClear();
        delete global.fetch;
    });

    it('should create object', () => {
        expect(request).toBeInstanceOf(SignedRequest);
    });

    it('should initialise the signing request', async () => {
        expect(fetch).not.toBeCalled();
        const value = await request.initialiseSignedRequest();
        expect(fetch).toBeCalled();
        expect(value).toEqual({});
    });

    it('should allow the signing the upload', async () => {
        expect(fetch).not.toBeCalled();
        const value = await request.signUpload({});
        expect(fetch).toBeCalled();
        expect(value).toEqual({});
    });

    it('should allow the signing an upload chunk', async () => {
        expect(fetch).not.toBeCalled();
        const value = await request.signChunk(1);
        expect(fetch).toBeCalled();
        expect(value).toEqual({});
    });

    it('should allow the signing the next upload chunk', async () => {
        expect(fetch).not.toBeCalled();
        const value = await request.signNextChunk(1, '2', []);
        expect(fetch).toBeCalled();
        expect(value).toEqual({});
    });

    it('should allow updating the upload status', async () => {
        expect(fetch).not.toBeCalled();
        const value = await request.updateStatus();
        expect(fetch).toBeCalled();
        expect(value).toEqual('{}');
    });

    it('should allow aborting the upload', async () => {
        await request.abort();
    });

    it('should allow deleting an upload', async () => {
        (request as any)._upload_id = '1';
        await request.destroy();
    });

    it('should allow performing the signed upload', async () => {
        await request.performSignedRequest({ signature: {} } as any);
    });
});
