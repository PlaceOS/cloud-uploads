
export function humanReadableByteCount(bytes: number, si: boolean = false) {
    const unit = si ? 1000.0 : 1024.0;
    if (bytes < unit) {
        return bytes + (si ? ' iB' : ' B');
    }
    const exp = Math.floor(Math.log(bytes) / Math.log(unit));
    const pre = (si ? 'kMGTPE' : 'KMGTPE').charAt(exp - 1) + (si ? 'iB' : 'B');
    return (bytes / Math.pow(unit, exp)).toFixed(1) + ' ' + pre;
}

/** Convert string of hexedecimal to binary */
export function hexToBinary(input: string) {
    let result = '';
    if (input.length % 2 > 0) input = '0' + input;
    for (let i = 0, length = input.length; i < length; i += 2) {
        result += String.fromCharCode(parseInt(input.slice(i, i + 2), 16));
    }
    return result;
}

/**
 * Convert map into a query string
 * @param map Key value pairs to convert
 */
 export function toQueryString(map: Record<string, any>) {
    let str = '';
    if (map) {
        for (const key in map) {
            if (map.hasOwnProperty(key) && map[key] !== undefined && map[key] !== null) {
                str += `${(str ? '&' : '')}${key}=${encodeURIComponent(map[key])}`;
            }
        }
    }
    return str;
}