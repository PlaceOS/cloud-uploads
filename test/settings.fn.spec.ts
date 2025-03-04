import { describe, expect, test } from 'vitest';
import { getApiEndpoint, setApiEndpoint } from '../src/settings.fn';

describe('Settings functions', () => {
    describe('Endpoint Methods', () => {
        test('should start with default', () => {
            expect(getApiEndpoint()).toBe('/api/engine/v2/uploads');
        });

        test('should allow setting endpoint', () => {
            setApiEndpoint('/api/engine/v2/test');
            expect(getApiEndpoint()).toBe('/api/engine/v2/test');
        });
    });
});
