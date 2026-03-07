// src/app/api/verify/x402/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { verifyX402PaymentReliability } from '@/lib/verify/x402';
import { attestAchievement, calculateScore } from '@/lib/verify/attest-achievement';
import type { PendingAchievement, VerificationResult } from '@/lib/verify/types';

export const runtime = 'nodejs';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const KEY_PREFIX    = 'achievement:pending:';
const VERIFY_WINDOW = 10 * 60 * 1000; // 10 min — reset stuck-verifying entries

export async function POST(req: NextRequest) {
  let body: { uid?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const uid = body.uid || req.headers.get('x-attestation-uid') || '';
  if (!uid) {
    return NextResponse.json({ error: 'uid required' }, { status: 400 });
  }

  const key      = KEY_PREFIX + uid;
  const rawValue = await redis.get(key);
  if (!rawValue) {
    return NextResponse.json({ error: 'Pending achievement not found', uid }, { status: 404 });
  }

  const pending: PendingAchievement = typeof rawValue === 'string'
    ? JSON.parse(rawValue)
    : rawValue as PendingAchievement;

  // Guard: already resolved
  if (
    pending.status === 'achieved' ||
    pending.status === 'failed' ||
    pending.status === 'expired'
  ) {
    return NextResponse.json({ uid, status: pending.status, alreadyResolved: true });
  }

  // Guard: currently verifying (with stuck reset after VERIFY_WINDOW)
  if (pending.status === 'verifying' && pending.lastChecked) {
    const elapsed = Date.now() - pending.lastChecked * 1000;
    if (elapsed < VERIFY_WINDOW) {
      return NextResponse.json({
        uid,
        status:  'verifying',
        message: 'Verification already in progress',
      });
    }
  }

  // Guard: deadline not reached yet (unless forced)
  const now      = Math.floor(Date.now() / 1000);
  const force    = body.force === true || req.headers.get('x-force-verify') === 'true';
  if (!force && pending.deadline > now) {
    const daysLeft = Math.ceil((pending.deadline - now) / 86400);
    return NextResponse.json({
      uid,
      status:   'pending',
      message:  `Deadline not reached. ${daysLeft} day(s) remaining.`,
      deadline: new Date(pending.deadline * 1000).toISOString(),
    });
  }

  // Mark as verifying
  await redis.set(key, JSON.stringify({
    ...pending,
    status:      'verifying',
    lastChecked: now,
  } satisfies PendingAchievement), { ex: 90 * 86400 });

  try {
    // ── Parse verificationParams from the stored JSON string ─────────────
    const params = JSON.parse(pending.verificationParams || '{}');

    // ── Run x402 verifier ────────────────────────────────────────────────
    const result: VerificationResult = await verifyX402PaymentReliability(
      {
        agentWallet:               params.agentWallet || pending.subject,
        windowDays:                params.windowDays  || 30,
        minSuccessRate:            params.minSuccessRate,
        minTotalUSD:               params.minTotalUSD,
        requireDistinctRecipients: params.requireDistinctRecipients,
        maxGapHours:               params.maxGapHours,
        metric:                    params.metric      || 'success_rate',
        target:                    params.target      || 98,
        chain:                     'base',
        mintTimestamp:             pending.mintTimestamp,
        baselineSnapshot:          params.baselineSnapshot || { txCount: 0, timestamp: pending.mintTimestamp },
      },
      uid,
    );

    if (!result.passed) {
      // Check if past deadline grace period (24h after deadline)
      const graceDeadline = pending.deadline + 86400;
      const newStatus     = now > graceDeadline ? 'failed' : 'pending';

      await redis.set(key, JSON.stringify({
        ...pending,
        status:        newStatus,
        lastChecked:   now,
        failureReason: result.failureReason,
      } satisfies PendingAchievement), { ex: 90 * 86400 });

      return NextResponse.json({
        uid,
        status:        newStatus,
        passed:        false,
        failureReason: result.failureReason,
        evidence:      result.evidence,
      });
    }

    // ── Verification passed — calculate score ─────────────────────────────
    const mintDate      = new Date(pending.mintTimestamp * 1000);
    const deadlineDate  = new Date(pending.deadline * 1000);
    const deadlineDays  = Math.ceil((pending.deadline - pending.mintTimestamp) / 86400);
    const daysRemaining = Math.ceil((pending.deadline - now) / 86400);
    const onTime        = now <= pending.deadline;

    const rawMetrics   = result.evidence.rawMetrics;
    const metricBonus  = rawMetrics.successRate
      ? Math.round(Math.min((Number(rawMetrics.successRate) - 95) / 5 * 50, 50))
      : 0;

    const score = calculateScore({
      level:         result.level!,
      onTime,
      daysRemaining,
      deadlineDays,
      evidenceCount: Object.keys(rawMetrics).length,
      metricBonus,
    });

    // ── Issue EAS achievement attestation + mint Badge ────────────────────
    const achievementResult = await attestAchievement({
      agentId:       pending.subject as `0x${string}`,
      claimType:     pending.claimType,
      level:         result.level!,
      commitmentUID: uid,
      evidence:      JSON.stringify(result.evidence),
      metric:        buildMetricSummary(result),
      score,
      onTime,
      themeKey:      params.themeKey || 'circuit-anim',
    });

    if (!achievementResult.success) {
      // Keep as pending so cron retries — attestation failed, not verification
      await redis.set(key, JSON.stringify({
        ...pending,
        status:      'pending',
        lastChecked: now,
      } satisfies PendingAchievement), { ex: 90 * 86400 });

      return NextResponse.json({
        uid,
        status:  'pending',
        passed:  true,
        level:   result.level,
        warning: 'Verification passed but attestation failed — will retry',
        error:   achievementResult.error,
      }, { status: 500 });
    }

    // ── Mark as achieved ──────────────────────────────────────────────────
    await redis.set(key, JSON.stringify({
      ...pending,
      status:      'achieved',
      lastChecked: now,
      level:       result.level,
    } satisfies PendingAchievement), { ex: 90 * 86400 });

    return NextResponse.json({
      uid,
      status:            'achieved',
      passed:            true,
      level:             result.level,
      score,
      onTime,
      achievementTxHash: achievementResult.achievementTxHash,
      nftTxHash:         achievementResult.nftTxHash,
      evidence:          result.evidence,
    });

  } catch (err: unknown) {
    // Unexpected error — reset to pending for retry
    await redis.set(key, JSON.stringify({
      ...pending,
      status:      'pending',
      lastChecked: now,
    } satisfies PendingAchievement), { ex: 90 * 86400 });

    console.error('[verify/x402] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Verification failed', details: String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pending: PendingAchievement = typeof raw === 'string'
    ? JSON.parse(raw)
    : raw as PendingAchievement;

  return NextResponse.json({
    uid,
    status:       pending.status,
    claimType:    pending.claimType,
    subject:      pending.subject,
    deadline:     new Date(pending.deadline * 1000).toISOString(),
    level:        pending.level,
    failureReason: pending.failureReason,
    lastChecked:  pending.lastChecked
      ? new Date(pending.lastChecked * 1000).toISOString()
      : null,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildMetricSummary(result: VerificationResult): string {
  const m = result.evidence.rawMetrics;
  const parts: string[] = [];
  if (m.successRate  !== undefined) parts.push(`${Number(m.successRate).toFixed(1)}% success rate`);
  if (m.totalUSD     !== undefined) parts.push(`$${Number(m.totalUSD).toFixed(2)} total`);
  if (m.paymentCount !== undefined) parts.push(`${m.paymentCount} payments`);
  return parts.join(' · ') || 'x402 payment reliability verified';
}