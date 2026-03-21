// src/app/api/cron/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import type { PendingAchievement } from '@/lib/verify/types';

import { verifyX402PaymentReliability } from '@/lib/verify/x402';
import { verifyDefiTradingPerformance }  from '@/lib/verify/defi';
import { verifyCodeSoftwareDelivery }    from '@/lib/verify/github';
import { verifyWebsiteAppDelivery }      from '@/lib/verify/website';
import { attestAchievement }             from '@/lib/verify/attest-achievement';
import { computeScoring }                from '@/lib/verify/scoring';
import { computeDifficulty }             from '@/lib/difficulty';
import type { CertificateMetric, CertificateOutcome } from '@/lib/verify/attest-achievement';
import type { CommitmentThresholds }     from '@/lib/difficulty';

export const runtime     = 'nodejs';
export const maxDuration = 60;

const redis               = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX          = 'achievement:pending:';
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

      // ── v2 scoring ─────────────────────────────────────────────────────
      const thresholds      = extractThresholds(pending.claimType, params);
      const diffResult      = computeDifficulty(pending.claimType, thresholds, []);
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
      // ───────────────────────────────────────────────────────────────────

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
      console.log(`[cron] ✅ ${uid} ${pending.claimType} outcome=${outcome} achievementScore=${scoring.achievementScore} proofPoints=${proofPoints} difficulty=${achieved.difficulty}`);

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

async function runVerifier(
  pending: PendingAchievement,
  params:  Record<string, any>,
  uid:     string,
  now:     number,
): Promise<any> {
  switch (pending.claimType) {

    case 'x402_payment_reliability':
      return verifyX402PaymentReliability({
        agentWallet:               params.agentWallet || pending.subject,
        windowDays:                params.windowDays || 30,
        minSuccessRate:            params.minSuccessRate,
        minTotalUSD:               params.minTotalUSD,
        requireDistinctRecipients: params.requireDistinctRecipients,
        maxGapHours:               params.maxGapHours,
        metric:                    params.metric || 'success_rate',
        target:                    params.target || 98,
        chain:                     'base',
        mintTimestamp:             pending.mintTimestamp,
        baselineSnapshot:          params.baselineSnapshot || { txCount: 0, timestamp: pending.mintTimestamp },
      }, uid);

    case 'defi_trading_performance':
      return verifyDefiTradingPerformance({
        agentWallet:   params.agentWallet || pending.subject,
        protocol:      params.protocol || 'unknown',
        chain:         params.chain ?? 'base',   // 'base' | 'solana'
        windowDays:    params.windowDays || 30,
        mintTimestamp: pending.mintTimestamp,
        minTradeCount: params.minTradeCount,
        minVolumeUSD:  params.minVolumeUSD,
        minPnlPercent: params.minPnlPercent,
      }, uid);

    case 'code_software_delivery':
      return verifyCodeSoftwareDelivery({
        agentWallet:     pending.subject,
        repoOwner:       params.repoOwner,
        repoName:        params.repoName,
        githubUsername:  params.githubUsername,
        walletGithubSig: params.walletGithubSig,
        windowDays:      params.windowDays || 30,
        mintTimestamp:   pending.mintTimestamp,
        requireCIPass:   params.requireCIPass,
        minMergedPRs:    params.minMergedPRs,
        minCommits:      params.minCommits,
        minLinesChanged: params.minLinesChanged,
      }, uid);

    case 'website_app_delivery':
      return verifyWebsiteAppDelivery({
        agentWallet:         pending.subject,
        url:                 params.url,
        dnsVerifyRecord:     params.dnsVerifyRecord,
        windowDays:          params.windowDays || 30,
        mintTimestamp:       pending.mintTimestamp,
        requireHttps:        params.requireHttps !== false,
        requireDnsVerify:    params.requireDnsVerify,
        minPerformanceScore: params.minPerformanceScore,
        minAccessibility:    params.minAccessibility,
      }, uid);

    case 'social_media_growth':
      // Temporarily disabled — graceful skip so existing Redis entries don't block the sweep
      return {
        passed:        false,
        failureReason: 'Social Media Growth verification is temporarily unavailable while the category is being reworked.',
        evidence:      { checkedAt: now, dataSource: 'disabled', attestationUID: uid, rawMetrics: { platform: params.platform ?? 'unknown' } },
      };

    default:
      return {
        passed:        false,
        failureReason: `Unknown claimType: ${pending.claimType}`,
        evidence:      { checkedAt: now, dataSource: 'cron', attestationUID: uid, rawMetrics: {} },
      };
  }
}

