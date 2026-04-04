// src/services/api.ts
// Shared API client for The Sealer Protocol

import { SEALER_BASE_URL } from '../constants.js';
export class SealerApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string
  ) {
    super(message);
    this.name = 'SealerApiError';
  }
}

export async function sealerFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params, headers = {} } = options;

  let url = `${SEALER_BASE_URL}${path}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const requestOptions: RequestInit = {
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

  let response: Response;
  try {
    response = await fetch(url, requestOptions);
  } catch (err) {
    throw new SealerApiError(
      `Network error connecting to Sealer API: ${String(err)}`,
      0,
      url
    );
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      throw new SealerApiError(
        `Failed to parse JSON response from ${path}`,
        response.status
      );
    }
  } else {
    const text = await response.text();
    throw new SealerApiError(
      `Unexpected content type '${contentType}' from ${path}`,
      response.status,
      text.slice(0, 500)
    );
  }

  if (!response.ok) {
    const errData = data as { error?: string; message?: string; details?: string };
    throw new SealerApiError(
      errData.error || `API returned HTTP ${response.status}`,
      response.status,
      errData.message || errData.details
    );
  }

  return data as T;
}

export function truncateIfNeeded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[Response truncated at ${limit} characters. Use more specific filters to narrow results.]`;
}

export function formatError(err: unknown): string {
  if (err instanceof SealerApiError) {
    let msg = `Error ${err.status}: ${err.message}`;
    if (err.details) msg += `\nDetails: ${err.details}`;
    return msg;
  }
  return `Unexpected error: ${String(err)}`;
}
