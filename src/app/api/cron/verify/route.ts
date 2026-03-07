// src/app/api/cron/verify/route.ts
// Vercel cron job — runs every hour, checks all pending achievements
//
// Add to vercel.json:
// {
//   "crons": [{ "path": "/api/cron/verify", "schedule": "0 * * * *" }]
// }
//
// Protected by CRON_SECRET env var

import { NextRequest, NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import type { PendingAchievement } from "@/lib/verify/types"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export async function GET(req: NextRequest) {
  // Verify this is a legitimate cron call
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = Math.floor(Date.now() / 1000)

  // Scan Redis for all pending achievements
  // Key pattern: achievement:pending:*
  const keys = await redis.keys("achievement:pending:*")

  if (keys.length === 0) {
    return NextResponse.json({ processed: 0, message: "No pending achievements" })
  }

  const results: Array<{
    uid: string
    action: string
    status?: string
    level?: string
    error?: string
  }> = []

  for (const key of keys) {
    const pending = await redis.get<PendingAchievement>(key)
    if (!pending) continue

    // Skip already resolved
    if (pending.status === "achieved" || pending.status === "failed") continue

    // Skip if currently verifying (another request is handling it)
    if (pending.status === "verifying") {
      // If stuck verifying for > 10 minutes, reset to pending
      const stuckThreshold = 10 * 60
      if (pending.lastChecked && now - pending.lastChecked > stuckThreshold) {
        await redis.set(key, { ...pending, status: "pending" })
        results.push({ uid: pending.attestationUID, action: "reset_stuck_verifying" })
      }
      continue
    }

    const deadline = pending.mintTimestamp + pending.deadline
    const isAtOrPastDeadline = now >= deadline

    // Mark expired if well past deadline with no check
    const gracePeriod = 24 * 3600 // 24h grace after deadline
    if (now > deadline + gracePeriod && pending.status === "pending") {
      await redis.set(key, { ...pending, status: "expired" })
      results.push({ uid: pending.attestationUID, action: "expired" })
      continue
    }

    // Only trigger verification at/after deadline
    if (!isAtOrPastDeadline) {
      results.push({
        uid: pending.attestationUID,
        action: "skipped",
        status: `deadline in ${Math.floor((deadline - now) / 3600)}h`,
      })
      continue
    }

    // Trigger verification via internal API call
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      const verifyEndpoint = getVerifyEndpoint(pending.claimType)

      if (!verifyEndpoint) {
        results.push({
          uid: pending.attestationUID,
          action: "skipped",
          status: `no verifier for claimType: ${pending.claimType}`,
        })
        continue
      }

      const res = await fetch(`${baseUrl}${verifyEndpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Pass cron flag so verifier knows origin
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({
          attestationUID: pending.attestationUID,
          _cron: true,
        }),
      })

      const data = await res.json()
      results.push({
        uid: pending.attestationUID,
        action: "verified",
        status: data.status,
        level: data.level,
      })
    } catch (err) {
      results.push({
        uid: pending.attestationUID,
        action: "error",
        error: String(err),
      })
    }
  }

  console.log(`[cron/verify] Processed ${results.length} achievements`, results)

  return NextResponse.json({
    processed: results.length,
    timestamp: now,
    results,
  })
}

// Map claimType to its verify endpoint
function getVerifyEndpoint(claimType: string): string | null {
  const map: Record<string, string> = {
    x402_payment_reliability: "/api/verify/x402",
    defi_trading_performance: "/api/verify/defi",       // Session 25
    code_software_delivery: "/api/verify/github",        // Session 25
    website_app_delivery: "/api/verify/website",         // Session 25
    social_media_growth: "/api/verify/social",           // Session 25
  }
  return map[claimType] ?? null
}
