// src/lib/difficulty.ts
//
// Achievement difficulty scoring — v1
//
// Computes a 0–100 difficulty score for a verified achievement based on:
//   1. Threshold percentile score  — how hard were the thresholds the agent set,
//                                    compared to all verified achievements of the
//                                    same claim type in the EAS dataset?
//   2. Breadth multiplier          — how many distinct threshold dimensions did
//                                    the agent commit to? More dimensions = harder.
//
// Formula:
//   difficulty = clamp(round(percentileScore × breadthMultiplier), 0, 100)
//
// Bootstrap mode:
//   When fewer than MIN_SAMPLE_SIZE verified achievements exist for a claim type,
//   we fall back to hardcoded baseline distributions derived from real-world data.
//   Attestations computed in bootstrap mode are flagged with bootstrapped=true and
//   difficultyVersion=1 so they can be recomputed once enough real data exists.
//
// Inverted metrics:
//   Some metrics are "lower is harder" (e.g. maxGapHours — a tighter gap is harder).
//   These are flagged inverted:true in the config and the percentile is flipped:
//     invertedPercentile = 100 - rawPercentile
//
// Adding a new claim type:
//   1. Add an entry to CLAIM_CONFIGS below.
//   2. Add bootstrap distributions to BOOTSTRAP_DISTRIBUTIONS.
//   3. That's it — the algorithm is generic.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricConfig {
  key: string;           // matches the key in CommitmentThresholds
  inverted?: boolean;    // true = lower value is harder (e.g. maxGapHours)
  weight?: number;       // relative weight within claim type (default 1.0)
}

export interface ClaimConfig {
  metrics: MetricConfig[];
  // breadthMultiplier range: 1.0 (1 metric committed) → maxMultiplier (all metrics committed)
  maxMultiplier: number;
}

// Thresholds the agent set in their commitment — keyed by metric name.
// Values are numeric. Boolean flags (e.g. ciPassing) are excluded from scoring.
export type CommitmentThresholds = Record<string, number>;

// A single verified achievement record from EAS / your dataset.
// Only the threshold values matter for percentile computation.
export type HistoricalRecord = CommitmentThresholds;

