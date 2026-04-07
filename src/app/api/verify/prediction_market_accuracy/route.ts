// src/app/api/verify/prediction_market_accuracy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { rateLimitRequest } from '@/lib/security';
import { verifyPredictionMarket } from '@/lib/verify/prediction-market';
import { attestAchievement } from '@/lib/verify/attest-achievement';
import type { ClaimType } from '@/lib/verify/types';

export const runtime = 'nodejs';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitRequest(req, 'verify-prediction-market', 10, 3600);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const commitmentUID = (body.commitmentUID as string)?.trim();
  const cronSecret    = req.headers.get('x-cron-secret');
  const isAuthorised  = cronSecret === process.env.CRON_SECRET;

  if (!commitmentUID) {
    return NextResponse.json({ error: 'commitmentUID required' }, { status: 400 });
  }

  // Load pending achievement from Redis
  const record = await redis.get(`achievement:pending:${commitmentUID}`) as Record<string, unknown> | null;
  if (!record) {
    return NextResponse.json({ error: 'Commitment not found' }, { status: 404 });
  }

  const params      = JSON.parse(record.verificationParams as string);
  const claimType   = record.claimType as ClaimType;
  const agentId     = record.subject as string;
  const mintTs      = Number(record.mintTimestamp);
  const deadlineTs  = Number(record.deadline ?? params.deadline);
  const windowDays  = Number(params.windowDays ?? 30);

  // Validate platform
  const platform = params.platform as string;
  if (!['polymarket', 'kalshi', 'limitless'].includes(platform)) {
    return NextResponse.json({ error: `Invalid platform: ${platform}` }, { status: 400 });
  }

  // Run verification
  const result = await verifyPredictionMarket({
    agentWallet:        params.agentWallet || agentId,
    platform:           platform as 'polymarket' | 'kalshi' | 'limitless',
    category:           params.category ?? 'all',
    minMarketsResolved: Number(params.minMarketsResolved ?? 1),
    minWinRate:         Number(params.minWinRate ?? 50),
    minROI:             Number(params.minROI ?? 0),
    minVolumeUSD:       Number(params.minVolumeUSD ?? 0),
    windowStart:        mintTs,
    windowEnd:          deadlineTs,
    kalshiApiKey:       params.kalshiApiKey,
  });

  // Compute proofPoints based on metrics met
  const metricRatios = [
    result.marketsResolved / Number(params.minMarketsResolved ?? 1),
    result.winRate / Number(params.minWinRate ?? 50),
    // ROI can be negative — clamp to 0
    Math.max(0, (result.roi + 100) / (Number(params.minROI ?? 0) + 100)),
    result.volumeUSD / Number(params.minVolumeUSD ?? 1),
  ];

  const weights     = [0.25, 0.35, 0.25, 0.15];
  const achievement = Math.min(
    150,
    metricRatios.reduce((s, r, i) => s + Math.min(1.5, r) * weights[i] * 100, 0),
  );

  const difficulty  = Number(record.difficulty ?? 50);
  const proofPoints = Math.round((achievement * difficulty) / 100);
  const outcome     = result.passed ? 'FULL'
    : result.metricsMet >= 2       ? 'PARTIAL'
    : 'FAILED';

  // Build certificate metrics
  const certificateMetrics = [
    { label: 'Markets Resolved', target: String(params.minMarketsResolved), achieved: String(result.marketsResolved), met: result.perMetric.marketsResolved.met, weight: 0.25 },
    { label: 'Win Rate %',       target: String(params.minWinRate),         achieved: String(result.winRate),         met: result.perMetric.winRate.met,         weight: 0.35 },
    { label: 'ROI %',            target: String(params.minROI),             achieved: String(result.roi),             met: result.perMetric.roi.met,             weight: 0.25 },
    { label: 'Volume USD',       target: String(params.minVolumeUSD),       achieved: String(result.volumeUSD),       met: result.perMetric.volumeUSD.met,       weight: 0.15 },
  ];

  const now = Math.floor(Date.now() / 1000);

  // Issue certificate
  const attestResult = await attestAchievement({
    agentId:              agentId as `0x${string}`,
    claimType,
    commitmentUID,
    evidence:             result.evidence,
    metric:               `platform:${platform} category:${params.category ?? 'all'} markets:${result.marketsResolved} winRate:${result.winRate}% roi:${result.roi}% volume:$${result.volumeUSD}`,
    outcome,
    onTime:               now <= deadlineTs,
    daysEarly:            Math.floor((deadlineTs - now) / 86400),
    metricsMet:           result.metricsMet,
    metricsTotal:         result.metricsTotal,
    proofPoints,
    commitmentText:       record.statement as string,
    certificateMetrics,
    issuedAt:             now,
    periodStart:          mintTs,
    periodEnd:            deadlineTs,
    deadlineDays:         windowDays,
    commitmentThresholds: {
      minMarketsResolved: Number(params.minMarketsResolved),
      minWinRate:         Number(params.minWinRate),
      minROI:             Number(params.minROI),
      minVolumeUSD:       Number(params.minVolumeUSD),
    },
    historicalRecords: [],
  });

  // Update Redis status
  await redis.set(`achievement:pending:${commitmentUID}`, {
    ...record,
    status:       outcome === 'FAILED' ? 'failed' : 'achieved',
    proofPoints,
    lastChecked:  now,
    failureReason: result.failureReason,
  });

   await redis.srem(`commitment:active:${agentId}`, commitmentUID).catch(() => {});

  return NextResponse.json({
    commitmentUID,
    platform,
    category:   params.category ?? 'all',
    outcome,
    passed:     result.passed,
    proofPoints,
    metrics: {
      marketsResolved: result.perMetric.marketsResolved,
      winRate:         result.perMetric.winRate,
      roi:             result.perMetric.roi,
      volumeUSD:       result.perMetric.volumeUSD,
    },
    certificate: attestResult,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint:    'POST /api/verify/prediction_market_accuracy',
    description: 'Verify prediction market accuracy commitment',
    platforms:   ['polymarket', 'kalshi', 'limitless'],
    categories:  ['crypto', 'politics', 'sports', 'economics', 'culture', 'all'],
    metrics:     ['minMarketsResolved', 'minWinRate', 'minROI', 'minVolumeUSD'],
  });
}