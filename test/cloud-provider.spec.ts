import { CloudProvider, State } from '../src/cloud-provider';

class TestCloudProvider extends CloudProvider {
    _start() {
        this.state = State.Uploading;
        this._strategy = null;
    }
}

describe('CloudProvider', () => {
    let provider: CloudProvider;
    let request: any;
    let upload: any;

    beforeEach(() => {
        request = {
            abort: jest.fn(),
            destroy: jest.fn(),
            performSignedRequest: jest.fn(),
            updateStatus: jest.fn(async () => {}),
        };
        upload = {
            file: {},
            onError: jest.fn(),
            onComplete: jest.fn(),
            onProgress: jest.fn(),
        };
        provider = new TestCloudProvider(request, upload);
    });

    it('should create object', () => {
        expect(provider).toBeInstanceOf(CloudProvider);
    });

    it('should allow starting the upload', () => {
        provider.start();
    });
    it('should allow pausing the upload', () => {
        provider.start();
        provider.pause();
    });
    it('should allow cleaning up the upload', () => {
        provider.start();
        provider.destroy();
    });
});
