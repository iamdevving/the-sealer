// src/lib/verify/route-handler.ts
//
// SECURITY CHANGE: Added rate limiting to handleVerifyRoute.
// 10 verification requests per hour per IP — prevents API cost abuse
// (Alchemy, GitHub, PageSpeed calls are not free).
// The uid check still gates access to real Redis entries so random spam
// is cheap to reject, but rate limiting stops sustained hammering.

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { attestAchievement } from '@/lib/verify/attest-achievement';
import type { CertificateMetric, CertificateOutcome } from '@/lib/verify/attest-achievement';
import type { CommitmentThresholds } from '@/lib/difficulty';
import { computeDifficulty } from '@/lib/difficulty';
import type { PendingAchievement, VerificationResult } from '@/lib/verify/types';
import { computeScoring } from '@/lib/verify/scoring';
import { rateLimitRequest } from '@/lib/security';

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX = 'achievement:pending:';
const VERIFY_WINDOW_MS = 10 * 60 * 1000;

type VerifierFn = (
  pending: PendingAchievement,
  params:  Record<string, any>,
  uid:     string,
) => Promise<VerificationResult>;

export async function handleVerifyRoute(
  req:         NextRequest,
  claimType:   string,
  runVerifier: VerifierFn,
): Promise<NextResponse> {
  // ── SECURITY: Rate limiting ─────────────────────────────────────────────
  // 10 verify calls per hour per IP — each call may hit Alchemy/GitHub/PageSpeed
  const rateLimited = await rateLimitRequest(req, `verify-${claimType}`, 10, 3600);
  if (rateLimited) return rateLimited;

  let body: { uid?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const uid = body.uid || req.headers.get('x-attestation-uid') || '';
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Pending achievement not found', uid }, { status: 404 });

  const pending: PendingAchievement = typeof raw === 'string' ? JSON.parse(raw) : raw as PendingAchievement;

  if (pending.claimType !== claimType) {
    return NextResponse.json({ error: `Wrong verifier. This is ${claimType}, commitment is ${pending.claimType}` }, { status: 400 });
  }

  const now   = Math.floor(Date.now() / 1000);
  const force = body.force || req.headers.get('x-force-verify') === 'true';

  if (['achieved', 'failed', 'expired'].includes(pending.status) && !force) {
    return NextResponse.json({ uid, status: pending.status, alreadyResolved: true });
  }

  if (pending.status === 'verifying' && pending.lastChecked) {
    if (Date.now() - pending.lastChecked * 1000 < VERIFY_WINDOW_MS && !force) {
      return NextResponse.json({ uid, status: 'verifying', message: 'Verification already in progress' });
    }
  }

  if (!force && pending.deadline > now) {
    return NextResponse.json({
      uid, status: 'pending',
      message:  `${Math.ceil((pending.deadline - now) / 86400)} day(s) remaining.`,
      deadline: new Date(pending.deadline * 1000).toISOString(),
    });
  }

  await redis.set(KEY_PREFIX + uid, JSON.stringify({
    ...pending, status: 'verifying', lastChecked: now,
  } satisfies PendingAchievement), { ex: 90 * 86400 });

  try {
    const params = JSON.parse(pending.verificationParams || '{}');
    const result = await runVerifier(pending, params, uid);

    if (!result.passed) {
      const graceExpired = now > pending.deadline + 86400;
      await redis.set(KEY_PREFIX + uid, JSON.stringify({
        ...pending, status: graceExpired ? 'failed' : 'pending',
        lastChecked: now, failureReason: result.failureReason,
      } satisfies PendingAchievement), { ex: 90 * 86400 });
      return NextResponse.json({ uid, status: graceExpired ? 'failed' : 'pending', passed: false, failureReason: result.failureReason, evidence: result.evidence });
    }

    const onTime       = now <= pending.deadline;
    const daysEarly    = Math.ceil((pending.deadline - now) / 86400);
    const deadlineDays = Math.ceil((pending.deadline - pending.mintTimestamp) / 86400);
    const rawM         = result.evidence.rawMetrics as Record<string, number | string | boolean>;
    const metrics      = buildCertificateMetrics(claimType, rawM, params);

    const thresholds      = extractThresholds(claimType, params);
    const diffResult      = computeDifficulty(claimType, thresholds, []);
    const weightedMetrics = metrics.filter(m => (m.weight ?? 0) > 0);
    const totalWeight     = weightedMetrics.reduce((s, m) => s + (m.weight as number), 0);
    const normMetrics     = weightedMetrics.map(m => ({
      label:    m.label,
      weight:   (m.weight as number) / totalWeight,
      target:   Number(m.target),
      achieved: Number(m.achieved),
    }));

    const scoring = computeScoring({
      metrics:         normMetrics,
      difficultyScore: diffResult.difficulty,
      deadlineDays,
      daysEarly,
      closedEarly:     false,
    });

    const outcome: CertificateOutcome =
      scoring.state === 'full'    ? 'FULL'    :
      scoring.state === 'partial' ? 'PARTIAL' : 'FAILED';
    const proofPoints  = Math.round(scoring.leaderboardPoints);
    const metricsMet   = scoring.perMetric.filter(m => m.met).length;
    const metricsTotal = scoring.perMetric.length;

    const achieved = await attestAchievement({
      agentId:              pending.subject as `0x${string}`,
      claimType:            pending.claimType,
      commitmentUID:        uid,
      evidence:             JSON.stringify(result.evidence),
      metric:               buildMetricString(claimType, rawM),
      outcome,
      onTime,
      daysEarly,
      metricsMet,
      metricsTotal,
      proofPoints,
      sid:                  params.sid || '',
      commitmentText: pending.statement || params.commitmentText || buildCommitmentText(pending.claimType, params),
      certificateMetrics:   metrics,
      issuedAt:             now,
      periodStart:          pending.mintTimestamp,
      periodEnd:            pending.deadline,
      deadlineDays,
      commitmentThresholds: thresholds,
      historicalRecords:    [],
    });

    if (!achieved.success) {
      await redis.set(KEY_PREFIX + uid, JSON.stringify({
        ...pending, status: 'pending', lastChecked: now,
      } satisfies PendingAchievement), { ex: 90 * 86400 });
      return NextResponse.json({ uid, passed: true, warning: 'Attestation failed — will retry', error: achieved.error }, { status: 500 });
    }

    await redis.set(KEY_PREFIX + uid, JSON.stringify({
      ...pending, status: 'achieved', lastChecked: now, proofPoints, difficulty: achieved.difficulty,
    } satisfies PendingAchievement), { ex: 90 * 86400 });

    return NextResponse.json({
      uid, status: 'achieved', passed: true, onTime, outcome, proofPoints,
      achievementScore:  scoring.achievementScore,
      badgeTier:         scoring.badgeTier,
      difficulty:        achieved.difficulty,
      bootstrapped:      achieved.bootstrapped,
      achievementTxHash: achieved.achievementTxHash,
      achievementUID:    achieved.achievementUID,
      nftTxHash:         achieved.nftTxHash,
      certificateUrl:    achieved.certificateUrl,
      evidence:          result.evidence,
    });

  } catch (err: unknown) {
    await redis.set(KEY_PREFIX + uid, JSON.stringify({
      ...pending, status: 'pending', lastChecked: now,
    } satisfies PendingAchievement), { ex: 90 * 86400 });
    console.error(`[verify/${claimType}]`, err);
    return NextResponse.json({ error: 'Verification failed', details: String(err) }, { status: 500 });
  }
}

export async function handleGetRoute(req: NextRequest): Promise<NextResponse> {
  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });
  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p: PendingAchievement = typeof raw === 'string' ?
    JSON.parse(raw) : raw as PendingAchievement;
  return NextResponse.json({
    uid, status: p.status, claimType: p.claimType, subject: p.subject,
    deadline:      new Date(p.deadline * 1000).toISOString(),
    failureReason: p.failureReason,
    lastChecked:   p.lastChecked ? new Date(p.lastChecked * 1000).toISOString() : null,
  });
}

