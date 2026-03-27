// src/app/api/admin/auth/route.ts
// Server-side admin password check.
// On success: sets a signed httpOnly session cookie so the middleware
// can verify admin access without the password on every request.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

const ADMIN_COOKIE_NAME = 'sealer-admin-session';
const COOKIE_MAX_AGE    = 8 * 60 * 60; // 8 hours

function generateSessionToken(password: string): string {
  const secret  = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'fallback-secret';
  const payload = `${password}:${Math.floor(Date.now() / (1000 * 60 * 60))}`; // rotates hourly
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function verifySessionToken(token: string): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'fallback-secret';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;

  // Check current hour and previous hour (to handle boundary crossings)
  for (const hourOffset of [0, -1]) {
    const payload   = `${password}:${Math.floor(Date.now() / (1000 * 60 * 60)) + hourOffset}`;
    const expected  = createHmac('sha256', secret).update(payload).digest('hex');
    const expBuf    = Buffer.from(expected, 'hex');
    const tokBuf    = Buffer.from(token.length === expected.length ? token : '0'.repeat(expected.length), 'hex');
    try {
      if (timingSafeEqual(expBuf, tokBuf)) return true;
    } catch { /* length mismatch — invalid */ }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct      = process.env.ADMIN_PASSWORD;

  if (!correct) return NextResponse.json({ error: 'Not configured' }, { status: 500 });

  // Timing-safe comparison to prevent timing attacks
  const correctBuf  = Buffer.from(correct);
  const attemptBuf  = Buffer.from(
    password?.length === correct.length ? password : '0'.repeat(correct.length)
  );

  let match = false;
  try {
    match = timingSafeEqual(correctBuf, attemptBuf) && password === correct;
  } catch { match = false; }

  if (!match) {
    // Add a small delay to further discourage brute force
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token    = generateSessionToken(correct);
  const response = NextResponse.json({ ok: true });

  // Set httpOnly, secure, SameSite=Strict cookie
  response.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   COOKIE_MAX_AGE,
    path:     '/',
  });

  return response;
}

// Also expose a logout endpoint
export async function DELETE(_req: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_COOKIE_NAME);
  return response;
}