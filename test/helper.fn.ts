/* istanbul ignore file */

export function mockXhr(
    status: number,
    data?: { [key: string]: string }[]
): void {
    const xhrMockObj = {
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        readyState: 4,
        status,
        addEventListener: jest.fn((_, fn) =>
            status === 200 && _ !== 'error' ? setTimeout(() => fn({}), 30) : ''
        ),
        upload: {
            addEventListener: jest.fn((_, fn) =>
                status === 200 && _ !== 'error'
                    ? setTimeout(() => fn({}), 20)
                    : ''
            ),
        },
        onreadystatechange: jest.fn(),
        response: JSON.stringify(data),
    };
    const xhrMockClass = () => xhrMockObj;
    // @ts-ignore
    window.XMLHttpRequest = jest.fn().mockImplementation(xhrMockClass);
    // @ts-ignore
    setTimeout(() => xhrMockObj['onreadystatechange'](), 0);
}
