// src/lib/claimTypes.ts
//
// Central registry for all Sealer Protocol claim types.
// Single source of truth for: type union, labels, metric weights,
// bootstrap baselines, verify route paths, and verification params shape.
//
// When adding a new claim type:
//   1. Add to ClaimType union
//   2. Add entry to CLAIM_TYPE_META
//   3. Add to VERIFY_ROUTE_MAP
//   4. Add case to extractVerificationParams (attest-commitment/route.ts)
//   5. Build the verifier at src/lib/verify/<claimType>.ts
//   6. Create the route at src/app/api/verify/<claimType>/route.ts

// ── Type union ────────────────────────────────────────────────────────────────

export type ClaimType =
  | 'x402_payment_reliability'
  | 'defi_trading_performance'
  | 'code_software_delivery'
  | 'website_app_delivery'
  | 'acp_job_delivery';
  // | 'social_media_growth'  — disabled, coming post-launch

// ── Per-metric weight definitions ─────────────────────────────────────────────
// Weights must sum to 1.0 within each claim type.
// Labels must match the metric label strings used in verificationParams.

export interface MetricMeta {
  label:       string;   // display label (also used as key in verificationParams)
  weight:      number;   // scoring weight (0–1, sum = 1.0 per claim type)
  inverted?:   boolean;  // true = lower is harder (e.g. latency)
  description: string;
}

// ── Bootstrap baselines ───────────────────────────────────────────────────────
// Used for difficulty scoring before N≥50 verified achievements exist.
// p50 = median expected threshold, p90 = top-decile threshold.
// Err forgiving during cold-start per scoring model principle.

export interface BootstrapBaseline {
  p50: number;
  p90: number;
}

// ── Full claim type metadata ───────────────────────────────────────────────────

export interface ClaimTypeMeta {
  label:      string;            // human-readable display name
  metrics:    MetricMeta[];      // ordered list — first is anchor metric
  baselines:  Record<string, BootstrapBaseline>;  // keyed by metric label
  verifyPath: string;            // internal route path (no leading slash needed internally)
}

