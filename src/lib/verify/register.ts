// src/lib/verify/register.ts
// Called at Statement mint time to register a pending achievement in Redis.
// This is what kicks off the verification lifecycle.
//
// Usage in your attest endpoint — after EAS attestation succeeds:
//
//   import { registerPendingAchievement } from "@/lib/verify/register"
//
//   await registerPendingAchievement({
//     attestationUID: uid,
//     claimType: "x402_payment_reliability",
//     subject: agentWallet,
//     statement: "Make 100 x402 payments with 98% success rate in 30 days",
//     verificationParams: JSON.stringify(params),
//     windowDays: 30,
//   })

import { Redis } from "@upstash/redis"
import type {
  PendingAchievement,
  ClaimType,
  VerificationTier,
} from "./types"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

const CLAIM_TYPE_TIERS: Record<ClaimType, VerificationTier> = {
  x402_payment_reliability: "onchain",
  defi_trading_performance: "onchain",
  code_software_delivery: "neutral_third_party",
  website_app_delivery: "neutral_third_party",
  social_media_growth: "neutral_third_party",
  acp_job_delivery:         "onchain",
  prediction_market_accuracy: 'neutral_third_party',
}

interface RegisterParams {
  attestationUID: string
  claimType: ClaimType
  subject: string              // agent wallet
  commissioner?: string
  statement: string
  verificationParams: string   // JSON string
  windowDays: number
}

export async function registerPendingAchievement(
  params: RegisterParams
): Promise<PendingAchievement> {
  const now = Math.floor(Date.now() / 1000)
  const deadline = now + params.windowDays * 86400

  const pending: PendingAchievement = {
    attestationUID: params.attestationUID,
    claimType: params.claimType,
    subject: params.subject,
    commissioner: params.commissioner,
    statement: params.statement,
    verificationParams: params.verificationParams,
    mintTimestamp: now,
    deadline,
    verificationTier: CLAIM_TYPE_TIERS[params.claimType],
    status: "pending",
  }

  await redis.set(
    `achievement:pending:${params.attestationUID}`,
    pending,
    // Keep for 90 days — well past any reasonable window
    { ex: 90 * 86400 }
  )

  console.log(
    `[verify/register] Registered pending achievement ${params.attestationUID} ` +
    `type=${params.claimType} deadline=${new Date(deadline * 1000).toISOString()}`
  )

  return pending
}
