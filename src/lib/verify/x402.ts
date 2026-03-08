// src/lib/verify/x402.ts
// Verifier for x402 Payment Reliability achievements
// Data sources: Alchemy Transaction API + BaseScan API
// Both already in stack — zero new dependencies

import {
  X402VerificationParams,
  VerificationResult,
  AchievementLevel,
  X402_THRESHOLDS,
} from "./types"

// ─── Alchemy Transaction Fetcher ────────────────────────────────────────────

interface AlchemyTransfer {
  hash: string
  from: string
  to: string | null
  value: string
  blockNum: string
  metadata: {
    blockTimestamp: string
  }
  asset: string | null
  category: string
}

interface AlchemyTransfersResponse {
  result: {
    transfers: AlchemyTransfer[]
    pageKey?: string
  }
}

// Paginate through all transfers from mint timestamp onwards
// Single fetch per page — no duplicate calls
async function getAllTransfersSinceMint(
  wallet: string,
  mintTimestamp: number
): Promise<AlchemyTransfer[]> {
  const secondsAgo    = Math.floor(Date.now() / 1000) - mintTimestamp
  const blocksAgo     = Math.floor(secondsAgo / 2)
  const CURRENT_BASE_BLOCK = 28000000
  const fromBlockNum  = Math.max(0, CURRENT_BASE_BLOCK - blocksAgo)
  const fromBlock     = `0x${fromBlockNum.toString(16)}`

  let allTransfers: AlchemyTransfer[] = []
  let pageKey: string | undefined

  do {
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [{
        fromBlock,
        fromAddress: wallet,
        category: ["external", "erc20"],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: "0x3e8",
        ...(pageKey ? { pageKey } : {}),
      }],
    }

    const res = await fetch(process.env.ALCHEMY_RPC_URL!, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`)

    const data: AlchemyTransfersResponse = await res.json()
    allTransfers = allTransfers.concat(data.result.transfers || [])
    pageKey      = data.result.pageKey

  } while (pageKey)

  return allTransfers.filter((tx) => {
    const txTime = new Date(tx.metadata.blockTimestamp).getTime() / 1000
    return txTime >= mintTimestamp
  })
}

// ─── BaseScan Failed TX Fetcher ──────────────────────────────────────────────

interface BaseScanTx {
  hash: string
  from: string
  to: string
  value: string
  timeStamp: string
  isError: "0" | "1"
  txreceipt_status: "0" | "1" | ""
}

async function fetchBaseScanTxs(
  wallet: string,
  mintTimestamp: number
): Promise<BaseScanTx[]> {
  const apiKey = process.env.BASESCAN_API_KEY
  if (!apiKey) throw new Error("BASESCAN_API_KEY not set")

  const url = new URL("https://api.basescan.org/api")
  url.searchParams.set("module",     "account")
  url.searchParams.set("action",     "txlist")
  url.searchParams.set("address",    wallet)
  url.searchParams.set("startblock", "0")
  url.searchParams.set("endblock",   "99999999")
  url.searchParams.set("sort",       "asc")
  url.searchParams.set("apikey",     apiKey)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`BaseScan API error: ${res.status}`)

  const data = await res.json()
  if (data.status !== "1") return []

  return (data.result as BaseScanTx[]).filter(
    (tx) => parseInt(tx.timeStamp) >= mintTimestamp
  )
}

// ─── ETH Price Fetcher ───────────────────────────────────────────────────────

async function getEthPriceUSD(): Promise<number> {
  try {
    const res  = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    )
    const data = await res.json()
    return data.ethereum.usd
  } catch {
    return 2500
  }
}

// ─── x402 Payment Filter ─────────────────────────────────────────────────────

function isX402Payment(
  tx: AlchemyTransfer,
  agentWallet: string,
  ethPriceUSD: number
): boolean {
  if (!tx.to) return false
  if (tx.to.toLowerCase() === agentWallet.toLowerCase()) return false

  const valueEth = parseInt(tx.value, 16) / 1e18
  const valueUSD = valueEth * ethPriceUSD

  if (valueUSD > 5)     return false
  if (valueUSD < 0.001) return false

  return true
}

// ─── Gap Checker ─────────────────────────────────────────────────────────────

function checkMaxGap(
  payments:      AlchemyTransfer[],
  maxGapHours:   number,
  mintTimestamp: number,
  deadline:      number
): boolean {
  if (payments.length === 0) return false

  const timestamps = payments
    .map((tx) => new Date(tx.metadata.blockTimestamp).getTime() / 1000)
    .sort((a, b) => a - b)

  if (timestamps[0] - mintTimestamp > maxGapHours * 3600) return false

  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > maxGapHours * 3600) return false
  }

  if (deadline - timestamps[timestamps.length - 1] > maxGapHours * 3600) return false

  return true
}

// ─── Level Determination ─────────────────────────────────────────────────────

function determineLevel(
  paymentCount:       number,
  successRate:        number,
  totalUSD:           number,
  distinctRecipients: number
): AchievementLevel | null {
  for (const level of ["gold", "silver", "bronze"] as AchievementLevel[]) {
    const t = X402_THRESHOLDS[level]
    if (
      paymentCount       >= t.minPaymentCount       &&
      successRate        >= t.minSuccessRate         &&
      totalUSD           >= t.minTotalUSD            &&
      distinctRecipients >= t.minDistinctRecipients
    ) return level
  }
  return null
}

// ─── Main Verifier ────────────────────────────────────────────────────────────

export async function verifyX402PaymentReliability(
  params:         X402VerificationParams,
  attestationUID: string
): Promise<VerificationResult> {
  const now      = Math.floor(Date.now() / 1000)
  const deadline = params.mintTimestamp + params.windowDays * 86400

  const [transfers, baseScanTxs, ethPrice] = await Promise.all([
    getAllTransfersSinceMint(params.agentWallet, params.mintTimestamp),
    fetchBaseScanTxs(params.agentWallet, params.mintTimestamp),
    getEthPriceUSD(),
  ])

  const payments           = transfers.filter((tx) => isX402Payment(tx, params.agentWallet, ethPrice))
  const failedTxs          = baseScanTxs.filter((tx) => tx.isError === "1")
  const totalAttempted     = payments.length + failedTxs.length
  const successRate        = totalAttempted === 0 ? 0 : (payments.length / totalAttempted) * 100
  const totalETH           = payments.reduce((sum, tx) => sum + parseInt(tx.value, 16) / 1e18, 0)
  const totalUSD           = totalETH * ethPrice
  const recipients         = new Set(payments.map((tx) => tx.to?.toLowerCase()).filter(Boolean))
  const distinctRecipients = recipients.size

  let gapCheckPassed = true
  if (params.maxGapHours) {
    gapCheckPassed = checkMaxGap(payments, params.maxGapHours, params.mintTimestamp, deadline)
  }

  const baseEvidence = {
    checkedAt:  now,
    dataSource: "alchemy_tx_api + basescan",
    attestationUID,
    rawMetrics: {
      paymentCount:       payments.length,
      totalUSD:           parseFloat(totalUSD.toFixed(4)),
      successRate:        parseFloat(successRate.toFixed(2)),
      distinctRecipients,
    },
  }

  if (totalUSD < 0.10) {
    return {
      passed:        false,
      failureReason: "Total volume below minimum ($0.10). Dust activity filtered.",
      evidence:      baseEvidence,
    }
  }

  if (params.requireDistinctRecipients && distinctRecipients < params.requireDistinctRecipients) {
    return {
      passed:        false,
      failureReason: `Required ${params.requireDistinctRecipients} distinct recipients, found ${distinctRecipients}`,
      evidence:      baseEvidence,
    }
  }

  if (params.maxGapHours && !gapCheckPassed) {
    return {
      passed:        false,
      failureReason: `Activity gap exceeded ${params.maxGapHours}h maximum`,
      evidence:      baseEvidence,
    }
  }

  const level = determineLevel(payments.length, successRate, totalUSD, distinctRecipients)

  const fullMetrics = {
    paymentCount:       payments.length,
    failedCount:        failedTxs.length,
    totalAttempted,
    successRate:        parseFloat(successRate.toFixed(2)),
    totalETH:           parseFloat(totalETH.toFixed(6)),
    totalUSD:           parseFloat(totalUSD.toFixed(4)),
    distinctRecipients,
    windowDays:         params.windowDays,
    ethPriceUsed:       ethPrice,
  }

  if (!level) {
    return {
      passed:        false,
      failureReason: `Metrics did not meet bronze threshold. payments=${payments.length}, successRate=${successRate.toFixed(1)}%, totalUSD=$${totalUSD.toFixed(2)}`,
      evidence:      { ...baseEvidence, rawMetrics: fullMetrics },
    }
  }

  return {
    passed:   true,
    level,
    evidence: { ...baseEvidence, rawMetrics: fullMetrics },
  }
}
// cache-bust: 20260308-012701
