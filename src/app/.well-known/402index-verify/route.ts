import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
export async function GET(req: NextRequest) {
  const token = process.env.FOURZEROTWO_INDEX_VERIFY_TOKEN || '';
  return new NextResponse(token, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}