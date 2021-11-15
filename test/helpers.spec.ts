import { hexToBinary, humanReadableByteCount, toQueryString } from "../src/helpers";

describe('Helper functions', () => {
    describe('humanReadableByteCount', () => {
        it('should parse byte values', () => {
            expect(humanReadableByteCount(64 * 1024)).toBe('64.0 KB');
            expect(humanReadableByteCount(128 * 1024 * 1024)).toBe('128.0 MB');
            expect(humanReadableByteCount(32.5 * 1024 * 1024 * 1024)).toBe('32.5 GB');
        });
        it('should parse byte values with SI units', () => {
            expect(humanReadableByteCount(64 * 1000, true)).toBe('64.0 kiB');
            expect(humanReadableByteCount(128 * 1000 * 1000, true)).toBe('128.0 MiB');
            expect(humanReadableByteCount(32.5 * 1000 * 1000 * 1000, true)).toBe('32.5 GiB');
        });
    });

    describe('hexToBinary', () => {
        it('should convert hex into binary', () => {
            expect(hexToBinary('')).toBe('');
        });
    });

    describe('toQueryString', () => {
        it('converts object into URL query string', () => {
            // Check method
            expect(toQueryString({ test: 'value' })).toBe('test=value');
            // Multiple properties
            expect(toQueryString({ test: 'new_value', other: 'person' })).toBe(
                'test=new_value&other=person'
            );
            // Number properties
            expect(toQueryString({ number: 9 })).toBe('number=9');
            // Boolean properties
            expect(toQueryString({ bool: false })).toBe('bool=false');
            expect(toQueryString({ bool: true })).toBe('bool=true');
        });
    });
})
