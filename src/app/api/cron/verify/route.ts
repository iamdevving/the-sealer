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
import { attestAchievement, calculateScore } from '@/lib/verify/attest-achievement';

export const runtime  = 'nodejs';
export const maxDuration = 60;

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX = 'achievement:pending:';

// How long a verifying entry is considered stuck before we retry
const STUCK_THRESHOLD_SEC = 15 * 60; // 15 minutes

export async function GET(req: NextRequest) {
  // Auth
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now    = Math.floor(Date.now() / 1000);
  const keys   = await redis.keys(`${KEY_PREFIX}*`);
  const results = { processed: 0, skipped: 0, achieved: 0, failed: 0, errors: 0 };

  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;

    const pending: PendingAchievement = typeof raw === 'string'
      ? JSON.parse(raw)
      : raw as PendingAchievement;

    // Skip already resolved
    if (['achieved', 'failed', 'expired'].includes(pending.status)) {
      results.skipped++;
      continue;
    }

    // Skip if currently verifying and not stuck
    if (pending.status === 'verifying' && pending.lastChecked) {
      if (now - pending.lastChecked < STUCK_THRESHOLD_SEC) {
        results.skipped++;
        continue;
      }
      // Stuck — reset and retry
    }

    // Skip if deadline not yet reached
    if (pending.deadline > now) {
      results.skipped++;
      continue;
    }

    // Mark as verifying
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

      // Passed — calculate score and attest
      const onTime       = now <= pending.deadline;
      const deadlineDays = Math.ceil((pending.deadline - pending.mintTimestamp) / 86400);
      const score        = calculateScore({
        level:         result.level!,
        onTime,
        daysRemaining: Math.ceil((pending.deadline - now) / 86400),
        deadlineDays,
        evidenceCount: Object.keys(result.evidence.rawMetrics).length,
        metricBonus:   0,
      });

      const achieved = await attestAchievement({
        agentId:       pending.subject as `0x${string}`,
        claimType:     pending.claimType,
        level:         result.level!,
        commitmentUID: uid,
        evidence:      JSON.stringify(result.evidence),
        metric:        buildMetricString(pending.claimType, result.evidence.rawMetrics),
        score,
        onTime,
      });

      if (!achieved.success) {
        // Keep as pending — will retry next cron run
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
        level:       result.level,
      } satisfies PendingAchievement), { ex: 90 * 86400 });

      results.achieved++;
      results.processed++;
      console.log(`[cron] ✅ Achieved: ${uid} ${pending.claimType}/${result.level} score=${score}`);

    } catch (err) {
      // Reset to pending on unexpected error
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
        windowDays:      params.windowDays    || 30,
        mintTimestamp:   pending.mintTimestamp,
        requireCIPass:   params.requireCIPass,
        minLinesChanged: params.minLinesChanged,
      }, uid);

    case 'website_app_delivery':
      return verifyWebsiteAppDelivery({
        agentWallet:         pending.subject,
        url:                 params.url,
        dnsVerifyRecord:     params.dnsVerifyRecord,
        windowDays:          params.windowDays        || 30,
        mintTimestamp:       pending.mintTimestamp,
        requireHttps:        params.requireHttps      !== false,
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

// ── Metric string builder ──────────────────────────────────────────────────────

function buildMetricString(
  claimType: string,
  metrics:   Record<string, number | string | boolean>,
): string {
  switch (claimType) {
    case 'x402_payment_reliability':
      return `${metrics.paymentCount} payments · ${Number(metrics.successRate).toFixed(1)}% success · $${Number(metrics.totalUSD).toFixed(2)}`;
    case 'defi_trading_performance':
      return `${metrics.tradeCount} trades · $${Number(metrics.volumeUSD).toFixed(0)} volume · ${Number(metrics.pnlPercent).toFixed(1)}% PnL`;
    case 'code_software_delivery':
      return `${metrics.mergedPRCount} PRs · ${metrics.commitCount} commits · ${metrics.linesChanged} lines`;
    case 'website_app_delivery':
      return `perf=${metrics.performance}/100 · a11y=${metrics.accessibility}/100`;
    case 'social_media_growth':
      return `+${metrics.followerGrowth} followers · ${Number(metrics.engagementRate).toFixed(1)}% engagement`;
    default:
      return 'Achievement verified';
  }
}