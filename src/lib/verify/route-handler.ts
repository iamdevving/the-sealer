// src/lib/verify/route-handler.ts
// Shared POST/GET logic for all individual verifier routes.

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { attestAchievement } from '@/lib/verify/attest-achievement';
import type { CertificateMetric } from '@/lib/verify/attest-achievement';
import type { CommitmentThresholds } from '@/lib/difficulty';
import type { PendingAchievement, VerificationResult } from '@/lib/verify/types';

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
  if (['achieved', 'failed', 'expired'].includes(pending.status)) {
    return NextResponse.json({ uid, status: pending.status, alreadyResolved: true });
  }

  const now   = Math.floor(Date.now() / 1000);
  const force = body.force || req.headers.get('x-force-verify') === 'true';

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

  await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'verifying', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });

  try {
    const params = JSON.parse(pending.verificationParams || '{}');
    const result = await runVerifier(pending, params, uid);

    if (!result.passed) {
      const graceExpired = now > pending.deadline + 86400;
      await redis.set(KEY_PREFIX + uid, JSON.stringify({
        ...pending, status: graceExpired ? 'failed' : 'pending', lastChecked: now, failureReason: result.failureReason,
      } satisfies PendingAchievement), { ex: 90 * 86400 });
      return NextResponse.json({ uid, status: graceExpired ? 'failed' : 'pending', passed: false, failureReason: result.failureReason, evidence: result.evidence });
    }

    const onTime    = now <= pending.deadline;
    const daysEarly = Math.ceil((pending.deadline - now) / 86400);
    const rawM      = result.evidence.rawMetrics as Record<string, number | string | boolean>;

    const achieved = await attestAchievement({
      agentId:              pending.subject as `0x${string}`,
      claimType:            pending.claimType,
      commitmentUID:        uid,
      evidence:             JSON.stringify(result.evidence),
      metric:               buildMetricString(claimType, rawM),
      onTime,
      sid:                  params.sid || '',
      commitmentText:       params.commitmentText || buildCommitmentText(claimType, params),
      certificateMetrics:   buildCertificateMetrics(claimType, rawM),
      committedDate:        pending.mintTimestamp,
      deadline:             pending.deadline,
      achievedDate:         now,
      daysEarly,
      commitmentThresholds: extractThresholds(claimType, params),
      historicalRecords:    [],
    });

    if (!achieved.success) {
      await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'pending', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });
      return NextResponse.json({ uid, passed: true, warning: 'Attestation failed — will retry', error: achieved.error }, { status: 500 });
    }

    await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'achieved', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });

    return NextResponse.json({
      uid, status: 'achieved', passed: true, onTime,
      difficulty:        achieved.difficulty,
      bootstrapped:      achieved.bootstrapped,
      achievementTxHash: achieved.achievementTxHash,
      achievementUID:    achieved.achievementUID,
      nftTxHash:         achieved.nftTxHash,
      evidence:          result.evidence,
    });

  } catch (err: unknown) {
    await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'pending', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });
    console.error(`[verify/${claimType}]`, err);
    return NextResponse.json({ error: 'Verification failed', details: String(err) }, { status: 500 });
  }
}

export async function handleGetRoute(req: NextRequest): Promise<NextResponse> {
  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });
  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p: PendingAchievement = typeof raw === 'string' ? JSON.parse(raw) : raw as PendingAchievement;
  return NextResponse.json({
    uid, status: p.status, claimType: p.claimType, subject: p.subject,
    deadline: new Date(p.deadline * 1000).toISOString(),
    failureReason: p.failureReason,
    lastChecked: p.lastChecked ? new Date(p.lastChecked * 1000).toISOString() : null,
  });
}

// ── Internals ─────────────────────────────────────────────────────────────────

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