export interface DifficultyResult {
  difficulty: number;        // 0–100
  difficultyVersion: number; // algorithm version — increment when formula changes
  bootstrapped: boolean;     // true = computed against baseline, not real data
  breakdown: {
    percentileScore: number;     // weighted average percentile across committed metrics
    breadthMultiplier: number;   // 1.0–maxMultiplier
    metricsScored: string[];     // which metrics were actually scored
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DIFFICULTY_VERSION = 1;
const MIN_SAMPLE_SIZE = 50; // minimum real records before leaving bootstrap mode

// ── Claim type configurations ─────────────────────────────────────────────────
// Each entry lists the scoreable metrics and their properties.
// Only metrics present in the agent's CommitmentThresholds are scored —
// if an agent didn't commit to a metric, it doesn't factor in.

export const CLAIM_CONFIGS: Record<string, ClaimConfig> = {

  x402_payment_reliability: {
    maxMultiplier: 1.5,
    metrics: [
      { key: 'minSuccessRate',         weight: 1.2 },  // core reliability signal
      { key: 'minTotalUSD',            weight: 1.0 },  // volume commitment
      { key: 'requireDistinctRecipients', weight: 0.9 }, // breadth of payments
      { key: 'maxGapHours',            weight: 1.1, inverted: true }, // consistency
    ],
  },

  code_software_delivery: {
    maxMultiplier: 1.4,
    metrics: [
      { key: 'minMergedPRs',  weight: 1.2 },
      { key: 'minCommits',    weight: 0.9 },
      // ciPassing is binary/required — not scored numerically
    ],
  },

  website_app_delivery: {
    maxMultiplier: 1.3,
    metrics: [
      { key: 'minPerformanceScore', weight: 1.0 },
    ],
  },

  defi_trading_performance: {
    maxMultiplier: 1.5,
    metrics: [
      { key: 'minTradeCount',  weight: 1.0 },
      { key: 'minVolumeUSD',   weight: 1.1 },
      { key: 'minPnlPercent',  weight: 1.3 }, // hardest to commit to reliably
    ],
  },

  social_media_growth: {
    maxMultiplier: 1.4,
    metrics: [
      { key: 'minFollowerGrowth',   weight: 1.0 },
      { key: 'minEngagementRate',   weight: 1.1 },
    ],
  },

};

// ── Bootstrap distributions ───────────────────────────────────────────────────
// Derived from real-world research (see session notes for sources).
// Format: { p50, p90 } — we fit a simple log-normal to these two points
// and compute percentiles from that approximation.
//
// For inverted metrics, p50 and p90 represent the "easier" (higher) end —
// the algorithm handles the flip automatically.

interface Distribution {
  p50: number;
  p90: number;
}

export const BOOTSTRAP_DISTRIBUTIONS: Record<string, Record<string, Distribution>> = {

  x402_payment_reliability: {
    minSuccessRate:            { p50: 92,    p90: 98    }, // %
    minTotalUSD:               { p50: 500,   p90: 10000 }, // USD
    requireDistinctRecipients: { p50: 8,     p90: 50    }, // count
    maxGapHours:               { p50: 96,    p90: 24    }, // hours (inverted: lower = harder)
  },

  code_software_delivery: {
    minMergedPRs: { p50: 4,   p90: 20  }, // PRs per window
    minCommits:   { p50: 25,  p90: 120 }, // commits per window
  },

  website_app_delivery: {
    minPerformanceScore: { p50: 55, p90: 88 }, // PageSpeed 0–100
  },

  defi_trading_performance: {
    minTradeCount:  { p50: 15,    p90: 100   }, // trades per window
    minVolumeUSD:   { p50: 2000,  p90: 30000 }, // USD
    minPnlPercent:  { p50: 0,     p90: 15    }, // %
  },

  social_media_growth: {
    minFollowerGrowth:  { p50: 3,   p90: 25 }, // % growth
    minEngagementRate:  { p50: 1.5, p90: 6  }, // %
  },

};

// ── Math helpers ──────────────────────────────────────────────────────────────

/**
 * Fit a log-normal distribution from two percentile points (p50, p90)
 * and return the percentile of a given value.
 *
 * Log-normal CDF: Φ((ln(x) - μ) / σ)
 * From p50 and p90:
 *   μ = ln(p50)
 *   σ = (ln(p90) - ln(p50)) / 1.2816   (z-score of 90th percentile)
 */
function lognormalPercentile(value: number, dist: Distribution): number {
  const { p50, p90 } = dist;

  // Edge cases
  if (p50 <= 0 || p90 <= 0 || value <= 0) {
    // Fall back to linear interpolation for zero/negative domains
    return linearPercentile(value, dist);
  }

  const mu    = Math.log(p50);
  const sigma = (Math.log(p90) - Math.log(p50)) / 1.2816;

  if (sigma <= 0) return value >= p50 ? 75 : 25;

  const z = (Math.log(value) - mu) / sigma;
  return normalCDF(z) * 100;
}

/**
 * Linear percentile fallback for metrics that can be zero or negative (e.g. minPnlPercent).
 * Maps linearly between p50 → 50th and p90 → 90th percentile,
 * extrapolating beyond those bounds.
 */
function linearPercentile(value: number, dist: Distribution): number {
  const { p50, p90 } = dist;
  if (p90 === p50) return 50;
  // Slope: 40 percentile points over the p50→p90 range
  const slope = 40 / (p90 - p50);
  return clamp(50 + slope * (value - p50), 1, 99);
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun, max error 7.5e-8).
 */
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  const cdf = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── Percentile from real data ─────────────────────────────────────────────────

/**
 * Compute empirical percentile of a value within a sorted array of historical values.
 * Uses linear interpolation between ranks.
 */
function empiricalPercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 50;
  const n = sortedValues.length;
  let rank = 0;
  for (let i = 0; i < n; i++) {
    if (sortedValues[i] <= value) rank = i + 1;
    else break;
  }
  return clamp((rank / n) * 100, 1, 99);
}

// ── Breadth multiplier ────────────────────────────────────────────────────────

/**
 * How many of the possible metrics for this claim type did the agent commit to?
 * More metrics = harder = higher multiplier.
 *
 * Scales linearly from 1.0 (1 metric) to maxMultiplier (all metrics).
 */
function computeBreadthMultiplier(
  committedMetricKeys: string[],
  config: ClaimConfig,
): number {
  const totalPossible = config.metrics.length;
  const committed     = committedMetricKeys.filter(k =>
    config.metrics.some(m => m.key === k)
  ).length;

  if (totalPossible <= 1 || committed <= 1) return 1.0;

  const fraction = (committed - 1) / (totalPossible - 1); // 0 → 1
  return 1.0 + fraction * (config.maxMultiplier - 1.0);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute difficulty score for an achievement.
 *
 * @param claimType        e.g. 'x402_payment_reliability'
 * @param thresholds       The numeric thresholds the agent committed to
 *                         (only keys present here are scored)
 * @param historicalData   All verified achievement records for this claim type
 *                         from EAS. Pass [] to force bootstrap mode.
 *
 * @returns DifficultyResult with score 0–100 and breakdown for transparency
 */
export function computeDifficulty(
  claimType: string,
  thresholds: CommitmentThresholds,
  historicalData: HistoricalRecord[],
): DifficultyResult {

  const config = CLAIM_CONFIGS[claimType];
  if (!config) {
    // Unknown claim type — return neutral difficulty
    return {
      difficulty: 50,
      difficultyVersion: DIFFICULTY_VERSION,
      bootstrapped: true,
      breakdown: { percentileScore: 50, breadthMultiplier: 1.0, metricsScored: [] },
    };
  }

  const bootstrapped = historicalData.length < MIN_SAMPLE_SIZE;
  const metricsScored: string[] = [];

  // Pre-sort historical values per metric key (ascending) for empirical percentile
  const sortedHistorical: Record<string, number[]> = {};
  if (!bootstrapped) {
    for (const mc of config.metrics) {
      sortedHistorical[mc.key] = historicalData
        .map(r => r[mc.key])
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b);
    }
  }

  // Score each metric the agent committed to
  let weightedPercentileSum = 0;
  let totalWeight = 0;

  for (const mc of config.metrics) {
    const value = thresholds[mc.key];
    if (typeof value !== 'number') continue; // agent didn't commit to this metric

    metricsScored.push(mc.key);
    const weight = mc.weight ?? 1.0;

    let rawPercentile: number;

    if (bootstrapped) {
      const dist = BOOTSTRAP_DISTRIBUTIONS[claimType]?.[mc.key];
      if (!dist) continue;
      // Use log-normal for positive domains, linear for mixed/zero
      rawPercentile = value >= 0 && dist.p50 > 0
        ? lognormalPercentile(value, dist)
        : linearPercentile(value, dist);
    } else {
      rawPercentile = empiricalPercentile(value, sortedHistorical[mc.key] ?? []);
    }

    // Flip inverted metrics — lower threshold = harder commitment
    const percentile = mc.inverted ? 100 - rawPercentile : rawPercentile;

    weightedPercentileSum += percentile * weight;
    totalWeight += weight;
  }

  if (metricsScored.length === 0 || totalWeight === 0) {
    // No scoreable metrics found — return neutral
    return {
      difficulty: 50,
      difficultyVersion: DIFFICULTY_VERSION,
      bootstrapped,
      breakdown: { percentileScore: 50, breadthMultiplier: 1.0, metricsScored: [] },
    };
  }

  const percentileScore    = weightedPercentileSum / totalWeight;
  const breadthMultiplier  = computeBreadthMultiplier(metricsScored, config);
  const raw                = percentileScore * breadthMultiplier;
  const difficulty         = clamp(Math.round(raw), 0, 100);

  return {
    difficulty,
    difficultyVersion: DIFFICULTY_VERSION,
    bootstrapped,
    breakdown: {
      percentileScore: Math.round(percentileScore),
      breadthMultiplier: Math.round(breadthMultiplier * 100) / 100,
      metricsScored,
    },
  };
}

// ── Usage in attest-achievement.ts ───────────────────────────────────────────
//
// import { computeDifficulty } from '@/lib/difficulty';
//
// // Fetch historical records for this claim type from EAS before attesting
// const history = await fetchAchievementsByClaimType(claimType); // your EAS query
//
// const result = computeDifficulty(claimType, commitmentThresholds, history);
//
// // Pass to EAS schema fields:
// //   difficulty:        result.difficulty
// //   difficultyVersion: result.difficultyVersion
// //   bootstrapped:      result.bootstrapped
//
// // Optionally store breakdown in a metadata field for transparency:
// //   difficultyBreakdown: JSON.stringify(result.breakdown)
