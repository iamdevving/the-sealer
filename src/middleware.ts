// src/middleware.ts
// Next.js middleware — runs on the edge before any route handler.
//
// Security responsibilities:
//   1. Block unauthenticated access to /admin at the HTTP layer
//   2. Add security headers to all responses
//
// SECURITY CHANGE: Added Strict-Transport-Security with includeSubDomains
// and preload. Previously HSTS was absent from this middleware entirely.

import { NextRequest, NextResponse } from 'next/server';

function addSecurityHeaders(response: NextResponse): NextResponse {
  // HSTS — 2 years, covers all subdomains, eligible for browser preload list
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' " + [
        'https://*.alchemy.com',
        'https://*.alchemyapi.io',
        'https://mainnet.helius-rpc.com',
        'https://api-mainnet.helius-rpc.com',
        'https://base.easscan.org',
        'https://api.neynar.com',
        'https://api.coingecko.com',
        'https://public.blob.vercel-storage.com',
        'wss://*.walletconnect.com',
        'wss://*.walletconnect.org',
        'https://*.walletconnect.com',
        'https://*.walletconnect.org',
        'https://api.cdp.coinbase.com',
        'https://mainnet.base.org',
        'https://api.mainnet-beta.solana.com',
        'https://dns.google',
        'https://www.googleapis.com',
        'wss://relay.walletconnect.com',
        'wss://relay.walletconnect.org',
      ].join(' '),
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  return response;
}

const ADMIN_COOKIE_NAME = 'sealer-admin-session';

async function isValidAdminSession(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(ADMIN_COOKIE_NAME);
  if (!cookie?.value || cookie.value.length < 40) return false;

  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );

  const hourNow  = Math.floor(Date.now() / (1000 * 60 * 60));
  const password = process.env.ADMIN_PASSWORD || '';

  for (const hourOffset of [0, -1]) {
    const payload  = encoder.encode(`${password}:${hourNow + hourOffset}`);
    const sigBuf   = await crypto.subtle.sign('HMAC', key, payload);
    const expected = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if (expected === cookie.value) return true;
  }

  return false;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const valid = await isValidAdminSession(req);
    if (!valid) {
      return addSecurityHeaders(NextResponse.redirect(new URL('/', req.url), { status: 302 }));
    }
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)',
  ],
};