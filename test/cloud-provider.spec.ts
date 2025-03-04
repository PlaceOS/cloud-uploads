import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CloudProvider, State } from '../src/cloud-provider';

class TestCloudProvider extends CloudProvider {
    _start() {
        this.state = State.Uploading;
        this._strategy = '';
    }
}

describe('CloudProvider', () => {
    let provider: CloudProvider;
    let request: any;
    let upload: any;

    beforeEach(() => {
        request = {
            abort: vi.fn(),
            destroy: vi.fn(),
            performSignedRequest: vi.fn(),
            updateStatus: vi.fn(async () => {}),
        };
        upload = {
            file: {},
            onError: vi.fn(),
            onComplete: vi.fn(),
            onProgress: vi.fn(),
        };
        provider = new TestCloudProvider(request, upload);
    });

    test('should create object', () => {
        expect(provider).toBeInstanceOf(CloudProvider);
    });

    test('should allow starting the upload', () => {
        provider.start();
    });
    test('should allow pausing the upload', () => {
        provider.start();
        provider.pause();
    });
    test('should allow cleaning up the upload', () => {
        provider.start();
        provider.destroy();
    });
});
