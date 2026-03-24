// src/lib/zauth.ts
import { NextRequest, NextResponse } from 'next/server';
import { ZauthClient } from '@zauthx402/sdk';
import { withX402Payment, x402Challenge } from '@/lib/x402';

export {
  issueSealAttestation,
  issueIdentityAttestation,
  issueCommitmentAttestation,
  issueAmendmentAttestation,
  withX402Payment,
  x402Challenge,
} from '@/lib/x402';

interface BazaarExtension {
  schema: {
    properties: {
      input:  { properties: { body: Record<string, any> } };
      output: { properties: { example: Record<string, any> } };
    };
  };
}

let _zauthClient: InstanceType<typeof ZauthClient> | null = null;

function getZauthClient(): InstanceType<typeof ZauthClient> | null {
  console.log('[zauth] getZauthClient called, key:', process.env.ZAUTH_API_KEY ? 'SET' : 'MISSING');
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
  } catch (err) {
    console.warn('[zauth] Failed to initialise ZauthClient:', err);
    _zauthClient = null;
  }
  return _zauthClient;
}

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
  let requestEventId: string | undefined;

  // Queue request event
  if (client) {
    try {
      const base = client.createEventBase('request');
      requestEventId = base.eventId;
      client.queueEvent({
        ...base,
        type:        'request',
        url,
        baseUrl:     new URL(url).origin,
        method,
        headers:     redactHeaders(headersToRecord(req.headers)),
        queryParams: Object.fromEntries(new URL(url).searchParams),
        body:        null,
        requestSize: Number(req.headers.get('content-length') || 0),
        sourceIp:    req.headers.get('x-forwarded-for') || 'unknown',
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

  // Run payment handler
  const response = await withX402Payment(req, handler, price, bazaar);

  // Queue response event + explicit flush (required in serverless)
  // Vercel kills the process after response — setTimeout never fires
  if (client && requestEventId) {
    try {
      const responseTime  = Date.now() - startTime;
      const statusCode    = response.status;
      const contentLength = response.headers.get('content-length');

      let responseBody: unknown = null;
      try {
        const text = await response.clone().text();
        if (text) responseBody = JSON.parse(text);
      } catch { /* non-JSON */ }

      client.queueEvent({
        ...client.createEventBase('response'),
        type:           'response',
        requestEventId,
        url,
        statusCode,
        headers:        redactHeaders(headersToRecord(response.headers)),
        body:           responseBody,
        responseSize:   contentLength ? Number(contentLength) : 0,
        responseTimeMs: responseTime,
        success:        statusCode >= 200 && statusCode < 300,
        meaningful:     statusCode === 200 && responseBody !== null,
      });

      // Must flush explicitly — serverless doesn't wait for setTimeout
      await (client as any).flush();
    } catch (err) {
      console.warn('[zauth] Failed to send telemetry:', err);
    }
  }

  return response;
}