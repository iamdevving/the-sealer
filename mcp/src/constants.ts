// src/constants.ts

export const SEALER_BASE_URL = 'https://thesealer.xyz';
export const CHARACTER_LIMIT = 8000;

export const DIFFICULTY_PARAMS: Record<string, string[]> = {
  x402_payment_reliability: ['minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours'],
  defi_trading_performance: ['minTradeCount', 'minVolumeUSD', 'minPnlPercent'],
  code_software_delivery: ['minMergedPRs', 'minCommits', 'minLinesChanged'],
  website_app_delivery: ['minPerformanceScore', 'minAccessibility'],
  acp_job_delivery: ['minCompletedJobsDelta', 'minSuccessRate', 'minUniqueBuyersDelta'],
};

export const STATUS_DESCRIPTIONS: Record<string, string> = {
  pending: 'Commitment is active — verification window open',
  verifying: 'Verification in progress',
  achieved: 'Commitment verified and certified — certificate issued',
  amended: 'Commitment thresholds were lowered via amendment',
  failed: 'Verification window closed without meeting targets',
  expired: 'Deadline passed with no verification attempt',
};

export const EAS_EXPLORER_URL = 'https://base.easscan.org/attestation/view';
