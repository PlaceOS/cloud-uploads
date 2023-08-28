import { getApiEndpoint, setApiEndpoint } from '../src/settings.fn';

describe('Settings functions', () => {
    describe('Endpoint Methods', () => {
        it('should start with default', () => {
            expect(getApiEndpoint()).toBe('/api/engine/v2/uploads');
        });

        it('should allow setting endpoint', () => {
            setApiEndpoint('/api/engine/v2/test');
            expect(getApiEndpoint()).toBe('/api/engine/v2/test');
        });
    });
});
