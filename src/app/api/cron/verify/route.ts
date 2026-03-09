// src/app/api/cron/verify/route.ts
// Hourly sweep of all pending achievements in Redis.
// Routes each entry to the correct verifier based on claimType.
// Protected by CRON_SECRET env var.
// Add to vercel.json: { "crons": [{ "path": "/api/cron/verify", "schedule": "0 * * * *" }] }

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import type { PendingAchievement } from '@/lib/verify/types';

import { verifyX402PaymentReliability } from '@/lib/verify/x402';
import { verifyDefiTradingPerformance }  from '@/lib/verify/defi';
import { verifyCodeSoftwareDelivery }    from '@/lib/verify/github';
import { verifyWebsiteAppDelivery }      from '@/lib/verify/website';
import { verifySocialMediaGrowth }       from '@/lib/verify/social';
import { attestAchievement }             from '@/lib/verify/attest-achievement';
import type { CertificateMetric }        from '@/lib/verify/attest-achievement';
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

    const pending: PendingAchievement = typeof raw === 'string'
      ? JSON.parse(raw)
      : raw as PendingAchievement;

    if (['achieved', 'failed', 'expired'].includes(pending.status)) {
      results.skipped++;
      continue;
    }

    if (pending.status === 'verifying' && pending.lastChecked) {
      if (now - pending.lastChecked < STUCK_THRESHOLD_SEC) {
        results.skipped++;
        continue;
      }
    }

    if (pending.deadline > now) {
      results.skipped++;
      continue;
    }

    await redis.set(key, JSON.stringify({
      ...pending,
      status:      'verifying',
      lastChecked: now,
    } satisfies PendingAchievement), { ex: 90 * 86400 });

    try {
      const uid    = pending.attestationUID;
      const params = JSON.parse(pending.verificationParams || '{}');
      const result = await runVerifier(pending, params, uid, now);

      if (!result.passed) {
        const graceExpired = now > pending.deadline + 86400;
        await redis.set(key, JSON.stringify({
          ...pending,
          status:        graceExpired ? 'failed' : 'pending',
          lastChecked:   now,
          failureReason: result.failureReason,
        } satisfies PendingAchievement), { ex: 90 * 86400 });
        results.failed++;
        continue;
      }

      const onTime    = now <= pending.deadline;
      const daysEarly = Math.ceil((pending.deadline - now) / 86400);
      const rawM      = result.evidence.rawMetrics as Record<string, number | string | boolean>;

      const achieved = await attestAchievement({
        agentId:              pending.subject as `0x${string}`,
        claimType:            pending.claimType,
        commitmentUID:        uid,
        evidence:             JSON.stringify(result.evidence),
        metric:               buildMetricString(pending.claimType, rawM),
        onTime,
        sid:                  params.sid || '',
        commitmentText:       params.commitmentText || buildCommitmentText(pending.claimType, params),
        certificateMetrics:   buildCertificateMetrics(pending.claimType, rawM),
        committedDate:        pending.mintTimestamp,
        deadline:             pending.deadline,
        achievedDate:         now,
        daysEarly,
        commitmentThresholds: extractThresholds(pending.claimType, params),
        historicalRecords:    [], // bootstrap mode until N≥50 per claim type
      });

      if (!achieved.success) {
        await redis.set(key, JSON.stringify({
          ...pending,
          status:      'pending',
          lastChecked: now,
        } satisfies PendingAchievement), { ex: 90 * 86400 });
        results.errors++;
        console.error(`[cron] Attestation failed for ${uid}:`, achieved.error);
        continue;
      }

      await redis.set(key, JSON.stringify({
        ...pending,
        status:      'achieved',
        lastChecked: now,
      } satisfies PendingAchievement), { ex: 90 * 86400 });

      results.achieved++;
      results.processed++;
      console.log(
        `[cron] ✅ ${uid} ${pending.claimType}` +
        ` difficulty=${achieved.difficulty} bootstrapped=${achieved.bootstrapped}`
      );

    } catch (err) {
      await redis.set(key, JSON.stringify({
        ...pending,
        status:      'pending',
        lastChecked: now,
      } satisfies PendingAchievement), { ex: 90 * 86400 });
      results.errors++;
      console.error(`[cron] Error processing ${pending.attestationUID}:`, err);
    }
  }

  console.log('[cron] Sweep complete:', results);
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...results });
}

