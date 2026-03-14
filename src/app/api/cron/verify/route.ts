// src/app/api/cron/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import type { PendingAchievement } from '@/lib/verify/types';

import { verifyX402PaymentReliability } from '@/lib/verify/x402';
import { verifyDefiTradingPerformance }  from '@/lib/verify/defi';
import { verifyCodeSoftwareDelivery }    from '@/lib/verify/github';
import { verifyWebsiteAppDelivery }      from '@/lib/verify/website';
import { verifySocialMediaGrowth }       from '@/lib/verify/social';
import { attestAchievement }             from '@/lib/verify/attest-achievement';
import type { CertificateMetric, CertificateOutcome } from '@/lib/verify/attest-achievement';
import type { CommitmentThresholds }     from '@/lib/difficulty';

export const runtime     = 'nodejs';
export const maxDuration = 60;

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX = 'achievement:pending:';
const STUCK_THRESHOLD_SEC = 15 * 60;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now     = Math.floor(Date.now() / 1000);
  const keys    = await redis.keys(`${KEY_PREFIX}*`);
  const results = { processed: 0, skipped: 0, achieved: 0, failed: 0, errors: 0 };

  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;

    const pending: PendingAchievement = typeof raw === 'string' ? JSON.parse(raw) : raw as PendingAchievement;

    if (['achieved', 'failed', 'expired'].includes(pending.status)) { results.skipped++; continue; }
    if (pending.status === 'verifying' && pending.lastChecked && now - pending.lastChecked < STUCK_THRESHOLD_SEC) { results.skipped++; continue; }
    if (pending.deadline > now) { results.skipped++; continue; }

    await redis.set(key, JSON.stringify({
      ...pending, status: 'verifying', lastChecked: now,
    } satisfies PendingAchievement), { ex: 90 * 86400 });

    try {
      const uid    = pending.attestationUID;
      const params = JSON.parse(pending.verificationParams || '{}');
      const result = await runVerifier(pending, params, uid, now);

      if (!result.passed) {
        const graceExpired = now > pending.deadline + 86400;
        await redis.set(key, JSON.stringify({
          ...pending, status: graceExpired ? 'failed' : 'pending',
          lastChecked: now, failureReason: result.failureReason,
        } satisfies PendingAchievement), { ex: 90 * 86400 });
        results.failed++;
        continue;
      }

      const onTime       = now <= pending.deadline;
      const daysEarly    = Math.ceil((pending.deadline - now) / 86400);
      const deadlineDays = Math.ceil((pending.deadline - pending.mintTimestamp) / 86400);
      const rawM         = result.evidence.rawMetrics as Record<string, number | string | boolean>;
      const metrics      = buildCertificateMetrics(pending.claimType, rawM, params);
      const metricsMet   = metrics.filter(m => m.met).length;
      const metricsTotal = metrics.length;
      const outcome: CertificateOutcome = metricsMet === metricsTotal ? 'FULL'
        : metricsMet > 0 ? 'PARTIAL' : 'FAILED';
      const proofPoints  = computeProofPoints(outcome, daysEarly, deadlineDays, metricsMet, metricsTotal);

      const achieved = await attestAchievement({
        agentId:              pending.subject as `0x${string}`,
        claimType:            pending.claimType,
        commitmentUID:        uid,
        evidence:             JSON.stringify(result.evidence),
        metric:               buildMetricString(pending.claimType, rawM),
        outcome,
        onTime,
        daysEarly,
        metricsMet,
        metricsTotal,
        proofPoints,
        sid:                  params.sid || '',
        commitmentText:       params.commitmentText || buildCommitmentText(pending.claimType, params),
        certificateMetrics:   metrics,
        issuedAt:             now,
        periodStart:          pending.mintTimestamp,
        periodEnd:            pending.deadline,
        deadlineDays,
        commitmentThresholds: extractThresholds(pending.claimType, params),
        historicalRecords:    [],
      });

      if (!achieved.success) {
        await redis.set(key, JSON.stringify({
          ...pending, status: 'pending', lastChecked: now,
        } satisfies PendingAchievement), { ex: 90 * 86400 });
        results.errors++;
        console.error(`[cron] Attestation failed for ${uid}:`, achieved.error);
        continue;
      }

      await redis.set(key, JSON.stringify({
        ...pending, status: 'achieved', lastChecked: now, proofPoints, difficulty: achieved.difficulty,
      } satisfies PendingAchievement), { ex: 90 * 86400 });

      results.achieved++;
      results.processed++;
      console.log(`[cron] ✅ ${uid} ${pending.claimType} outcome=${outcome} proofPoints=${proofPoints} difficulty=${achieved.difficulty}`);

    } catch (err) {
      await redis.set(key, JSON.stringify({
        ...pending, status: 'pending', lastChecked: now,
      } satisfies PendingAchievement), { ex: 90 * 86400 });
      results.errors++;
      console.error(`[cron] Error processing ${pending.attestationUID}:`, err);
    }
  }

  console.log('[cron] Sweep complete:', results);
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...results });
}