// ── Certificate metrics ───────────────────────────────────────────────────────

function buildCertificateMetrics(
  claimType: string,
  raw:       Record<string, number | string | boolean>,
  params:    Record<string, any>,
): CertificateMetric[] {
  const fmt = (v: unknown, d = 1) => typeof v === 'number' ? v.toFixed(d) : String(v ?? '—');

  switch (claimType) {
    case 'x402_payment_reliability':
      return [
        { label: 'Success Rate',        weight: 1.2, target: `${params.minSuccessRate ?? '?'}%`,              achieved: `${fmt(raw.successRate)}%`,          met: (raw.successRate as number) >= (params.minSuccessRate ?? 0) },
        { label: 'Total Volume',        weight: 1.0, target: `$${params.minTotalUSD ?? '?'}`,                 achieved: `$${fmt(raw.totalUSD, 0)}`,           met: (raw.totalUSD as number) >= (params.minTotalUSD ?? 0) },
        { label: 'Distinct Recipients', weight: 0.9, target: String(params.requireDistinctRecipients ?? '—'), achieved: String(raw.distinctRecipients ?? '—'), met: !params.requireDistinctRecipients || (raw.distinctRecipients as number) >= params.requireDistinctRecipients },
        { label: 'Payment Count',       weight: 0,   target: '—',                                             achieved: String(raw.paymentCount ?? '—'),      met: true },
        { label: 'Failed Txns',         weight: 0,   target: '0',                                             achieved: String(raw.failedCount ?? '—'),       met: (raw.failedCount as number) === 0 },
        { label: 'Chain',               weight: 0,   target: 'Base',                                          achieved: 'Base',                              met: true },
      ];
    case 'code_software_delivery':
      return [
        { label: 'Merged PRs',    weight: 1.2, target: String(params.minMergedPRs ?? '?'),    achieved: String(raw.mergedPRCount ?? '—'), met: (raw.mergedPRCount as number) >= (params.minMergedPRs ?? 0) },
        { label: 'Commits',       weight: 0.9, target: String(params.minCommits ?? '?'),      achieved: String(raw.commitCount ?? '—'),   met: (raw.commitCount as number) >= (params.minCommits ?? 0) },
        { label: 'CI Pass Rate',  weight: 0,   target: '100%',                                achieved: `${fmt(raw.ciPassRate)}%`,        met: (raw.ciPassRate as number) >= 100 },
        { label: 'Lines Changed', weight: 0,   target: String(params.minLinesChanged ?? '?'), achieved: `+${raw.linesChanged ?? '—'}`,    met: (raw.linesChanged as number) >= (params.minLinesChanged ?? 0) },
        { label: 'Reviews',       weight: 0,   target: '—',                                   achieved: String(raw.reviewCount ?? '—'),   met: true },
        { label: 'Contributors',  weight: 0,   target: '—',                                   achieved: String(raw.contributorCount ?? '—'), met: true },
      ];
    case 'website_app_delivery':
      return [
        { label: 'Performance Score', weight: 1.0, target: String(params.minPerformanceScore ?? '?'), achieved: String(raw.performanceScore ?? '—'), met: (raw.performanceScore as number) >= (params.minPerformanceScore ?? 0) },
        { label: 'Accessibility',     weight: 0.8, target: String(params.minAccessibility ?? '?'),    achieved: String(raw.accessibility ?? '—'),    met: !params.minAccessibility || (raw.accessibility as number) >= params.minAccessibility },
        { label: 'HTTPS',             weight: 0,   target: 'Required',                                achieved: raw.httpsValid ? 'Yes' : 'No',       met: raw.httpsValid === true },
        { label: 'DNS Verified',      weight: 0,   target: params.requireDnsVerify ? 'Required' : '—', achieved: raw.dnsVerified ? 'Yes' : 'No',     met: !params.requireDnsVerify || raw.dnsVerified === true },
        { label: 'URL',               weight: 0,   target: '—',                                       achieved: String(params.url ?? '—'),           met: true },
      ];
    case 'defi_trading_performance':
      return [
        { label: 'Trade Count', weight: 1.0, target: String(params.minTradeCount ?? '?'), achieved: String(raw.tradeCount ?? '—'), met: (raw.tradeCount as number) >= (params.minTradeCount ?? 0) },
        { label: 'Volume USD',  weight: 1.1, target: `$${params.minVolumeUSD ?? '?'}`,    achieved: `$${fmt(raw.volumeUSD, 0)}`,  met: (raw.volumeUSD as number) >= (params.minVolumeUSD ?? 0) },
        { label: 'P&L %',       weight: 1.3, target: `${params.minPnlPercent ?? '?'}%`,   achieved: `${fmt(raw.pnlPercent)}%`,   met: (raw.pnlPercent as number) >= (params.minPnlPercent ?? 0) },
        { label: 'Chain',       weight: 0,   target: '—',                                  achieved: String(raw.chain ?? params.chain ?? 'base'), met: true },
        { label: 'Protocol',    weight: 0,   target: '—',                                  achieved: String(raw.protocol ?? '—'), met: true },
      ];
    case 'social_media_growth':
      return [
        { label: 'Follower Growth', weight: 1.0, target: `+${params.minFollowerGrowth ?? '?'}%`, achieved: `+${fmt(raw.followerGrowth)}%`, met: (raw.followerGrowth as number) >= (params.minFollowerGrowth ?? 0) },
        { label: 'Engagement Rate', weight: 1.1, target: `${params.minEngagementRate ?? '?'}%`,  achieved: `${fmt(raw.engagementRate)}%`,  met: (raw.engagementRate as number) >= (params.minEngagementRate ?? 0) },
        { label: 'Platform',        weight: 0,   target: '—',                                    achieved: String(raw.platform ?? '—'),    met: true },
      ];
    default: return [];
  }
}

