// src/app/api/metadata/[contract]/[tokenId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export async function GET(
  req: NextRequest,
  { params }: { params: { contract: string; tokenId: string } }
) {
  const { contract, tokenId } = params;

  // Fetch metadata from Redis
  const key  = `nft:metadata:${contract}:${tokenId}`;
  const data = await redis.get<any>(key);

  if (!data) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  return NextResponse.json(data, {
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
