import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SignedRequest } from '../src/signed-request';
import { mockXhr } from './helper.fn';

describe('SignedRequest', () => {
    let request: SignedRequest;

    beforeEach(() => {
        (globalThis.fetch as any) = vi.fn().mockImplementation(
            async () =>
                ({
                    status: 200,
                    ok: true,
                    json: async () => ({ upload_id: 'test-1' }),
                    text: async () => '{"upload_id": "test-1"}',
                    headers: {
                        Authorisation: 'test',
                        'x-total-count': 100,
                    },
                }) as any,
        );
        mockXhr(200);
        request = new SignedRequest(
            { id: 'test-1', file: {}, onError: vi.fn() } as any,
            '/endpoint',
        );
    });

    afterEach(() => {
        (globalThis.fetch as any).mockClear();
    });

    test('should create object', () => {
        expect(request).toBeInstanceOf(SignedRequest);
    });

    test('should initialise the signing request', async () => {
        expect(fetch).not.toHaveBeenCalled();
        const value = await request.initialise();
        expect(fetch).toHaveBeenCalled();
        expect(value).toEqual({ upload_id: 'test-1' });
    });

    test('should allow the creating a signed request for the upload', async () => {
        expect(fetch).not.toHaveBeenCalled();
        const value = await request.create({});
        expect(fetch).toHaveBeenCalled();
        expect(value).toEqual({ upload_id: 'test-1' });
    });

    test('should allow the creating a signed request for the upload', async () => {
        expect(fetch).not.toHaveBeenCalled();
        const value = await request.create({});
        expect(fetch).toHaveBeenCalled();
        expect(value).toEqual({ upload_id: 'test-1' });
    });

    test('should allow the signing an upload chunk', async () => {
        expect(fetch).not.toBeCalled();
        let value = await request.create({});
        value = await request.signChunk(1);
        expect(fetch).toHaveBeenCalled();
        expect(value).toEqual({ upload_id: 'test-1' });
    });

    test('should allow the signing the next upload chunk', async () => {
        expect(fetch).not.toHaveBeenCalled();
        let value = await request.create({});
        value = await request.signNextChunk(1, '2', []);
        expect(fetch).toHaveBeenCalled();
        expect(value).toEqual({ upload_id: 'test-1' });
    });

    test('should allow updating the upload status', async () => {
        expect(fetch).not.toHaveBeenCalled();
        let value = await request.create({});
        value = await request.updateStatus();
        expect(fetch).toHaveBeenCalled();
        expect(value).toEqual({ upload_id: 'test-1' });
    });

    test('should allow aborting the upload', async () => {
        await request.abort();
    });

    test('should allow deleting an upload', async () => {
        (request as any)._upload_id = '1';
        await request.destroy();
    });

    test('should allow performing the signed upload', async () => {
        await request.performSignedRequest({ signature: {} } as any);
    });
});