function extractThresholds(claimType: string, params: Record<string, any>): CommitmentThresholds {
  const pick = (keys: string[]) =>
    Object.fromEntries(keys.filter(k => typeof params[k] === 'number').map(k => [k, params[k] as number]));
  switch (claimType) {
    case 'x402_payment_reliability': return pick(['minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours']);
    case 'code_software_delivery':   return pick(['minMergedPRs', 'minCommits', 'minLinesChanged']);
    case 'website_app_delivery':     return pick(['minPerformanceScore', 'minAccessibility']);
    case 'defi_trading_performance': return pick(['minTradeCount', 'minVolumeUSD', 'minPnlPercent']);
    case 'social_media_growth':      return pick(['minFollowerGrowth', 'minEngagementRate']);
    default: return {};
  }
}

function buildCommitmentText(claimType: string, p: Record<string, any>): string {
  switch (claimType) {
    case 'x402_payment_reliability': return `Maintain a payment success rate above ${p.minSuccessRate ?? '?'}%` + (p.minTotalUSD ? ` processing a minimum of $${p.minTotalUSD} USDC` : '') + ' within the commitment window.';
    case 'code_software_delivery':   return `Merge at least ${p.minMergedPRs ?? '?'} pull requests` + (p.repoName ? ` into ${p.repoOwner}/${p.repoName}` : '') + ' within the commitment window.';
    case 'website_app_delivery':     return `Achieve a PageSpeed score of ${p.minPerformanceScore ?? '?'} or above` + (p.url ? ` on ${p.url}` : '') + '.';
    case 'defi_trading_performance': return `Execute at least ${p.minTradeCount ?? '?'} on-chain trades` + (p.minVolumeUSD ? ` with total volume exceeding $${p.minVolumeUSD}` : '') + ' within the commitment window.';
    case 'social_media_growth':      return `Grow follower count by ${p.minFollowerGrowth ?? '?'}%` + ` on ${p.platform || 'Farcaster'} within the commitment window.`;
    default: return 'Complete the committed goal within the verification window.';
  }
}

function buildMetricString(claimType: string, raw: Record<string, number | string | boolean>): string {
  switch (claimType) {
    case 'x402_payment_reliability': return `Success rate: ${raw.successRate}% · Volume: $${raw.totalUSD} · Payments: ${raw.paymentCount}`;
    case 'code_software_delivery':   return `Merged PRs: ${raw.mergedPRCount} · Commits: ${raw.commitCount} · CI: ${raw.ciPassRate}%`;
    case 'website_app_delivery':     return `Performance: ${raw.performanceScore} · Accessibility: ${raw.accessibility}`;
    case 'defi_trading_performance': return `Trades: ${raw.tradeCount} · Volume: $${raw.volumeUSD} · P&L: ${raw.pnlPercent}%`;
    case 'social_media_growth':      return `Follower growth: +${raw.followerGrowth}% · Engagement: ${raw.engagementRate}%`;
    default: return JSON.stringify(raw);
  }
}