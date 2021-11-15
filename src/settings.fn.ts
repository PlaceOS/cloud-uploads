
let _api_endpoint = '/api/files/v1/uploads';

export function getApiEndpoint() {
    return _api_endpoint;
}

export function setApiEndpoint(endpoint: string) {
    _api_endpoint = endpoint;
}
