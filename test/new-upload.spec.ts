import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { clearUploads } from '../src/new/manager';
import { Amazon } from '../src/new/providers';
import {
    initUploads,
    resumeUploadFile,
    Upload,
    uploadFile,
} from '../src/new/upload';

// The hashers spawn Web Workers, which do not exist under the node test
// environment. Md5.hashStr stays real so the resume_id fallback is exercised.
vi.mock('ts-md5', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ts-md5')>();
    return {
        ...actual,
        ParallelHasher: class {
            hash = vi.fn(async () => 'd41d8cd98f00b204e9800998ecf8427e');
            terminate = vi.fn();
        },
    };
});

const API = '/api/engine/v2/uploads';

interface FetchCall {
    url: string;
    method: string;
    headers: Record<string, string>;
}

const response = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `Status ${status}`,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: () => 'etag-value' },
});

describe('chunked upload manager', () => {
    let calls: FetchCall[];
    /** Responses for the PlaceOS commit call, consumed in order */
    let commit_queue: Array<{ status: number }>;
    /** Responses for blob storage part uploads, consumed in order */
    let blob_queue: Array<{ status: number }>;
    /** Response for the create call */
    let create_body: Record<string, unknown>;

    const directBody = {
        type: 'direct_upload',
        upload_id: 'up-direct',
        residence: 'AmazonS3',
        signature: {
            verb: 'PUT',
            url: 'https://blob.test/direct',
            headers: {},
        },
    };
    const chunkedBody = {
        type: 'chunked_upload',
        upload_id: 'up-chunked',
        residence: 'AmazonS3',
        // An empty url skips the blob-store init request
        signature: { verb: 'POST', url: '', headers: {} },
    };

    const commitCalls = () =>
        calls.filter(
            (call) => call.method === 'PUT' && call.url.startsWith(API),
        );
    const partCalls = () =>
        calls.filter(
            (call) => call.method === 'PATCH' && call.url.includes('part='),
        );
    const blobCalls = () => calls.filter((call) => !call.url.startsWith(API));

    beforeEach(() => {
        // btoa is global in node but the source reads it off `window`
        (globalThis as any).window ??= globalThis;
        calls = [];
        commit_queue = [];
        blob_queue = [];
        create_body = { ...chunkedBody };

        (globalThis.fetch as any) = vi.fn(
            async (url: string, init: RequestInit = {}) => {
                const method = init.method || 'GET';
                const target = String(url);
                calls.push({
                    url: target,
                    method,
                    headers: (init.headers || {}) as Record<string, string>,
                });
                if (!target.startsWith(API)) {
                    // Blob storage part upload / finalisation
                    const next = blob_queue.shift() || { status: 200 };
                    return response(next.status, '');
                }
                if (method === 'POST') return response(200, create_body);
                if (method === 'PATCH' && target.includes('part=')) {
                    return response(200, {
                        signature: {
                            verb: 'PUT',
                            url: 'https://blob.test/part',
                            headers: {},
                        },
                    });
                }
                if (method === 'PATCH') {
                    return response(200, {
                        signature: {
                            verb: 'POST',
                            url: 'https://blob.test/finalise',
                            headers: {},
                        },
                        body: '<CompleteMultipartUpload />',
                    });
                }
                if (method === 'PUT') {
                    const next = commit_queue.shift() || { status: 200 };
                    return response(next.status, '');
                }
                return response(200, {});
            },
        );
    });

    afterEach(() => {
        clearUploads();
        vi.clearAllMocks();
    });

    const waitFor = async (upload: Upload, status: string, timeout = 4000) => {
        const started = Date.now();
        while (upload.state.getValue().status !== status) {
            if (Date.now() - started > timeout) {
                throw new Error(
                    `Timed out waiting for ${status}, last state was ${JSON.stringify(
                        upload.state.getValue(),
                    )}`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return upload.state.getValue();
    };

    describe('reporting failures faithfully', () => {
        test('should fail a direct upload when the commit is rejected', async () => {
            initUploads({ token: 'tok', retries: 0, worker_url: 'w.js' });
            create_body = { ...directBody };
            commit_queue = [{ status: 401 }];

            const upload = await uploadFile(new File(['data'], 'a.png'));
            const state = await waitFor(upload, 'FAILED');

            expect(state.status).toBe('FAILED');
            expect(state.error).toContain('401');
        });

        test('should fail a chunked upload when the commit is rejected', async () => {
            initUploads({ token: 'tok', retries: 0, worker_url: 'w.js' });
            commit_queue = [{ status: 500 }];

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            const state = await waitFor(upload, 'FAILED');

            expect(state.status).toBe('FAILED');
            expect(state.error).toContain('500');
        });

        test('should complete when every call succeeds', async () => {
            initUploads({ token: 'tok', retries: 0, worker_url: 'w.js' });

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            const state = await waitFor(upload, 'COMPLETED');

            expect(state.progress).toBe(100);
            expect(state.error).toBeUndefined();
        });

        test('should surface a create failure rather than starting an upload', async () => {
            initUploads({ token: 'tok', retries: 0, worker_url: 'w.js' });
            (globalThis.fetch as any) = vi.fn(async () =>
                response(403, 'forbidden'),
            );

            await expect(
                uploadFile(new File(['data'], 'a.mp4')),
            ).rejects.toThrow(/403/);
        });
    });

    describe('retrying recoverable failures', () => {
        test('should retry a failed commit and then complete', async () => {
            initUploads({ token: 'tok', retries: 3, worker_url: 'w.js' });
            commit_queue = [{ status: 503 }, { status: 200 }];

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(upload, 'COMPLETED');

            expect(commitCalls()).toHaveLength(2);
        });

        test('should give up on a non-retryable status without retrying', async () => {
            initUploads({ token: 'tok', retries: 3, worker_url: 'w.js' });
            commit_queue = [{ status: 400 }];

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            const state = await waitFor(upload, 'FAILED');

            expect(state.error).toContain('400');
            expect(commitCalls()).toHaveLength(1);
        });
    });

    describe('blob storage failures', () => {
        test('should fail fast on a rejected signature', async () => {
            initUploads({ token: 'tok', retries: 3, worker_url: 'w.js' });
            blob_queue = [{ status: 403 }];

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            const state = await waitFor(upload, 'FAILED');

            expect(state.error).toContain('403');
            // Replaying a rejected signature can never succeed
            expect(blobCalls()).toHaveLength(1);
        });

        test('should fail fast on a rejected direct upload', async () => {
            initUploads({ token: 'tok', retries: 3, worker_url: 'w.js' });
            create_body = { ...directBody };
            blob_queue = [{ status: 403 }];

            const upload = await uploadFile(new File(['data'], 'a.png'));
            const state = await waitFor(upload, 'FAILED');

            expect(state.error).toContain('403');
            expect(blobCalls()).toHaveLength(1);
        });

        test('should still retry a transient blob storage error', async () => {
            initUploads({ token: 'tok', retries: 3, worker_url: 'w.js' });
            blob_queue = [{ status: 503 }];

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(upload, 'COMPLETED');

            // The failed part, its retry, and the finalisation request
            expect(blobCalls().length).toBeGreaterThan(1);
        });
    });

    describe('recovering from a failed finalisation', () => {
        test('should re-run finalisation on resume instead of stalling', async () => {
            initUploads({ token: 'tok', retries: 0, worker_url: 'w.js' });
            commit_queue = [{ status: 500 }];

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(upload, 'FAILED');
            const commits_before = commitCalls().length;

            upload.resume();
            const state = await waitFor(upload, 'COMPLETED');

            expect(state.progress).toBe(100);
            expect(state.error).toBeUndefined();
            expect(commitCalls().length).toBeGreaterThan(commits_before);
        });
    });

    describe('upload slot accounting', () => {
        test('should still run a later upload after one fails', async () => {
            initUploads({
                token: 'tok',
                retries: 0,
                simultaneous: 1,
                worker_url: 'w.js',
            });
            commit_queue = [{ status: 500 }];

            const failed = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(failed, 'FAILED');

            create_body = { ...chunkedBody, upload_id: 'up-second' };
            const second = await uploadFile(new File(['data'], 'b.mp4'));

            // Before the slot was released on failure this stayed PAUSED
            await waitFor(second, 'COMPLETED');
        });

        test('should free the slot when an in-flight upload is removed', async () => {
            initUploads({
                token: 'tok',
                retries: 0,
                simultaneous: 1,
                worker_url: 'w.js',
            });

            const first = await uploadFile(new File(['data'], 'a.mp4'));
            first.remove();

            create_body = { ...chunkedBody, upload_id: 'up-second' };
            const second = await uploadFile(new File(['data'], 'b.mp4'));
            await waitFor(second, 'COMPLETED');
        });
    });

    describe('resuming a part-complete upload', () => {
        test('should re-queue gaps rather than resuming past them', async () => {
            initUploads({ token: 'tok', retries: 0, worker_url: 'w.js' });
            // Four 5MiB parts, with parts 1 and 3 already done
            const file = new File(
                [new ArrayBuffer(16 * 1024 * 1024)],
                'big.mp4',
            );

            const upload = await resumeUploadFile(
                file,
                'up-resume',
                'resume-id',
                Amazon,
                [1, 3],
            );
            await waitFor(upload, 'COMPLETED');

            const signed_parts = partCalls().map((call) =>
                Number(
                    new URL(call.url, 'https://x.test').searchParams.get(
                        'part',
                    ),
                ),
            );
            expect(signed_parts).toContain(2);
            expect(signed_parts).toContain(4);
        });
    });

    describe('credentials', () => {
        test('should send a bearer token', async () => {
            initUploads({
                token: 'static-token',
                retries: 0,
                worker_url: 'w.js',
            });
            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(upload, 'COMPLETED');

            const create = calls.find((call) => call.method === 'POST');
            expect(create?.headers['Authorization']).toBe(
                'Bearer static-token',
            );
        });

        test('should send an api key instead of a bearer token', async () => {
            initUploads({
                api_key: 'secret-key',
                retries: 0,
                worker_url: 'w.js',
            });
            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(upload, 'COMPLETED');

            const create = calls.find((call) => call.method === 'POST');
            expect(create?.headers['x-api-key']).toBe('secret-key');
            expect(create?.headers['Authorization']).toBeUndefined();
        });

        test('should resolve a token getter on every request', async () => {
            let current = 'first-token';
            initUploads({
                token: () => current,
                retries: 0,
                worker_url: 'w.js',
            });

            const upload = await uploadFile(new File(['data'], 'a.mp4'));
            await waitFor(upload, 'COMPLETED');
            const before = calls.find((call) => call.method === 'POST');

            current = 'refreshed-token';
            calls = [];
            create_body = { ...chunkedBody, upload_id: 'up-second' };
            const second = await uploadFile(new File(['data'], 'b.mp4'));
            await waitFor(second, 'COMPLETED');
            const after = calls.find((call) => call.method === 'POST');

            expect(before?.headers['Authorization']).toBe('Bearer first-token');
            expect(after?.headers['Authorization']).toBe(
                'Bearer refreshed-token',
            );
        });
    });
});
