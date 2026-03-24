// src/lib/zauth.ts
//
// Official @zauthx402/sdk integration for Next.js (App Router)
//
// Uses ZauthClient directly from the SDK — no Express required.
// Wraps withX402Payment to observe requests/responses and report
// telemetry to the Zauth Provider Hub asynchronously.
//
// Drop-in replacement: swap withX402Payment → withZauthX402Payment.
// All attestation functions and x402Challenge are re-exported so
// route files only need to change their import path.

import { NextRequest, NextResponse } from 'next/server';
import { ZauthClient } from '@zauthx402/sdk';
import { withX402Payment, x402Challenge } from '@/lib/x402';

// ── Re-export everything from x402 so routes can import from one place ────────
export {
  issueSealAttestation,
  issueIdentityAttestation,
  issueCommitmentAttestation,
  issueAmendmentAttestation,
  withX402Payment,
  x402Challenge,
} from '@/lib/x402';

// ── BazaarExtension type (mirrors x402.ts) ────────────────────────────────────
interface BazaarExtension {
  schema: {
    properties: {
      input:  { properties: { body: Record<string, any> } };
      output: { properties: { example: Record<string, any> } };
    };
  };
}

// ── Singleton ZauthClient ─────────────────────────────────────────────────────

let _zauthClient: InstanceType<typeof ZauthClient> | null = null;

function getZauthClient(): InstanceType<typeof ZauthClient> | null {
  if (!process.env.ZAUTH_API_KEY) return null;
  if (_zauthClient) return _zauthClient;
  try {
    _zauthClient = new ZauthClient({
      apiKey:      process.env.ZAUTH_API_KEY,
      mode:        'provider',
      environment: process.env.NODE_ENV || 'production',
      debug:       false,
      refund:      { enabled: false },
      telemetry: {
        includeRequestBody:  true,
        includeResponseBody: true,
        maxBodySize:         5000,
        redactHeaders: [
          'authorization', 'cookie', 'x-api-key',
          'x-payment', 'payment-signature', 'payment-required',
        ],
      },
    });
    console.log('[zauth] ZauthClient initialised');
  } catch (err) {
    console.warn('[zauth] Failed to initialise ZauthClient:', err);
    _zauthClient = null;
  }
  return _zauthClient;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => { out[k] = v; });
  return out;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redact = new Set([
    'authorization', 'cookie', 'x-api-key',
    'x-payment', 'payment-signature', 'payment-required',
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = redact.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

// ── Core wrapper ──────────────────────────────────────────────────────────────

export async function withZauthX402Payment(
  req:     NextRequest,
  handler: (paymentChain?: 'base' | 'solana') => Promise<NextResponse>,
  price:   string = '0.10',
  bazaar?: BazaarExtension,
): Promise<NextResponse> {
  const client    = getZauthClient();
  const startTime = Date.now();
  const url       = req.url;
  const method    = req.method;

  // Track request event ID so we can link response to it
  let requestEventId: string | undefined;

  // ── Queue request event ───────────────────────────────────────────────────
  if (client) {
    try {
      const base = client.createEventBase('request');
      requestEventId = base.eventId;
      const reqHeaders = redactHeaders(headersToRecord(req.headers));

      client.queueEvent({
        ...base,
        type:        'request',
        url,
        baseUrl:     new URL(url).origin,
        method,
        headers:     reqHeaders,
        queryParams: Object.fromEntries(new URL(url).searchParams),
        body:        null, // body consumed by payment middleware — not available here
        requestSize: Number(req.headers.get('content-length') || 0),
        sourceIp:    req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
        userAgent:   req.headers.get('user-agent') || undefined,
        paymentHeader:
          req.headers.get('payment-signature') ||
          req.headers.get('x-payment')         ||
          undefined,
      });
    } catch (err) {
      console.warn('[zauth] Failed to queue request event:', err);
    }
  }

  // ── Run the actual payment handler ────────────────────────────────────────
  const response = await withX402Payment(req, handler, price, bazaar);

  // ── Queue response event (fire-and-forget) ────────────────────────────────
  if (client && requestEventId) {
    // Don't await — never block the response
    Promise.resolve().then(async () => {
      try {
        const responseTime = Date.now() - startTime;
        const statusCode   = response.status;

        let responseBody: unknown = null;
        try {
          const clone = response.clone();
          const text  = await clone.text();
          if (text) responseBody = JSON.parse(text);
        } catch { /* non-JSON */ }

        const resHeaders = redactHeaders(headersToRecord(response.headers));
        const contentLength = response.headers.get('content-length');

        client.queueEvent({
          ...client.createEventBase('response'),
          type:           'response',
          requestEventId,
          url,
          statusCode,
          headers:        resHeaders,
          body:           responseBody,
          responseSize:   contentLength ? Number(contentLength) : 0,
          responseTimeMs: responseTime,
          success:        statusCode >= 200 && statusCode < 300,
          meaningful:     statusCode === 200 && responseBody !== null,
        });
      } catch (err) {
        console.warn('[zauth] Failed to queue response event:', err);
      }
    });
  }

  return response;
}