let _api_endpoint = '/api/engine/v2/uploads';

export function getApiEndpoint() {
    return _api_endpoint;
}

export function setApiEndpoint(endpoint: string) {
    _api_endpoint = endpoint;
}
