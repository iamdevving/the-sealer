// src/app/api/difficulty-preview/route.ts
// GET /api/difficulty-preview
//
// Returns a difficulty score estimate for a set of commitment thresholds
// WITHOUT minting anything. Use this before calling /api/attest-commitment
// to understand how hard your commitment will be scored.
//
// Example:
//   GET /api/difficulty-preview?claimType=x402_payment_reliability
//     &minSuccessRate=98&minTotalUSD=500&requireDistinctRecipients=5
//
// No payment required. No auth required. Pure computation.

import { NextRequest, NextResponse } from 'next/server';
import { computeDifficulty, CLAIM_CONFIGS } from '@/lib/difficulty';
import { computeScoring } from '@/lib/verify/scoring';

export const runtime = 'edge';

const VALID_CLAIM_TYPES = Object.keys(CLAIM_CONFIGS);

const THRESHOLD_PARAMS: Record<string, string[]> = {
  x402_payment_reliability: ['minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours'],
  code_software_delivery:   ['minMergedPRs', 'minCommits', 'minLinesChanged'],
  website_app_delivery:     ['minPerformanceScore', 'minAccessibility'],
  defi_trading_performance: ['minTradeCount', 'minVolumeUSD', 'minPnlPercent'],
  social_media_growth:      ['minFollowerGrowth', 'minEngagementRate'],
};

const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payment Reliability',
  defi_trading_performance: 'DeFi Trading Performance',
  code_software_delivery:   'Code / Software Delivery',
  website_app_delivery:     'Website / App Delivery',
  social_media_growth:      'Social Media Growth',
};

function difficultyTier(score: number): 'low' | 'medium' | 'high' | 'very_high' {
  if (score < 30) return 'low';
  if (score < 55) return 'medium';
  if (score < 78) return 'high';
  return 'very_high';
}

const TIER_LABELS: Record<string, string> = {
  low:       'Low',
  medium:    'Medium',
  high:      'High',
  very_high: 'Very High',
};

function buildInterpretation(
  claimType:    string,
  difficulty:   number,
  tier:         string,
  breakdown:    { percentileScore: number; metricsScored: string[] },
  bootstrapped: boolean,
): string {
  const label     = CLAIM_LABELS[claimType] || claimType;
  const topPct    = 100 - breakdown.percentileScore;
  const tierLabel = TIER_LABELS[tier];
  const bsNote    = bootstrapped ? ' (estimated from baseline data - refines as more commitments are made)' : '';

  if (breakdown.metricsScored.length === 0) {
    return `No recognised threshold params provided for ${label}. Add at least one threshold to get a difficulty score.`;
  }
  if (difficulty < 30) {
    return `${tierLabel} difficulty${bsNote}. Your thresholds are below the median for ${label} commitments. Consider raising them to earn more Proof Points.`;
  }
  return `${tierLabel} difficulty${bsNote}. Your thresholds rank in the top ${topPct}% of ${label} commitments scored so far.`;
}

// Estimate leaderboard points for the preview.
// Simulates a clean full/partial achievement on a 30-day window, on-time (daysEarly=0).
// All metrics equal weight, all hit target exactly (ratio=1.0 → perScore=1.0^0.7=1.0).
function estimatePoints(difficultyScore: number, metricsCount: number): {
  full: number; partial: number; failed: number; note: string;
} {
  const n = Math.max(1, metricsCount);

  // Full: all metrics at exactly target (ratio=1.0), on-time, 30-day window
  const fullMetrics = Array.from({ length: n }, (_, i) => ({
    label: `m${i}`, weight: 1 / n, target: 100, achieved: 100,
  }));
  const fullScore = computeScoring({
    metrics: fullMetrics, difficultyScore, deadlineDays: 30, daysEarly: 0, closedEarly: false,
  });

  // Partial: half metrics at target, half at 50% (ratio=0.5)
  const partialMetrics = Array.from({ length: n }, (_, i) => ({
    label: `m${i}`, weight: 1 / n, target: 100, achieved: i < Math.ceil(n / 2) ? 100 : 50,
  }));
  const partialScore = computeScoring({
    metrics: partialMetrics, difficultyScore, deadlineDays: 30, daysEarly: 0, closedEarly: false,
  });

  return {
    full:    Math.round(fullScore.leaderboardPoints),
    partial: Math.round(partialScore.leaderboardPoints),
    failed:  0,
    note:    'Estimated for on-time delivery with a 30-day window. Early completion increases the early bonus; longer windows increase difficulty but reduce early bonus ceiling.',
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp        = req.nextUrl.searchParams;
  const claimType = sp.get('claimType') || '';

  if (!claimType) {
    return NextResponse.json(
      {
        error:       'claimType is required',
        validValues: VALID_CLAIM_TYPES,
        example:     '/api/difficulty-preview?claimType=x402_payment_reliability&minSuccessRate=98&minTotalUSD=500',
      },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  if (!VALID_CLAIM_TYPES.includes(claimType)) {
    return NextResponse.json(
      { error: `Unknown claimType. Valid values: ${VALID_CLAIM_TYPES.join(', ')}` },
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  const knownParams  = THRESHOLD_PARAMS[claimType] || [];
  const thresholds: Record<string, number> = {};
  const unknownParams: string[] = [];

  for (const [key, value] of sp.entries()) {
    if (key === 'claimType') continue;
    if (knownParams.includes(key)) {
      const val = parseFloat(value as string);
      if (!isNaN(val)) thresholds[key] = val;
    } else {
      unknownParams.push(key);
    }
  }

  const result = computeDifficulty(claimType, thresholds, []);
  const tier   = difficultyTier(result.difficulty);

  const metricsCount     = result.breakdown.metricsScored.length || 1;
  const proofPointsEstimate = estimatePoints(result.difficulty, metricsCount);

  const response = {
    claimType,
    claimLabel:    CLAIM_LABELS[claimType] || claimType,
    difficulty:    result.difficulty,
    tier,
    tierLabel:     TIER_LABELS[tier],
    bootstrapped:  result.bootstrapped,
    breakdown: {
      percentileScore:    result.breakdown.percentileScore,
      breadthMultiplier:  result.breakdown.breadthMultiplier,
      metricsScored:      result.breakdown.metricsScored,
    },
    proofPointsEstimate,
    interpretation: buildInterpretation(claimType, result.difficulty, tier, result.breakdown, result.bootstrapped),
    availableParams: knownParams,
    ...(unknownParams.length > 0 && { unknownParams }),
  };

  return NextResponse.json(response, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}