// ── Verifier router ────────────────────────────────────────────────────────────

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
        windowDays:                params.windowDays  || 30,
        minSuccessRate:            params.minSuccessRate,
        minTotalUSD:               params.minTotalUSD,
        requireDistinctRecipients: params.requireDistinctRecipients,
        maxGapHours:               params.maxGapHours,
        metric:                    params.metric      || 'success_rate',
        target:                    params.target      || 98,
        chain:                     'base',
        mintTimestamp:             pending.mintTimestamp,
        baselineSnapshot:          params.baselineSnapshot || {
          txCount: 0, timestamp: pending.mintTimestamp,
        },
      }, uid);

    case 'defi_trading_performance':
      return verifyDefiTradingPerformance({
        agentWallet:   params.agentWallet || pending.subject,
        protocol:      params.protocol    || 'unknown',
        windowDays:    params.windowDays  || 30,
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
        windowDays:      params.windowDays  || 30,
        mintTimestamp:   pending.mintTimestamp,
        requireCIPass:   params.requireCIPass,
        minLinesChanged: params.minLinesChanged,
      }, uid);

    case 'website_app_delivery':
      return verifyWebsiteAppDelivery({
        agentWallet:         pending.subject,
        url:                 params.url,
        dnsVerifyRecord:     params.dnsVerifyRecord,
        windowDays:          params.windowDays     || 30,
        mintTimestamp:       pending.mintTimestamp,
        requireHttps:        params.requireHttps   !== false,
        requireDnsVerify:    params.requireDnsVerify,
        minPerformanceScore: params.minPerformanceScore,
        minAccessibility:    params.minAccessibility,
      }, uid);

    case 'social_media_growth':
      return verifySocialMediaGrowth({
        agentWallet:       pending.subject,
        platform:          params.platform         || 'farcaster',
        handle:            params.handle,
        fid:               params.fid,
        windowDays:        params.windowDays        || 30,
        mintTimestamp:     pending.mintTimestamp,
        baselineFollowers: params.baselineFollowers || 0,
        minFollowerGrowth: params.minFollowerGrowth,
        minEngagementRate: params.minEngagementRate,
        minPostsPerWeek:   params.minPostsPerWeek,
      }, uid);

    default:
      return {
        passed:        false,
        failureReason: `Unknown claimType: ${pending.claimType}`,
        evidence: {
          checkedAt: now, dataSource: 'cron',
          attestationUID: uid, rawMetrics: {},
        },
      };
  }
}

// ── Threshold extractor ────────────────────────────────────────────────────────

function extractThresholds(
  claimType: string,
  params: Record<string, any>,
): CommitmentThresholds {
  const pick = (keys: string[]) =>
    Object.fromEntries(
      keys
        .filter(k => typeof params[k] === 'number')
        .map(k => [k, params[k] as number])
    );

  switch (claimType) {
    case 'x402_payment_reliability':
      return pick(['minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours']);
    case 'code_software_delivery':
      return pick(['minMergedPRs', 'minCommits', 'minLinesChanged']);
    case 'website_app_delivery':
      return pick(['minPerformanceScore', 'minAccessibility']);
    case 'defi_trading_performance':
      return pick(['minTradeCount', 'minVolumeUSD', 'minPnlPercent']);
    case 'social_media_growth':
      return pick(['minFollowerGrowth', 'minEngagementRate']);
    default:
      return {};
  }
}

// ── Certificate metrics builder ────────────────────────────────────────────────

