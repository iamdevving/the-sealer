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

// Actual values measured by the verifier — same keys as CommitmentThresholds.
export type ActualValues = Record<string, number>;

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

export interface ExecutionResult {
  executionScore: number;   // 0–100
  breakdown: {
    metricsScored: string[];                          // which metrics were scored
    headrooms: Record<string, number>;                // per-metric headroom 0–100
    weightedAverage: number;                          // before clamp/round
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DIFFICULTY_VERSION = 1;
const MIN_SAMPLE_SIZE = 50; // minimum real records before leaving bootstrap mode

// ── Claim type configurations ─────────────────────────────────────────────────

export const CLAIM_CONFIGS: Record<string, ClaimConfig> = {

  x402_payment_reliability: {
    maxMultiplier: 1.5,
    metrics: [
      { key: 'minSuccessRate',            weight: 1.2 },
      { key: 'minTotalUSD',               weight: 1.0 },
      { key: 'requireDistinctRecipients', weight: 0.9 },
      { key: 'maxGapHours',               weight: 1.1, inverted: true },
    ],
  },

  code_software_delivery: {
    maxMultiplier: 1.4,
    metrics: [
      { key: 'minMergedPRs', weight: 1.2 },
      { key: 'minCommits',   weight: 0.9 },
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
      { key: 'minPnlPercent',  weight: 1.3 },
    ],
  },

  social_media_growth: {
    maxMultiplier: 1.4,
    metrics: [
      { key: 'minFollowerGrowth',  weight: 1.0 },
      { key: 'minEngagementRate',  weight: 1.1 },
    ],
  },

  acp_job_delivery: {
    maxMultiplier: 1.4,
    metrics: [
      { key: 'minCompletedJobsDelta',  weight: 1.2 },
      { key: 'minSuccessRate',         weight: 1.1 },
      { key: 'minUniqueBuyersDelta',   weight: 0.9 },
    ],
  },

  prediction_market_accuracy: {
    maxMultiplier: 1.5,
    metrics: [
      { key: 'minMarketsResolved', weight: 1.0 },
      { key: 'minWinRate',         weight: 1.3 },
      { key: 'minROI',             weight: 1.2 },
      { key: 'minVolumeUSD',       weight: 0.9 },
    ],
  },

};

// ── Bootstrap distributions ───────────────────────────────────────────────────

interface Distribution {
  p50: number;
  p90: number;
}

export const BOOTSTRAP_DISTRIBUTIONS: Record<string, Record<string, Distribution>> = {

  x402_payment_reliability: {
    minSuccessRate:            { p50: 92,    p90: 98    },
    minTotalUSD:               { p50: 500,   p90: 10000 },
    requireDistinctRecipients: { p50: 8,     p90: 50    },
    maxGapHours:               { p50: 96,    p90: 24    },
  },

  code_software_delivery: {
    minMergedPRs: { p50: 4,   p90: 20  },
    minCommits:   { p50: 25,  p90: 120 },
  },

  website_app_delivery: {
    minPerformanceScore: { p50: 55, p90: 88 },
  },

  defi_trading_performance: {
    minTradeCount:  { p50: 15,    p90: 100   },
    minVolumeUSD:   { p50: 2000,  p90: 30000 },
    minPnlPercent:  { p50: 0,     p90: 15    },
  },

  social_media_growth: {
    minFollowerGrowth:  { p50: 3,   p90: 25 },
    minEngagementRate:  { p50: 1.5, p90: 6  },
  },

  acp_job_delivery: {
    minCompletedJobsDelta: { p50: 20,   p90: 200  },
    minSuccessRate:        { p50: 0.70, p90: 0.95 },
    minUniqueBuyersDelta:  { p50: 5,    p90: 30   },
  },

  prediction_market_accuracy: {
    minMarketsResolved: { p50: 10,  p90: 100  },
    minWinRate:         { p50: 52,  p90: 65   },
    minROI:             { p50: 0,   p90: 20   },
    minVolumeUSD:       { p50: 50,  p90: 1000 },
  },

};

// ── Math helpers ──────────────────────────────────────────────────────────────

function lognormalPercentile(value: number, dist: Distribution): number {
  const { p50, p90 } = dist;
  if (p50 <= 0 || p90 <= 0 || value <= 0) {
    return linearPercentile(value, dist);
  }
  const mu    = Math.log(p50);
  const sigma = (Math.log(p90) - Math.log(p50)) / 1.2816;
  if (sigma <= 0) return value >= p50 ? 75 : 25;
  const z = (Math.log(value) - mu) / sigma;
  return normalCDF(z) * 100;
}

function linearPercentile(value: number, dist: Distribution): number {
  const { p50, p90 } = dist;
  if (p90 === p50) return 50;
  const slope = 40 / (p90 - p50);
  return clamp(50 + slope * (value - p50), 1, 99);
}

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

function computeBreadthMultiplier(
  committedMetricKeys: string[],
  config: ClaimConfig,
): number {
  const totalPossible = config.metrics.length;
  const committed     = committedMetricKeys.filter(k =>
    config.metrics.some(m => m.key === k)
  ).length;
  if (totalPossible <= 1 || committed <= 1) return 1.0;
  const fraction = (committed - 1) / (totalPossible - 1);
  return 1.0 + fraction * (config.maxMultiplier - 1.0);
}

// ── computeDifficulty ─────────────────────────────────────────────────────────

export function computeDifficulty(
  claimType: string,
  thresholds: CommitmentThresholds,
  historicalData: HistoricalRecord[],
): DifficultyResult {

  const config = CLAIM_CONFIGS[claimType];
  if (!config) {
    return {
      difficulty: 50,
      difficultyVersion: DIFFICULTY_VERSION,
      bootstrapped: true,
      breakdown: { percentileScore: 50, breadthMultiplier: 1.0, metricsScored: [] },
    };
  }

  const bootstrapped = historicalData.length < MIN_SAMPLE_SIZE;
  const metricsScored: string[] = [];

  const sortedHistorical: Record<string, number[]> = {};
  if (!bootstrapped) {
    for (const mc of config.metrics) {
      sortedHistorical[mc.key] = historicalData
        .map(r => r[mc.key])
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b);
    }
  }

  let weightedPercentileSum = 0;
  let totalWeight = 0;

  for (const mc of config.metrics) {
    const value = thresholds[mc.key];
    if (typeof value !== 'number') continue;

    metricsScored.push(mc.key);
    const weight = mc.weight ?? 1.0;

    let rawPercentile: number;
    if (bootstrapped) {
      const dist = BOOTSTRAP_DISTRIBUTIONS[claimType]?.[mc.key];
      if (!dist) continue;
      rawPercentile = value >= 0 && dist.p50 > 0
        ? lognormalPercentile(value, dist)
        : linearPercentile(value, dist);
    } else {
      rawPercentile = empiricalPercentile(value, sortedHistorical[mc.key] ?? []);
    }

    const percentile = mc.inverted ? 100 - rawPercentile : rawPercentile;
    weightedPercentileSum += percentile * weight;
    totalWeight += weight;
  }

  if (metricsScored.length === 0 || totalWeight === 0) {
    return {
      difficulty: 50,
      difficultyVersion: DIFFICULTY_VERSION,
      bootstrapped,
      breakdown: { percentileScore: 50, breadthMultiplier: 1.0, metricsScored: [] },
    };
  }

  const percentileScore   = weightedPercentileSum / totalWeight;
  const breadthMultiplier = computeBreadthMultiplier(metricsScored, config);
  const raw               = percentileScore * breadthMultiplier;
  const difficulty        = clamp(Math.round(raw), 0, 100);

  return {
    difficulty,
    difficultyVersion: DIFFICULTY_VERSION,
    bootstrapped,
    breakdown: {
      percentileScore:    Math.round(percentileScore),
      breadthMultiplier:  Math.round(breadthMultiplier * 100) / 100,
      metricsScored,
    },
  };
}

// ── computeExecution ──────────────────────────────────────────────────────────
//
// Measures how far above the committed thresholds the agent actually landed.
// Pure metric headroom — independent of difficulty, independent of speed.
//
// Formula per metric:
//   normal:   headroom = clamp((actual - threshold) / |threshold|, 0, 1) × 100
//   inverted: headroom = clamp((threshold - actual) / |threshold|, 0, 1) × 100
//
// Final score = weighted average of headrooms, clamped 0–100.
//
// Notes:
//   - Only metrics present in BOTH thresholds and actuals are scored.
//   - A headroom of 0 means the agent just barely met the threshold.
//   - A headroom of 100 means the agent doubled (or better) their threshold.
//   - Score is display-only for now — add to EAS schema once schema v2 is deployed.

export function computeExecution(
  claimType: string,
  thresholds: CommitmentThresholds,
  actuals: ActualValues,
): ExecutionResult {

  const config = CLAIM_CONFIGS[claimType];
  if (!config) {
    return {
      executionScore: 0,
      breakdown: { metricsScored: [], headrooms: {}, weightedAverage: 0 },
    };
  }

  const metricsScored: string[] = [];
  const headrooms: Record<string, number> = {};
  let weightedSum  = 0;
  let totalWeight  = 0;

  for (const mc of config.metrics) {
    const threshold = thresholds[mc.key];
    const actual    = actuals[mc.key];

    // Both must be present and numeric
    if (typeof threshold !== 'number' || typeof actual !== 'number') continue;

    // Avoid division by zero — use absolute value of threshold as denominator
    const denom = Math.abs(threshold);
    if (denom === 0) continue;

    let headroom: number;
    if (mc.inverted) {
      // Lower is better — how much below the threshold did we land?
      // e.g. threshold = maxGapHours 48, actual = 24 → headroom = (48-24)/48 = 50
      headroom = clamp((threshold - actual) / denom, 0, 1) * 100;
    } else {
      // Higher is better — how far above threshold did we land?
      // e.g. threshold = minMergedPRs 5, actual = 8 → headroom = (8-5)/5 = 60
      headroom = clamp((actual - threshold) / denom, 0, 1) * 100;
    }

    const weight = mc.weight ?? 1.0;
    headrooms[mc.key] = Math.round(headroom);
    metricsScored.push(mc.key);
    weightedSum  += headroom * weight;
    totalWeight  += weight;
  }

  if (metricsScored.length === 0 || totalWeight === 0) {
    return {
      executionScore: 0,
      breakdown: { metricsScored: [], headrooms: {}, weightedAverage: 0 },
    };
  }

  const weightedAverage = weightedSum / totalWeight;
  const executionScore  = clamp(Math.round(weightedAverage), 0, 100);

  return {
    executionScore,
    breakdown: {
      metricsScored,
      headrooms,
      weightedAverage: Math.round(weightedAverage * 10) / 10,
    },
  };
}

// ── Usage ─────────────────────────────────────────────────────────────────────
//
// import { computeDifficulty, computeExecution } from '@/lib/difficulty';
//
// // Difficulty — at commitment verification time:
// const diffResult = computeDifficulty(claimType, commitmentThresholds, history);
//
// // Execution — at achievement verification time, after verifier runs:
// const execResult = computeExecution(claimType, commitmentThresholds, verifierActuals);
//
// // Both are display-only on certificate until schema v2 is deployed.
// // Then wire in:
// //   difficulty:      diffResult.difficulty
// //   executionScore:  execResult.executionScore