// ── Certificate metrics ───────────────────────────────────────────────────────
// weight > 0  = scored (participates in achievement score)
// weight = 0  = display-only (shown in SVG table, not scored)

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
      // Kept for display of legacy commitments — category disabled for new mints
      return [
        { label: 'Follower Growth', weight: 1.0, target: `+${params.minFollowerGrowth ?? '?'}%`, achieved: `+${fmt(raw.followerGrowth)}%`, met: (raw.followerGrowth as number) >= (params.minFollowerGrowth ?? 0) },
        { label: 'Engagement Rate', weight: 1.1, target: `${params.minEngagementRate ?? '?'}%`,  achieved: `${fmt(raw.engagementRate)}%`,  met: (raw.engagementRate as number) >= (params.minEngagementRate ?? 0) },
        { label: 'Platform',        weight: 0,   target: '—',                                    achieved: String(raw.platform ?? '—'),    met: true },
      ];
    default: return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    case 'x402_payment_reliability': return `Maintain a payment success rate above ${p.minSuccessRate ?? '?'}%` + (p.minTotalUSD ? ` processing a minimum of $${p.minTotalUSD} USDC` : '') + (p.requireDistinctRecipients ? ` across ${p.requireDistinctRecipients}+ distinct recipients` : '') + ' within the commitment window.';
    case 'code_software_delivery':   return `Merge at least ${p.minMergedPRs ?? '?'} pull requests` + (p.repoName ? ` into ${p.repoOwner}/${p.repoName}` : '') + ' with CI passing within the commitment window.';
    case 'website_app_delivery':     return `Achieve a PageSpeed score of ${p.minPerformanceScore ?? '?'} or above` + (p.url ? ` on ${p.url}` : '') + (p.requireDnsVerify ? ', verified via DNS TXT record ownership.' : '.');
    case 'defi_trading_performance': return `Execute at least ${p.minTradeCount ?? '?'} on-chain trades` + (p.minVolumeUSD ? ` with total volume exceeding $${p.minVolumeUSD}` : '') + (p.minPnlPercent ? ` and a positive P&L above ${p.minPnlPercent}%` : '') + ` on ${p.chain === 'solana' ? 'Solana' : 'Base'} within the commitment window.`;
    case 'social_media_growth':      return `Grow follower count by ${p.minFollowerGrowth ?? '?'}%` + (p.minEngagementRate ? ` with engagement above ${p.minEngagementRate}%` : '') + ` on ${p.platform || 'Farcaster'} within the commitment window.`;
    default: return 'Complete the committed goal within the verification window.';
  }
}

function buildMetricString(claimType: string, raw: Record<string, number | string | boolean>): string {
  switch (claimType) {
    case 'x402_payment_reliability': return `Success rate: ${raw.successRate}% · Volume: $${raw.totalUSD} · Payments: ${raw.paymentCount}`;
    case 'code_software_delivery':   return `Merged PRs: ${raw.mergedPRCount} · Commits: ${raw.commitCount} · CI: ${raw.ciPassRate}%`;
    case 'website_app_delivery':     return `Performance: ${raw.performanceScore} · Accessibility: ${raw.accessibility}`;
    case 'defi_trading_performance': return `Trades: ${raw.tradeCount} · Volume: $${raw.volumeUSD} · P&L: ${raw.pnlPercent}% · Chain: ${raw.chain ?? 'base'}`;
    case 'social_media_growth':      return `Follower growth: +${raw.followerGrowth}% · Engagement: ${raw.engagementRate}%`;
    default: return JSON.stringify(raw);
  }
}