// ── Verifier router ───────────────────────────────────────────────────────────

async function runVerifier(pending: PendingAchievement, params: Record<string, any>, uid: string, now: number): Promise<any> {
  switch (pending.claimType) {
    case 'x402_payment_reliability':
      return verifyX402PaymentReliability({ agentWallet: params.agentWallet || pending.subject, windowDays: params.windowDays || 30, minSuccessRate: params.minSuccessRate, minTotalUSD: params.minTotalUSD, requireDistinctRecipients: params.requireDistinctRecipients, maxGapHours: params.maxGapHours, metric: params.metric || 'success_rate', target: params.target || 98, chain: 'base', mintTimestamp: pending.mintTimestamp, baselineSnapshot: params.baselineSnapshot || { txCount: 0, timestamp: pending.mintTimestamp } }, uid);
    case 'defi_trading_performance':
      return verifyDefiTradingPerformance({ agentWallet: params.agentWallet || pending.subject, protocol: params.protocol || 'unknown', windowDays: params.windowDays || 30, mintTimestamp: pending.mintTimestamp, minTradeCount: params.minTradeCount, minVolumeUSD: params.minVolumeUSD, minPnlPercent: params.minPnlPercent }, uid);
    case 'code_software_delivery':
      return verifyCodeSoftwareDelivery({ agentWallet: pending.subject, repoOwner: params.repoOwner, repoName: params.repoName, githubUsername: params.githubUsername, windowDays: params.windowDays || 30, mintTimestamp: pending.mintTimestamp, requireCIPass: params.requireCIPass, minLinesChanged: params.minLinesChanged }, uid);
    case 'website_app_delivery':
      return verifyWebsiteAppDelivery({ agentWallet: pending.subject, url: params.url, dnsVerifyRecord: params.dnsVerifyRecord, windowDays: params.windowDays || 30, mintTimestamp: pending.mintTimestamp, requireHttps: params.requireHttps !== false, requireDnsVerify: params.requireDnsVerify, minPerformanceScore: params.minPerformanceScore, minAccessibility: params.minAccessibility }, uid);
    case 'social_media_growth':
      return verifySocialMediaGrowth({ agentWallet: pending.subject, platform: params.platform || 'farcaster', handle: params.handle, fid: params.fid, windowDays: params.windowDays || 30, mintTimestamp: pending.mintTimestamp, baselineFollowers: params.baselineFollowers || 0, minFollowerGrowth: params.minFollowerGrowth, minEngagementRate: params.minEngagementRate, minPostsPerWeek: params.minPostsPerWeek }, uid);
    default:
      return { passed: false, failureReason: `Unknown claimType: ${pending.claimType}`, evidence: { checkedAt: now, dataSource: 'cron', attestationUID: uid, rawMetrics: {} } };
  }
}

// ── Shared helpers (mirrored from route-handler.ts) ───────────────────────────

