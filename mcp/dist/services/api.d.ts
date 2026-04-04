export declare class SealerApiError extends Error {
    status: number;
    details?: string | undefined;
    constructor(message: string, status: number, details?: string | undefined);
}
export declare function sealerFetch<T>(path: string, options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
}): Promise<T>;
export declare function truncateIfNeeded(text: string, limit: number): string;
export declare function formatError(err: unknown): string;
//# sourceMappingURL=api.d.ts.map