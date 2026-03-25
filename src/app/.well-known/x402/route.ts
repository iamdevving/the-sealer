// src/app/.well-known/x402/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  return NextResponse.json({"version":1,"resources":["https://thesealer.xyz/api/attest","https://thesealer.xyz/api/attest-commitment","https://thesealer.xyz/api/attest-amendment","https://thesealer.xyz/api/mirror/mint","https://thesealer.xyz/api/upload"]}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}