function computeProofPoints(outcome: CertificateOutcome, daysEarly: number, deadlineDays: number, metricsMet: number, metricsTotal: number): number {
  const base  = outcome === 'FULL' ? 1000 : outcome === 'PARTIAL' ? 500 : 0;
  const speed = outcome !== 'FAILED' && deadlineDays > 0 ? Math.round(Math.min(daysEarly, deadlineDays) / deadlineDays * 200) : 0;
  const depth = metricsTotal > 0 ? Math.round((metricsMet / metricsTotal) * 200) : 0;
  return Math.min(base + speed + depth, 1400);
}

function extractThresholds(claimType: string, params: Record<string, any>): CommitmentThresholds {
  const pick = (keys: string[]) => Object.fromEntries(keys.filter(k => typeof params[k] === 'number').map(k => [k, params[k] as number]));
  switch (claimType) {
    case 'x402_payment_reliability': return pick(['minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours']);
    case 'code_software_delivery':   return pick(['minMergedPRs', 'minCommits', 'minLinesChanged']);
    case 'website_app_delivery':     return pick(['minPerformanceScore', 'minAccessibility']);
    case 'defi_trading_performance': return pick(['minTradeCount', 'minVolumeUSD', 'minPnlPercent']);
    case 'social_media_growth':      return pick(['minFollowerGrowth', 'minEngagementRate']);
    default: return {};
  }
}

