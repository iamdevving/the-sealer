// src/lib/verify/scoring.ts
//
// Single source of truth for achievement scoring.
// Used by:
//   - src/app/api/certificate/route.ts  → SVG rendering
//   - src/lib/verify/route-handler.ts   → EAS attestation + Redis
//   - src/app/api/cron/verify/route.ts  → scheduled verification
//
// Replaces computeProofPoints() in utils.ts (v1 placeholder).
// After deploying this file, delete computeProofPoints from utils.ts.
//
// Spec: sealer_scoring_model_v2 sections 5 + 6
//
//   per_metric_score  = ratio ^ exp     (exp=0.7 over / 1.5 under)
//   base_score        = 100 × Σ(weight_i × per_metric_score_i)
//   bonusCap          = 10 × (1 / deadlineMultiplier)³   ← anti-sandbagging
//   early_bonus       = Σ(weight_i × daysEarly/windowDays) × bonusCap
//   default_penalty   = Σ(weight_j) × 5
//   deadline_adj      = early_bonus − default_penalty
//   achievement_score = max(0, base_score + deadline_adj)
//   leaderboard_pts   = (achievement_score × difficulty) / 100
//
// Note on deadlineMultiplier:
//   Only used to compute bonusCap — NOT applied to the difficulty score.
//   Difficulty is locked at commitment time; deadline length's effect on
//   achievement is captured entirely through the bonusCap anti-sandbagging rule.
//
// CertState (full / partial / failed) is cosmetic — drives SVG theme and wax
// seal image. It does not affect any score.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScoringMetric {
  label:    string;
  weight:   number;   // committed metrics' weights must sum to 1.0
  target:   number;
  achieved: number;
  unit?:    string;
}

export interface ScoringInput {
  metrics:         ScoringMetric[];
  difficultyScore: number;   // 0–100, locked at commitment time
  deadlineDays:    number;   // total window in days
  daysEarly:       number;   // positive = completed before deadline
  closedEarly:     boolean;  // true if agent triggered voluntary close
}

export type BadgeTier = 'gold' | 'silver' | 'bronze' | 'none';
export type CertState = 'full' | 'partial' | 'failed';

export interface PerMetricResult extends ScoringMetric {
  ratio:     number;
  perScore:  number;
  met:       boolean;
  over:      boolean;
  delta:     number;
  defaulted: boolean;
}

export interface ScoringResult {
  achievementScore:   number;   // 0–∞ (overachievers can exceed 100)
  leaderboardPoints:  number;   // (achievementScore × difficulty) / 100
  deadlineAdj:        number;   // early_bonus − default_penalty
  baseScore:          number;   // pre-deadline-adj score
  state:              CertState;
  badgeTier:          BadgeTier;
  hasOverachievement: boolean;
  perMetric:          PerMetricResult[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXP_OVER  = 0.7;   // diminishing returns above target
const EXP_UNDER = 1.5;   // progressive penalty below target

// ── deadlineMultiplier ────────────────────────────────────────────────────────
//
//   7d  → 1.00
//   30d → 1.15   (interpolated)
//   90d → 1.35   (interpolated; clamped above 90d)

export function deadlineMultiplier(days: number): number {
  if (days <= 7)  return 1.0;
  if (days <= 30) return 1.0 + (0.15 * (days - 7) / 23);
  if (days <= 90) return 1.15 + (0.20 * (days - 30) / 60);
  return 1.35;
}

// ── computeScoring ────────────────────────────────────────────────────────────

export function computeScoring(input: ScoringInput): ScoringResult {
  const { metrics, difficultyScore, deadlineDays, daysEarly, closedEarly } = input;

  const dlMult   = deadlineMultiplier(deadlineDays);
  const bonusCap = 10 * Math.pow(1.0 / dlMult, 3);

  const perMetric: PerMetricResult[] = metrics.map(m => {
    // Defaulted = agent closed early with zero data for this metric
    const defaulted = m.achieved === 0 && closedEarly;
    const ratio     = defaulted ? 0 : m.achieved / m.target;
    const exp       = ratio >= 1.0 ? EXP_OVER : EXP_UNDER;
    const perScore  = defaulted ? 0 : Math.pow(ratio, exp);
    return {
      ...m,
      ratio,
      perScore,
      met:       ratio >= 1.0,
      over:      ratio > 1.0,
      delta:     m.achieved - m.target,
      defaulted,
    };
  });

  const baseScore = 100 * perMetric.reduce((s, m) => s + m.weight * m.perScore, 0);

  const earlyBonus = perMetric
    .filter(m => !m.defaulted && m.met && daysEarly > 0)
    .reduce((s, m) => s + m.weight * (daysEarly / deadlineDays) * bonusCap, 0);

  const defaultPenalty = perMetric
    .filter(m => m.defaulted)
    .reduce((s, m) => s + m.weight * 5, 0);

  const deadlineAdj       = earlyBonus - defaultPenalty;
  const achievementScore  = Math.max(0, baseScore + deadlineAdj);
  const leaderboardPoints = (achievementScore * difficultyScore) / 100;

  const metCount = perMetric.filter(m => m.met).length;
  const state: CertState =
    metCount === 0              ? 'failed'  :
    metCount < perMetric.length ? 'partial' : 'full';

  const badgeTier: BadgeTier =
    achievementScore < 40 ? 'none'   :
    achievementScore < 70 ? 'bronze' :
    achievementScore < 90 ? 'silver' : 'gold';

  return {
    achievementScore:   r1(achievementScore),
    leaderboardPoints:  r1(leaderboardPoints),
    deadlineAdj:        r1(deadlineAdj),
    baseScore:          r1(baseScore),
    state,
    badgeTier,
    hasOverachievement: perMetric.some(m => m.over),
    perMetric,
  };
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}