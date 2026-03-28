// src/app/api/sid/check/route.ts
//
// SECURITY CHANGES:
//
// 1. Removed freeClaimUsed from unauthenticated response (MEDIUM): This internal
//    entitlement flag revealed platform engagement and enabled targeted enumeration.
//    It is no longer returned to unauthenticated callers. The sid/claim endpoint
//    checks it server-side without exposing it.
//
// 2. Rate limiting added (MEDIUM): No rate limiting previously meant bulk
//    wallet-to-handle harvesting was trivial. Now 30 req/min per IP — generous
//    for UI use, blocks automated scanning.

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { rateLimitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const HANDLE_REGEX = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;

export async function GET(req: NextRequest) {
  // ── Rate limiting: 30/min per IP ──────────────────────────────────────────
  const limited = await rateLimitRequest(req, 'sid-check', 30, 60);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const wallet = params.get('wallet')?.toLowerCase().trim();
  const handle = params.get('handle')?.toLowerCase().trim();

  // Wallet lookup — returns current handle for a wallet
  if (wallet) {
    const currentHandle = await redis.get(`sid:wallet:${wallet}`);
    return NextResponse.json({
      wallet,
      handle: currentHandle || null,
      // freeClaimUsed intentionally omitted — internal entitlement flag,
      // not appropriate to expose in unauthenticated responses
    });
  }

  // Handle availability check
  if (!handle) return NextResponse.json({ error: 'handle or wallet required' }, { status: 400 });
  if (!HANDLE_REGEX.test(handle)) {
    return NextResponse.json({
      available: false,
      error: 'Invalid handle. Use 3-32 chars, lowercase letters, numbers, dots and hyphens only.',
    });
  }

  const existing = await redis.get(`sid:handle:${handle}`);
  return NextResponse.json({ handle, available: !existing });
}