function buildCertificateMetrics(claimType: string, raw: Record<string, number | string | boolean>): CertificateMetric[] {
  const n = (v: unknown, d = 1) => typeof v === 'number' ? v.toFixed(d) : String(v ?? '—');
  switch (claimType) {
    case 'x402_payment_reliability':
      return [
        { label: 'Success Rate',       value: `${n(raw.successRate)}%`,            accent: true  },
        { label: 'Total Volume',        value: `$${n(raw.totalUSD, 0)}`,            accent: false },
        { label: 'Distinct Recipients', value: String(raw.distinctRecipients ?? '—'), accent: false },
        { label: 'Payment Count',       value: String(raw.paymentCount ?? '—'),     accent: false },
        { label: 'Failed Txns',         value: String(raw.failedCount ?? '—'),      accent: false },
        { label: 'Chain',               value: 'Base',                              accent: false },
      ];
    case 'code_software_delivery':
      return [
        { label: 'Merged PRs',    value: String(raw.mergedPRCount ?? '—'),    accent: true  },
        { label: 'Commits',       value: String(raw.commitCount ?? '—'),      accent: false },
        { label: 'CI Pass Rate',  value: `${n(raw.ciPassRate)}%`,             accent: false },
        { label: 'Reviews',       value: String(raw.reviewCount ?? '—'),      accent: false },
        { label: 'Lines Changed', value: `+${raw.linesChanged ?? '—'}`,       accent: false },
        { label: 'Contributors',  value: String(raw.contributorCount ?? '—'), accent: false },
      ];
    case 'website_app_delivery':
      return [
        { label: 'Performance',   value: String(raw.performance ?? '—'),    accent: true  },
        { label: 'Accessibility', value: String(raw.accessibility ?? '—'),  accent: false },
        { label: 'LCP',           value: `${n(raw.lcp, 1)}s`,              accent: false },
        { label: 'DNS Verified',  value: raw.dnsVerified ? 'Yes' : 'No',   accent: false },
        { label: 'HTTPS',         value: raw.https ? 'Valid' : 'No',       accent: false },
        { label: 'URLScan',       value: String(raw.urlscanStatus ?? 'OK'),accent: false },
      ];
    case 'defi_trading_performance':
      return [
        { label: 'Trade Count',  value: String(raw.tradeCount ?? '—'),     accent: true  },
        { label: 'Total Volume', value: `$${n(raw.volumeUSD, 0)}`,         accent: false },
        { label: 'Realised P&L', value: `${n(raw.pnlPercent)}%`,           accent: false },
        { label: 'Avg Trade',    value: `$${n(raw.avgTradeUSD, 0)}`,       accent: false },
        { label: 'Protocols',    value: String(raw.protocolCount ?? '—'),  accent: false },
        { label: 'Gas Spent',    value: `$${n(raw.gasUSD, 2)}`,            accent: false },
      ];
    case 'social_media_growth':
      return [
        { label: 'Follower Growth', value: `+${n(raw.followerGrowth)}%`,  accent: true  },
        { label: 'Engagement Rate', value: `${n(raw.engagementRate)}%`,   accent: false },
        { label: 'Posts Published', value: String(raw.postCount ?? '—'),  accent: false },
        { label: 'Replies',         value: String(raw.replyCount ?? '—'), accent: false },
        { label: 'Recasts',         value: String(raw.recastCount ?? '—'),accent: false },
        { label: 'Platform',        value: String(raw.platform ?? '—'),   accent: false },
      ];
    default: return [];
  }
}

function buildCommitmentText(claimType: string, p: Record<string, any>): string {
  switch (claimType) {
    case 'x402_payment_reliability':
      return `Maintain a payment success rate above ${p.minSuccessRate ?? '?'}%` +
        (p.minTotalUSD ? ` processing a minimum of $${p.minTotalUSD} USDC` : '') +
        (p.requireDistinctRecipients ? ` across ${p.requireDistinctRecipients}+ distinct recipients` : '') +
        ' within the commitment window.';
    case 'code_software_delivery':
      return `Merge at least ${p.minMergedPRs ?? '?'} pull requests` +
        (p.repoName ? ` into ${p.repoOwner}/${p.repoName}` : '') + ' with CI passing within the commitment window.';
    case 'website_app_delivery':
      return `Achieve a PageSpeed score of ${p.minPerformanceScore ?? '?'} or above` +
        (p.url ? ` on ${p.url}` : '') + (p.requireDnsVerify ? ', verified via DNS TXT record ownership.' : '.');
    case 'defi_trading_performance':
      return `Execute at least ${p.minTradeCount ?? '?'} on-chain trades` +
        (p.minVolumeUSD ? ` with total volume exceeding $${p.minVolumeUSD}` : '') +
        (p.minPnlPercent ? ` and a positive P&L above ${p.minPnlPercent}%` : '') + ' within the commitment window.';
    case 'social_media_growth':
      return `Grow following by ${p.minFollowerGrowth ?? '?'}% or more` +
        (p.minEngagementRate ? ` with an engagement rate above ${p.minEngagementRate}%` : '') + ' over the measurement window.';
    default: return 'Achievement commitment.';
  }
}

function buildMetricString(claimType: string, m: Record<string, number | string | boolean>): string {
  const n = (v: unknown, d = 1) => typeof v === 'number' ? v.toFixed(d) : String(v ?? '?');
  switch (claimType) {
    case 'x402_payment_reliability': return `${m.paymentCount} payments · ${n(m.successRate)}% success · $${n(m.totalUSD, 2)}`;
    case 'defi_trading_performance': return `${m.tradeCount} trades · $${n(m.volumeUSD, 0)} volume · ${n(m.pnlPercent)}% PnL`;
    case 'code_software_delivery':   return `${m.mergedPRCount} PRs · ${m.commitCount} commits · ${m.linesChanged} lines`;
    case 'website_app_delivery':     return `perf=${m.performance}/100 · a11y=${m.accessibility}/100`;
    case 'social_media_growth':      return `+${m.followerGrowth} followers · ${n(m.engagementRate)}% engagement`;
    default: return 'Achievement verified';
  }
}
