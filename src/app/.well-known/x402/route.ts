// src/app/.well-known/x402/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    version: 1,
    resources: [
      'POST /api/attest',
      'POST /api/attest-commitment',
      'POST /api/attest-amendment',
      'POST /api/mirror/mint',
      'POST /api/upload',
    ],
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}