export const CLAIM_TYPE_META: Record<ClaimType, ClaimTypeMeta> = {

  // ── x402 Payment Reliability ─────────────────────────────────────────────
  x402_payment_reliability: {
    label: 'x402 Payment Reliability',
    metrics: [
      {
        label:       'minSuccessRate',
        weight:      0.50,
        description: 'Fraction of x402 payment attempts that succeed (0–1)',
      },
      {
        label:       'minTotalUSD',
        weight:      0.35,
        description: 'Total USDC volume processed via x402 in window',
      },
      {
        label:       'requireDistinctRecipients',
        weight:      0.15,
        description: 'Number of distinct recipient addresses paid',
      },
    ],
    baselines: {
      minSuccessRate:            { p50: 0.80, p90: 0.97 },
      minTotalUSD:               { p50: 10,   p90: 500  },
      requireDistinctRecipients: { p50: 2,    p90: 10   },
    },
    verifyPath: '/api/verify/x402',
  },

  // ── DeFi Trading Performance ──────────────────────────────────────────────
  defi_trading_performance: {
    label: 'DeFi Trading Performance',
    metrics: [
      {
        label:       'minTradeCount',
        weight:      0.40,
        description: 'Number of onchain swap/trade transactions in window',
      },
      {
        label:       'minVolumeUSD',
        weight:      0.35,
        description: 'Total USD volume traded in window',
      },
      {
        label:       'minPnlPercent',
        weight:      0.25,
        description: 'Minimum portfolio P&L % over window',
      },
    ],
    baselines: {
      minTradeCount:  { p50: 10,  p90: 200  },
      minVolumeUSD:   { p50: 500, p90: 50000 },
      minPnlPercent:  { p50: 0,   p90: 20   },
    },
    verifyPath: '/api/verify/defi',
  },

  // ── Code / Software Delivery ──────────────────────────────────────────────
  code_software_delivery: {
    label: 'Code / Software Delivery',
    metrics: [
      {
        label:       'minCommits',
        weight:      0.40,
        description: 'Number of commits merged to default branch in window',
      },
      {
        label:       'minMergedPRs',
        weight:      0.35,
        description: 'Number of pull requests merged in window',
      },
      {
        label:       'minLinesChanged',
        weight:      0.25,
        description: 'Total lines added + removed in window',
      },
    ],
    baselines: {
      minCommits:      { p50: 5,   p90: 50  },
      minMergedPRs:    { p50: 2,   p90: 20  },
      minLinesChanged: { p50: 100, p90: 2000 },
    },
    verifyPath: '/api/verify/github',
  },

  // ── Website / App Delivery ────────────────────────────────────────────────
  website_app_delivery: {
    label: 'Website / App Delivery',
    metrics: [
      {
        label:       'minPerformanceScore',
        weight:      0.50,
        description: 'PageSpeed performance score (0–100)',
      },
      {
        label:       'minAccessibility',
        weight:      0.30,
        description: 'PageSpeed accessibility score (0–100)',
      },
      {
        label:       'minSeoScore',
        weight:      0.20,
        description: 'PageSpeed SEO score (0–100)',
      },
    ],
    baselines: {
      minPerformanceScore: { p50: 60, p90: 90 },
      minAccessibility:    { p50: 70, p90: 95 },
      minSeoScore:         { p50: 70, p90: 95 },
    },
    verifyPath: '/api/verify/website',
  },

  // ── ACP Job Delivery ──────────────────────────────────────────────────────
  // Verifier: onchain log queries via Alchemy eth_getLogs
  //   - JobCreated(jobId, client, provider, ...) → maps jobId → clientAddress
  //   - JobPhaseUpdated(jobId, oldPhase, newPhase) → newPhase=4 = COMPLETED, 5 = REJECTED
  // Data source: agent's ACP contract on Base (contractAddress stored at commitment time)
  // Both v1 (0x6a1FE26D...) and v2 (0xa6C9BA8...) registry contracts emit these events.
  //
  // All three metrics are delta-based: measured over the commitment window,
  // not all-time totals. Baseline snapshot stored in Redis at commitment mint.
  //
  acp_job_delivery: {
    label: 'ACP Job Delivery',
    metrics: [
      {
        label:       'minCompletedJobsDelta',
        weight:      0.50,
        description: 'New completed ACP jobs during the commitment window (onchain, delta)',
      },
      {
        label:       'minSuccessRate',
        weight:      0.35,
        description: 'Completed / (completed + rejected) in window — maintained floor (0–1)',
      },
      {
        label:       'minUniqueBuyersDelta',
        weight:      0.15,
        description: 'New distinct buyer wallets that completed jobs in window (onchain, delta)',
      },
    ],
    baselines: {
      // Bootstrap baselines for 30-day window — err forgiving for cold-start
      minCompletedJobsDelta:  { p50: 20,   p90: 200  },
      minSuccessRate:         { p50: 0.70, p90: 0.95 },
      minUniqueBuyersDelta:   { p50: 5,    p90: 30   },
    },
    verifyPath: '/api/verify/acp_job_delivery',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** All valid claim type strings as a Set — for fast membership checks */
export const VALID_CLAIM_TYPES = new Set<ClaimType>(
  Object.keys(CLAIM_TYPE_META) as ClaimType[],
);

/** Display label for a claim type, falling back to the raw string */
export function claimLabel(ct: string): string {
  return CLAIM_TYPE_META[ct as ClaimType]?.label ?? ct;
}

/** Internal verify route path for a claim type */
export function verifyPath(ct: ClaimType): string {
  return CLAIM_TYPE_META[ct].verifyPath;
}

/** Metric weights for a claim type, keyed by metric label */
export function metricWeights(ct: ClaimType): Record<string, number> {
  return Object.fromEntries(
    CLAIM_TYPE_META[ct].metrics.map((m) => [m.label, m.weight]),
  );
}

/** Bootstrap baselines for a claim type */
export function bootstrapBaselines(ct: ClaimType): Record<string, BootstrapBaseline> {
  return CLAIM_TYPE_META[ct].baselines;
}

// ── CLAIM_LABELS map (backwards compat for routes still using inline maps) ────
// Import this instead of re-declaring local CLAIM_LABELS objects in each route.

export const CLAIM_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CLAIM_TYPE_META).map(([k, v]) => [k, v.label]),
);