function buildCertificateMetrics(
  claimType: string,
  raw: Record<string, number | string | boolean>,
): CertificateMetric[] {
  const n = (v: unknown, d = 1) =>
    typeof v === 'number' ? v.toFixed(d) : String(v ?? '—');

  switch (claimType) {
    case 'x402_payment_reliability':
      return [
        { label: 'Success Rate',         value: `${n(raw.successRate)}%`,              accent: true  },
        { label: 'Total Volume',          value: `$${n(raw.totalUSD, 0)}`,              accent: false },
        { label: 'Distinct Recipients',   value: String(raw.distinctRecipients ?? '—'), accent: false },
        { label: 'Payment Count',         value: String(raw.paymentCount ?? '—'),       accent: false },
        { label: 'Failed Txns',           value: String(raw.failedCount ?? '—'),        accent: false },
        { label: 'Chain',                 value: 'Base',                                accent: false },
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
        { label: 'Performance',   value: String(raw.performance ?? '—'),      accent: true  },
        { label: 'Accessibility', value: String(raw.accessibility ?? '—'),    accent: false },
        { label: 'LCP',           value: `${n(raw.lcp, 1)}s`,                accent: false },
        { label: 'DNS Verified',  value: raw.dnsVerified ? 'Yes' : 'No',     accent: false },
        { label: 'HTTPS',         value: raw.https ? 'Valid' : 'No',         accent: false },
        { label: 'URLScan',       value: String(raw.urlscanStatus ?? 'OK'),  accent: false },
      ];
    case 'defi_trading_performance':
      return [
        { label: 'Trade Count',  value: String(raw.tradeCount ?? '—'),        accent: true  },
        { label: 'Total Volume', value: `$${n(raw.volumeUSD, 0)}`,            accent: false },
        { label: 'Realised P&L', value: `${n(raw.pnlPercent)}%`,              accent: false },
        { label: 'Avg Trade',    value: `$${n(raw.avgTradeUSD, 0)}`,          accent: false },
        { label: 'Protocols',    value: String(raw.protocolCount ?? '—'),     accent: false },
        { label: 'Gas Spent',    value: `$${n(raw.gasUSD, 2)}`,               accent: false },
      ];
    case 'social_media_growth':
      return [
        { label: 'Follower Growth',  value: `+${n(raw.followerGrowth)}%`,    accent: true  },
        { label: 'Engagement Rate',  value: `${n(raw.engagementRate)}%`,     accent: false },
        { label: 'Posts Published',  value: String(raw.postCount ?? '—'),    accent: false },
        { label: 'Replies',          value: String(raw.replyCount ?? '—'),   accent: false },
        { label: 'Recasts',          value: String(raw.recastCount ?? '—'),  accent: false },
        { label: 'Platform',         value: String(raw.platform ?? '—'),     accent: false },
      ];
    default:
      return [];
  }
}

// ── Commitment text fallback ───────────────────────────────────────────────────

function buildCommitmentText(claimType: string, params: Record<string, any>): string {
  switch (claimType) {
    case 'x402_payment_reliability':
      return `Maintain a payment success rate above ${params.minSuccessRate ?? '?'}%` +
        (params.minTotalUSD ? ` processing a minimum of $${params.minTotalUSD} USDC` : '') +
        (params.requireDistinctRecipients ? ` across ${params.requireDistinctRecipients}+ distinct recipients` : '') +
        ' within the commitment window.';
    case 'code_software_delivery':
      return `Merge at least ${params.minMergedPRs ?? '?'} pull requests` +
        (params.repoName ? ` into ${params.repoOwner}/${params.repoName}` : '') +
        ' with CI passing within the commitment window.';
    case 'website_app_delivery':
      return `Achieve a PageSpeed score of ${params.minPerformanceScore ?? '?'} or above` +
        (params.url ? ` on ${params.url}` : '') +
        (params.requireDnsVerify ? ', verified via DNS TXT record ownership.' : '.');
    case 'defi_trading_performance':
      return `Execute at least ${params.minTradeCount ?? '?'} on-chain trades` +
        (params.minVolumeUSD ? ` with total volume exceeding $${params.minVolumeUSD}` : '') +
        (params.minPnlPercent ? ` and a positive P&L above ${params.minPnlPercent}%` : '') +
        ' within the commitment window.';
    case 'social_media_growth':
      return `Grow following by ${params.minFollowerGrowth ?? '?'}% or more` +
        (params.minEngagementRate ? ` with an engagement rate above ${params.minEngagementRate}%` : '') +
        ' over the measurement window.';
    default:
      return 'Achievement commitment.';
  }
}

// ── Metric string (for EAS evidence field) ────────────────────────────────────

function buildMetricString(
  claimType: string,
  metrics: Record<string, number | string | boolean>,
): string {
  const n = (v: unknown, d = 1) => typeof v === 'number' ? v.toFixed(d) : String(v ?? '?');
  switch (claimType) {
    case 'x402_payment_reliability':
      return `${metrics.paymentCount} payments · ${n(metrics.successRate)}% success · $${n(metrics.totalUSD, 2)}`;
    case 'defi_trading_performance':
      return `${metrics.tradeCount} trades · $${n(metrics.volumeUSD, 0)} volume · ${n(metrics.pnlPercent)}% PnL`;
    case 'code_software_delivery':
      return `${metrics.mergedPRCount} PRs · ${metrics.commitCount} commits · ${metrics.linesChanged} lines`;
    case 'website_app_delivery':
      return `perf=${metrics.performance}/100 · a11y=${metrics.accessibility}/100`;
    case 'social_media_growth':
      return `+${metrics.followerGrowth} followers · ${n(metrics.engagementRate)}% engagement`;
    default:
      return 'Achievement verified';
  }
}