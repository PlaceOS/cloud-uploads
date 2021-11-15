import { getUploadProvider, registerUploadProvider } from "../src/providers.fn";

describe('Provider functions', () => {
    it('should allow registering providers', () => {
        expect(getUploadProvider('Test')).toBeNull();
        const value: any = 1;
        registerUploadProvider('Test', value);
        expect(getUploadProvider('Test')).toBe(value);
    });
});
