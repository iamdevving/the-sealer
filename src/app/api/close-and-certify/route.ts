// src/app/api/close-and-certify/route.ts
//
// Internal endpoint for ACP seller script — triggers verification for a commitment
// without requiring the caller to know the claimType.
//
// Flow:
//   1. Validate x-internal-key header
//   2. Look up commitment in Redis to get claimType + ownership
//   3. Verify agentId matches commitment owner
//   4. Call the correct /api/verify/[claimType] route internally with force=true
//   5. Return the verification result
//
// Security checklist:
//   ✓ No server-side URL fetch → no validateImageUrl needed
//   ✓ Writes onchain state (triggers attestation) → ownership verified via agentId match
//     against Redis record. EVM callers going through ACP have already proven wallet
//     ownership at commitment mint time (EIP-712 sig required by attest-commitment).
//     This route enforces the same ownership by checking agentId === record.subject.
//   ✓ Rate limited: 5/hr per IP (write/payment tier — triggers Alchemy + EAS calls)
//   ✓ Returns only public fields — no internal scoring metadata exposed
//   ✓ All body fields type-checked before string operations

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { rateLimitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const VALID_CLAIM_TYPES = new Set([
  'x402_payment_reliability',
  'defi_trading_performance',
  'code_software_delivery',
  'website_app_delivery',
  'acp_job_delivery',
]);

export async function POST(req: NextRequest) {
  // ── Internal key auth ──────────────────────────────────────────────────
  const internalKey = req.headers.get('x-internal-key');
  if (!internalKey || internalKey !== process.env.SEALER_INTERNAL_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Rate limiting: 5/hr per IP (triggers Alchemy + EAS calls) ─────────
  const limited = await rateLimitRequest(req, 'close-and-certify', 5, 3600);
  if (limited) return limited;

  // ── Parse + type-check body ────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.commitmentUid !== undefined && typeof body.commitmentUid !== 'string') {
    return NextResponse.json({ error: 'commitmentUid must be a string' }, { status: 400 });
  }
  if (body.agentId !== undefined && typeof body.agentId !== 'string') {
    return NextResponse.json({ error: 'agentId must be a string' }, { status: 400 });
  }

  const commitmentUid = (body.commitmentUid as string | undefined)?.trim();
  const agentId       = (body.agentId       as string | undefined)?.trim();

  if (!commitmentUid) {
    return NextResponse.json({ error: 'commitmentUid is required' }, { status: 400 });
  }
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  // ── Load commitment from Redis ─────────────────────────────────────────
  const raw = await redis.get(`achievement:pending:${commitmentUid}`).catch(() => null);
  if (!raw) {
    return NextResponse.json(
      { error: 'Commitment not found', commitmentUid },
      { status: 404 },
    );
  }

  const record = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;

  // ── Ownership check ────────────────────────────────────────────────────
  // agentId must match the wallet that created the commitment
  if ((record.subject as string)?.toLowerCase() !== agentId.toLowerCase()) {
    return NextResponse.json(
      { error: 'Unauthorized — agentId does not match commitment owner' },
      { status: 403 },
    );
  }

  // ── Validate claimType ─────────────────────────────────────────────────
  const claimType = record.claimType as string;
  if (!claimType || !VALID_CLAIM_TYPES.has(claimType)) {
    return NextResponse.json(
      { error: `Cannot verify — unsupported claimType: ${claimType}` },
      { status: 422 },
    );
  }

  // ── Check current status ───────────────────────────────────────────────
  // Already resolved — return cached result immediately
  if (record.status === 'achieved') {
    return NextResponse.json({
      commitmentUid,
      status:      'achieved',
      claimType,
      agentId,
      proofPoints: record.proofPoints ?? null,
      difficulty:  record.difficulty  ?? null,
      message:     'Commitment already certified.',
    });
  }
  if (record.status === 'failed') {
    return NextResponse.json({
      commitmentUid,
      status:   'failed',
      claimType,
      agentId,
      message:  'Commitment already closed as failed.',
    });
  }

  // ── Call the correct verify route internally with force=true ───────────
  const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration — CRON_SECRET not set' },
      { status: 500 },
    );
  }

  // Map claimType → verify route path
  const verifyPaths: Record<string, string> = {
    x402_payment_reliability: '/api/verify/x402',
    defi_trading_performance: '/api/verify/defi',
    code_software_delivery:   '/api/verify/github',
    website_app_delivery:     '/api/verify/website',
    acp_job_delivery: '/api/verify/acp_job_delivery',
  };
  const verifyPath = verifyPaths[claimType];

  let verifyResponse: Response;
  try {
    verifyResponse = await fetch(`${baseUrl}${verifyPath}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ uid: commitmentUid, force: true }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Verification request failed', details: String(err) },
      { status: 500 },
    );
  }

  let result: Record<string, unknown> = {};
  try {
    result = await verifyResponse.json();
  } catch {
    return NextResponse.json(
      { error: `Verifier returned non-JSON response (HTTP ${verifyResponse.status})` },
      { status: 500 },
    );
  }

  if (!verifyResponse.ok && verifyResponse.status !== 200) {
    return NextResponse.json(
      {
        error:          'Verification failed',
        verifierStatus: verifyResponse.status,
        details:        result.error ?? result,
      },
      { status: verifyResponse.status >= 500 ? 500 : 422 },
    );
  }

  // ── Return clean result ────────────────────────────────────────────────
  return NextResponse.json({
    commitmentUid,
    claimType,
    agentId,
    status:            result.status,
    passed:            result.passed,
    outcome:           result.outcome           ?? null,
    achievementScore:  result.achievementScore  ?? null,
    proofPoints:       result.proofPoints       ?? null,
    difficulty:        result.difficulty        ?? null,
    bootstrapped:      result.bootstrapped      ?? null,
    badgeTier:         result.badgeTier         ?? null,
    achievementUID:    result.achievementUID    ?? null,
    certificateUrl:    result.certificateUrl    ?? null,
    onTime:            result.onTime            ?? null,
    message:           result.failureReason
      ? `Verification did not pass: ${result.failureReason}`
      : result.status === 'achieved'
        ? 'Commitment certified. Certificate issued.'
        : `Verification status: ${result.status}`,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint:    'POST /api/close-and-certify',
    description: 'Trigger verification and certify a commitment. Requires x-internal-key header.',
    params: {
      commitmentUid: 'EAS commitment attestation UID — required',
      agentId:       'Agent wallet address — must match commitment owner',
    },
  });
}