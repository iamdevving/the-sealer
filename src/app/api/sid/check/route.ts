// src/app/api/sid/check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const HANDLE_REGEX = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;

export async function GET(req: NextRequest) {
  const handle = new URL(req.url).searchParams.get('handle')?.toLowerCase().trim();

  if (!handle) return NextResponse.json({ error: 'handle required' }, { status: 400 });
  if (!HANDLE_REGEX.test(handle)) {
    return NextResponse.json({
      available: false,
      error: 'Invalid handle. Use 3-32 chars, lowercase letters, numbers, dots and hyphens only.',
    });
  }

  const existing = await redis.get(`sid:handle:${handle}`);
  return NextResponse.json({ handle, available: !existing });
}