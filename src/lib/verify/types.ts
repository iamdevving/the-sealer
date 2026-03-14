// src/lib/verify/types.ts
// Shared types for the Achievement verification layer

export type VerificationStatus =
  | "pending"      // Statement minted, window not yet closed
  | "verifying"    // Check in progress
  | "achieved"     // Conditions met — ready to upgrade to Achievement
  | "failed"       // Window closed, conditions not met
  | "expired"      // Deadline passed with no verification attempt

export type VerificationTier =
  | "onchain"           // 1 — strongest
  | "neutral_third_party" // 2
  | "countersign"       // 3
  | "oracle"            // 4
  | "self_declared"     // 5 — weakest

export type AchievementLevel = "bronze" | "silver" | "gold"

export type ClaimType =
  | "x402_payment_reliability"
  | "defi_trading_performance"
  | "code_software_delivery"
  | "website_app_delivery"
  | "social_media_growth"

// What gets stored in Redis when a Statement is minted
// Key: achievement:pending:{attestationUID}
export interface PendingAchievement {
  attestationUID: string
  claimType: ClaimType
  subject: string              // agent wallet address
  commissioner?: string        // optional, who commissioned this
  statement: string            // human readable goal
  verificationParams: string   // JSON string, category-specific
  mintTimestamp: number        // unix seconds
  deadline: number             // unix seconds
  verificationTier: VerificationTier
  status: VerificationStatus
  level?: AchievementLevel     // set after successful verification
  lastChecked?: number         // unix seconds
  failureReason?: string
  proofPoints?: number
  difficulty?: number
}

// Result returned from every verifier
export interface VerificationResult {
  passed: boolean
  level?: AchievementLevel
  evidence: VerificationEvidence
  failureReason?: string
}

export interface VerificationEvidence {
  checkedAt: number            // unix seconds
  dataSource: string           // e.g. "alchemy_tx_api + basescan"
  rawMetrics: Record<string, number | string | boolean>
  attestationUID: string
}

// x402-specific verificationParams shape
export interface X402VerificationParams {
  agentWallet: string
  metric: "payment_count" | "success_rate" | "total_volume" | "distinct_recipients"
  target: number
  minSuccessRate: number       // percent, e.g. 98.0
  minTotalUSD: number          // noise floor
  requireDistinctRecipients?: number
  maxGapHours?: number         // for consistency scenarios
  windowDays: number
  chain: "base"
  mintTimestamp: number
  baselineSnapshot: {
    txCount: number
    timestamp: number
  }
}

// Thresholds per level — used by verifiers to determine bronze/silver/gold
export const X402_THRESHOLDS: Record<AchievementLevel, {
  minPaymentCount: number
  minSuccessRate: number
  minTotalUSD: number
  minDistinctRecipients: number
}> = {
  bronze: {
    minPaymentCount: 10,
    minSuccessRate: 95,
    minTotalUSD: 0.50,
    minDistinctRecipients: 1,
  },
  silver: {
    minPaymentCount: 100,
    minSuccessRate: 98,
    minTotalUSD: 5,
    minDistinctRecipients: 3,
  },
  gold: {
    minPaymentCount: 500,
    minSuccessRate: 99.5,
    minTotalUSD: 25,
    minDistinctRecipients: 10,
  },
}