function buildCertificateMetrics(claimType: string, raw: Record<string, number | string | boolean>, params: Record<string, any>): CertificateMetric[] {
  const fmt = (v: unknown, d = 1) => typeof v === 'number' ? v.toFixed(d) : String(v ?? '—');
  switch (claimType) {
    case 'x402_payment_reliability': return [
      { label: 'Success Rate',        target: `${params.minSuccessRate ?? '?'}%`,                    achieved: `${fmt(raw.successRate)}%`,              met: (raw.successRate as number) >= (params.minSuccessRate ?? 0) },
      { label: 'Total Volume',        target: `$${params.minTotalUSD ?? '?'}`,                       achieved: `$${fmt(raw.totalUSD, 0)}`,               met: (raw.totalUSD as number) >= (params.minTotalUSD ?? 0) },
      { label: 'Payment Count',       target: '—',                                                   achieved: String(raw.paymentCount ?? '—'),          met: true },
      { label: 'Distinct Recipients', target: String(params.requireDistinctRecipients ?? '—'),       achieved: String(raw.distinctRecipients ?? '—'),    met: !params.requireDistinctRecipients || (raw.distinctRecipients as number) >= params.requireDistinctRecipients },
      { label: 'Failed Txns',         target: '0',                                                   achieved: String(raw.failedCount ?? '—'),           met: (raw.failedCount as number) === 0 },
      { label: 'Chain',               target: 'Base',                                                achieved: 'Base',                                  met: true },
    ];
    case 'code_software_delivery': return [
      { label: 'Merged PRs',    target: String(params.minMergedPRs ?? '?'),    achieved: String(raw.mergedPRCount ?? '—'), met: (raw.mergedPRCount as number) >= (params.minMergedPRs ?? 0) },
      { label: 'Commits',       target: String(params.minCommits ?? '?'),      achieved: String(raw.commitCount ?? '—'),  met: (raw.commitCount as number) >= (params.minCommits ?? 0) },
      { label: 'CI Pass Rate',  target: '100%',                                achieved: `${fmt(raw.ciPassRate)}%`,       met: (raw.ciPassRate as number) >= 100 },
      { label: 'Lines Changed', target: String(params.minLinesChanged ?? '?'), achieved: `+${raw.linesChanged ?? '—'}`,   met: (raw.linesChanged as number) >= (params.minLinesChanged ?? 0) },
      { label: 'Reviews',       target: '—',                                   achieved: String(raw.reviewCount ?? '—'), met: true },
      { label: 'Contributors',  target: '—',                                   achieved: String(raw.contributorCount ?? '—'), met: true },
    ];
    case 'website_app_delivery': return [
      { label: 'Performance',   target: String(params.minPerformanceScore ?? '?'), achieved: String(raw.performance ?? '—'),  met: (raw.performance as number) >= (params.minPerformanceScore ?? 0) },
      { label: 'Accessibility', target: String(params.minAccessibility ?? '?'),    achieved: String(raw.accessibility ?? '—'),met: (raw.accessibility as number) >= (params.minAccessibility ?? 0) },
      { label: 'LCP',           target: '—',                                       achieved: `${fmt(raw.lcp, 1)}s`,           met: true },
      { label: 'DNS Verified',  target: 'Yes',                                     achieved: raw.dnsVerified ? 'Yes' : 'No',  met: !!raw.dnsVerified },
      { label: 'HTTPS',         target: 'Valid',                                   achieved: raw.https ? 'Valid' : 'No',      met: !!raw.https },
      { label: 'URLScan',       target: 'OK',                                      achieved: String(raw.urlscanStatus ?? 'OK'), met: raw.urlscanStatus === 'OK' || !raw.urlscanStatus },
    ];
    case 'defi_trading_performance': return [
      { label: 'Trade Count',  target: String(params.minTradeCount ?? '?'), achieved: String(raw.tradeCount ?? '—'),  met: (raw.tradeCount as number) >= (params.minTradeCount ?? 0) },
      { label: 'Total Volume', target: `$${params.minVolumeUSD ?? '?'}`,    achieved: `$${fmt(raw.volumeUSD, 0)}`,    met: (raw.volumeUSD as number) >= (params.minVolumeUSD ?? 0) },
      { label: 'Realised P&L', target: `${params.minPnlPercent ?? '?'}%`,  achieved: `${fmt(raw.pnlPercent)}%`,      met: (raw.pnlPercent as number) >= (params.minPnlPercent ?? 0) },
      { label: 'Avg Trade',    target: '—',                                 achieved: `$${fmt(raw.avgTradeUSD, 0)}`, met: true },
      { label: 'Protocols',    target: '—',                                 achieved: String(raw.protocolCount ?? '—'), met: true },
      { label: 'Gas Spent',    target: '—',                                 achieved: `$${fmt(raw.gasUSD, 2)}`,      met: true },
    ];
    case 'social_media_growth': return [
      { label: 'Follower Growth', target: `+${params.minFollowerGrowth ?? '?'}%`, achieved: `+${fmt(raw.followerGrowth)}%`,  met: (raw.followerGrowth as number) >= (params.minFollowerGrowth ?? 0) },
      { label: 'Engagement Rate', target: `${params.minEngagementRate ?? '?'}%`,  achieved: `${fmt(raw.engagementRate)}%`,   met: (raw.engagementRate as number) >= (params.minEngagementRate ?? 0) },
      { label: 'Posts Published', target: '—',                                    achieved: String(raw.postCount ?? '—'),    met: true },
      { label: 'Replies',         target: '—',                                    achieved: String(raw.replyCount ?? '—'),   met: true },
      { label: 'Recasts',         target: '—',                                    achieved: String(raw.recastCount ?? '—'),  met: true },
      { label: 'Platform',        target: '—',                                    achieved: String(raw.platform ?? '—'),     met: true },
    ];
    default: return [];
  }
}

function buildCommitmentText(claimType: string, p: Record<string, any>): string {
  switch (claimType) {
    case 'x402_payment_reliability': return `Maintain a payment success rate above ${p.minSuccessRate ?? '?'}%` + (p.minTotalUSD ? ` processing a minimum of $${p.minTotalUSD} USDC` : '') + ' within the commitment window.';
    case 'code_software_delivery':   return `Merge at least ${p.minMergedPRs ?? '?'} pull requests` + (p.repoName ? ` into ${p.repoOwner}/${p.repoName}` : '') + ' with CI passing.';
    case 'website_app_delivery':     return `Achieve a PageSpeed score of ${p.minPerformanceScore ?? '?'} or above` + (p.url ? ` on ${p.url}` : '') + '.';
    case 'defi_trading_performance': return `Execute at least ${p.minTradeCount ?? '?'} on-chain trades` + (p.minVolumeUSD ? ` with total volume exceeding $${p.minVolumeUSD}` : '') + '.';
    case 'social_media_growth':      return `Grow following by ${p.minFollowerGrowth ?? '?'}% or more` + (p.minEngagementRate ? ` with an engagement rate above ${p.minEngagementRate}%` : '') + '.';
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