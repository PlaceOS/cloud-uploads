import { vi } from 'vitest';
/* istanbul ignore file */

export function mockXhr(
    status: number,
    data?: { [key: string]: string }[],
): void {
    const xhrMockObj = {
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        readyState: 4,
        status,
        addEventListener: vi.fn((_, fn) =>
            status === 200 && _ !== 'error' ? setTimeout(() => fn({}), 30) : '',
        ),
        upload: {
            addEventListener: vi.fn((_, fn) =>
                status === 200 && _ !== 'error'
                    ? setTimeout(() => fn({}), 20)
                    : '',
            ),
        },
        onreadystatechange: vi.fn(),
        response: JSON.stringify(data),
    };
    const xhrMockClass = () => xhrMockObj;
    // @ts-ignore
    globalThis.XMLHttpRequest = vi.fn().mockImplementation(xhrMockClass);
    // @ts-ignore
    setTimeout(() => xhrMockObj['onreadystatechange'](), 0);
}
