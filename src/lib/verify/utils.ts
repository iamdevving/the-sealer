// src/lib/verify/utils.ts
// Shared helpers for the verification layer.
// Import from here — do NOT copy-paste these functions into other files.

import type { CertificateOutcome } from './attest-achievement';

/**
 * Compute proof points for a resolved commitment.
 *
 * Base:
 *   FULL    = 1000
 *   PARTIAL = 500
 *   FAILED  = 0
 *
 * Speed bonus (0–200):
 *   Proportional to how many days early the agent completed vs total window.
 *   Floored at 0 — no penalty for late verification. The outcome state
 *   (FAILED/PARTIAL) already encodes underperformance; double-penalising
 *   via negative speed points would be unfair and counterintuitive.
 *
 * Depth bonus (0–200):
 *   Proportional to how many metrics were met.
 *
 * Max: 1400
 */
export function computeProofPoints(
  outcome:      CertificateOutcome,
  daysEarly:    number,   // positive = finished before deadline, 0 or negative = at/after
  deadlineDays: number,   // total commitment window in days
  metricsMet:   number,
  metricsTotal: number,
): number {
  const base = outcome === 'FULL' ? 1000 : outcome === 'PARTIAL' ? 500 : 0;

  // Floor daysEarly at 0: no speed penalty for late/on-time completion
  const clampedDaysEarly = Math.max(0, daysEarly);
  const speed = outcome !== 'FAILED' && deadlineDays > 0
    ? Math.round(Math.min(clampedDaysEarly, deadlineDays) / deadlineDays * 200)
    : 0;

  const depth = metricsTotal > 0
    ? Math.round((metricsMet / metricsTotal) * 200)
    : 0;

  // Floor total at 0 as well — should not be possible given above, but defensive
  return Math.max(0, Math.min(base + speed + depth, 1400));
}
