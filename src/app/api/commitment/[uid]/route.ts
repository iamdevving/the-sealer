// src/app/api/commitment/[uid]/route.ts
//
// Public read-only endpoint — returns status and metadata for a commitment UID.
// Used by ACP seller script for `check_commitment` offering.
//
// Security checklist:
//   - No server-side URL fetch → no validateImageUrl needed
//   - Read-only, no onchain writes → no wallet ownership proof needed
//   - Returns only public fields — failureReason intentionally omitted
//   - Rate limited: 30/min per IP (public read tier)

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { rateLimitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payment Reliability',
  defi_trading_performance: 'DeFi Trading Performance',
  code_software_delivery:   'Code / Software Delivery',
  website_app_delivery:     'Website / App Delivery',
  social_media_growth:      'Social Media Growth',
};

export async function GET(
  req:     NextRequest,
  context: { params: Promise<{ uid: string }> },
) {
  // ── Rate limiting: 30/min per IP (public read) ─────────────────────────
  const limited = await rateLimitRequest(req, 'commitment-uid', 30, 60);
  if (limited) return limited;

  const { uid } = await context.params;

  if (!uid || uid.trim().length === 0) {
    return NextResponse.json({ error: 'uid is required' }, { status: 400 });
  }

  const raw = await redis.get(`achievement:pending:${uid}`).catch(() => null);

  if (!raw) {
    return NextResponse.json(
      { error: 'Commitment not found', uid },
      { status: 404 },
    );
  }

  const record = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;

  // Only return public fields — failureReason omitted (exposes scoring internals)
  return NextResponse.json({
    uid,
    status:      record.status,
    claimType:   record.claimType,
    claimLabel:  CLAIM_LABELS[record.claimType as string] || record.claimType,
    agentId:     record.subject,
    difficulty:  record.difficulty       ?? null,
    proofPoints: record.proofPoints      ?? null,
    deadline:    record.deadline
      ? new Date((record.deadline as number) * 1000).toISOString()
      : null,
    mintedAt:    record.mintTimestamp
      ? new Date((record.mintTimestamp as number) * 1000).toISOString()
      : null,
    lastChecked: record.lastChecked
      ? new Date((record.lastChecked as number) * 1000).toISOString()
      : null,
    amended:     !!record.amendedUID,
  });
}