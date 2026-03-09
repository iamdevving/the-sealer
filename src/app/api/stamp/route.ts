// src/app/api/stamp/route.ts
// Returns the raw stamp PNG (white or black) based on theme darkness.
// Used by CardPage (client component) which cannot import assets.ts directly.
import { NextRequest, NextResponse } from 'next/server';
import { STAMP_STATEMENT_WHITE, STAMP_STATEMENT_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const DARK_THEMES = new Set(['circuit-anim','circuit','aurora','gold','silver','bronze','bitcoin']);

export async function GET(req: NextRequest) {
  const theme = new URL(req.url).searchParams.get('theme') || 'circuit-anim';
  const dataUrl = DARK_THEMES.has(theme) ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  // dataUrl is "data:image/png;base64,..."
  const base64 = dataUrl.split(',')[1];
  const buf = Buffer.from(base64, 'base64');
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}