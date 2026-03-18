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
import { computeProofPoints } from '@/lib/verify/utils';
import type { CertificateOutcome } from '@/lib/verify/attest-achievement';

export const runtime = 'edge';

const VALID_CLAIM_TYPES = Object.keys(CLAIM_CONFIGS);

// Numeric threshold params per claimType
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
  claimType:  string,
  difficulty: number,
  tier:       string,
  breakdown:  { percentileScore: number; metricsScored: string[] },
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
      { status: 400 },
    );
  }

  if (!VALID_CLAIM_TYPES.includes(claimType)) {
    return NextResponse.json(
      { error: `Unknown claimType. Valid values: ${VALID_CLAIM_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  // Parse threshold params - only numeric ones count
  const thresholds: Record<string, number> = {};
  const knownParams = THRESHOLD_PARAMS[claimType] || [];

  for (const key of knownParams) {
    const raw = sp.get(key);
    if (raw !== null) {
      const val = parseFloat(raw);
      if (!isNaN(val)) thresholds[key] = val;
    }
  }

  // Run difficulty computation (always uses bootstrap - no Redis needed)
  const result = computeDifficulty(claimType, thresholds, []);

  const tier = difficultyTier(result.difficulty);

  // Estimate proof points for on-time FULL, on-time PARTIAL, FAILED
  // Uses a 30-day window baseline - actual points depend on real deadline and speed
  const BASELINE_DEADLINE_DAYS = 30;
  const metricsCount = result.breakdown.metricsScored.length || 1;

  const estimatedPoints = {
    full:    computeProofPoints('FULL'    as CertificateOutcome, 0, BASELINE_DEADLINE_DAYS, metricsCount, metricsCount),
    partial: computeProofPoints('PARTIAL' as CertificateOutcome, 0, BASELINE_DEADLINE_DAYS, Math.ceil(metricsCount / 2), metricsCount),
    failed:  0,
    note:    'Estimated for on-time delivery with 30-day window. Early completion adds up to +200 speed bonus.',
  };

  const response = {
    claimType,
    claimLabel:   CLAIM_LABELS[claimType],
    difficulty:   result.difficulty,
    tier,
    tierLabel:    TIER_LABELS[tier],
    bootstrapped: result.bootstrapped,
    thresholdsScored: thresholds,
    breakdown: {
      percentileScore:    result.breakdown.percentileScore,
      breadthMultiplier:  result.breakdown.breadthMultiplier,
      metricsScored:      result.breakdown.metricsScored,
    },
    proofPointsEstimate: estimatedPoints,
    interpretation: buildInterpretation(
      claimType,
      result.difficulty,
      tier,
      result.breakdown,
      result.bootstrapped,
    ),
    // What params are available for this claimType
    availableParams: knownParams,
    // Params that were provided but not recognised (typos etc.)
    unknownParams: [...sp.keys()]
      .filter(k => k !== 'claimType' && !knownParams.includes(k)),
  };

  return NextResponse.json(response, {
    headers: {
      'Cache-Control':               'public, max-age=300',
      'Content-Type':                'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}