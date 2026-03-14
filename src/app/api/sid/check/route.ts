// src/app/api/sid/check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const HANDLE_REGEX = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const wallet = params.get('wallet')?.toLowerCase().trim();
  const handle = params.get('handle')?.toLowerCase().trim();

  // Wallet lookup — returns current handle for a wallet
  if (wallet) {
    const currentHandle = await redis.get(`sid:wallet:${wallet}`);
    const freeClaimed   = await redis.get(`sid:free_claim_used:${wallet}`);
    return NextResponse.json({
      wallet,
      handle:        currentHandle || null,
      freeClaimUsed: !!freeClaimed,
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