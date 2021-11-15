import { getApiEndpoint, setApiEndpoint } from "../src/settings.fn";

describe('Settings functions', () => {
    describe('Endpoint Methods', () => {
        it('should start with default', () => {
            expect(getApiEndpoint()).toBe('/api/files/v1/uploads');
        });
        
        it('should allow setting endpoint', () => {
            setApiEndpoint('/api/files/v1/test')
            expect(getApiEndpoint()).toBe('/api/files/v1/test');
        });
    })
});
