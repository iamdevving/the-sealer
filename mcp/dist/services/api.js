"use strict";
// src/services/api.ts
// Shared API client for The Sealer Protocol
Object.defineProperty(exports, "__esModule", { value: true });
exports.SealerApiError = void 0;
exports.sealerFetch = sealerFetch;
exports.truncateIfNeeded = truncateIfNeeded;
exports.formatError = formatError;
const constants_js_1 = require("../constants.js");
class SealerApiError extends Error {
    status;
    details;
    constructor(message, status, details) {
        super(message);
        this.status = status;
        this.details = details;
        this.name = 'SealerApiError';
    }
}
exports.SealerApiError = SealerApiError;
async function sealerFetch(path, options = {}) {
    const { method = 'GET', body, params, headers = {} } = options;
    let url = `${constants_js_1.SEALER_BASE_URL}${path}`;
    if (params) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                searchParams.set(key, String(value));
            }
        }
        const qs = searchParams.toString();
        if (qs)
            url += `?${qs}`;
    }
    const requestOptions = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...headers,
        },
    };
    if (body) {
        requestOptions.body = JSON.stringify(body);
    }
    let response;
    try {
        response = await fetch(url, requestOptions);
    }
    catch (err) {
        throw new SealerApiError(`Network error connecting to Sealer API: ${String(err)}`, 0, url);
    }
    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        try {
            data = await response.json();
        }
        catch {
            throw new SealerApiError(`Failed to parse JSON response from ${path}`, response.status);
        }
    }
    else {
        const text = await response.text();
        throw new SealerApiError(`Unexpected content type '${contentType}' from ${path}`, response.status, text.slice(0, 500));
    }
    if (!response.ok) {
        const errData = data;
        throw new SealerApiError(errData.error || `API returned HTTP ${response.status}`, response.status, errData.message || errData.details);
    }
    return data;
}
function truncateIfNeeded(text, limit) {
    if (text.length <= limit)
        return text;
    return text.slice(0, limit) + `\n\n[Response truncated at ${limit} characters. Use more specific filters to narrow results.]`;
}
function formatError(err) {
    if (err instanceof SealerApiError) {
        let msg = `Error ${err.status}: ${err.message}`;
        if (err.details)
            msg += `\nDetails: ${err.details}`;
        return msg;
    }
    return `Unexpected error: ${String(err)}`;
}
//# sourceMappingURL=api.js.map