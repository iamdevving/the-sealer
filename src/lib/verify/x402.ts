// src/lib/verify/x402.ts
// Verifier for x402 Payment Reliability achievements
// Data sources: Alchemy Token Transfers API + BaseScan failed tx API

import type { X402VerificationParams, VerificationResult } from './types';
// Note: AchievementLevel and X402_THRESHOLDS removed — outcome is now computed
// from the agent's own committed thresholds in route-handler/cron, not static tiers.

// USDC on Base
const USDC_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

// ── Alchemy types ─────────────────────────────────────────────────────────────

interface AlchemyTransfer {
  hash:     string;
  from:     string;
  to:       string | null;
  value:    string | null;      // token amount as decimal string (not hex)
  rawContract: { value: string; address: string; decimal: string };
  blockNum: string;
  metadata: { blockTimestamp: string };
  asset:    string | null;
  category: string;
}

interface AlchemyResponse {
  result: { transfers: AlchemyTransfer[]; pageKey?: string };
}

// ── USDC transfers via Alchemy ────────────────────────────────────────────────
// We fetch ERC-20 transfers only and filter to USDC contract.
// This is correct — x402 payments are USDC, not ETH.

async function getUSDCTransfersSinceMint(
  wallet:        string,
  mintTimestamp: number,
): Promise<AlchemyTransfer[]> {
  const secondsAgo  = Math.floor(Date.now() / 1000) - mintTimestamp;
  const blocksAgo   = Math.ceil(secondsAgo / 2);                    // ~2s block time on Base
  const tipBlock    = 30_000_000;                                    // safe upper estimate
  const fromBlockHex = `0x${Math.max(0, tipBlock - blocksAgo).toString(16)}`;

  let all:     AlchemyTransfer[] = [];
  let pageKey: string | undefined;

  do {
    const body = {
      id: 1, jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [{
        fromBlock:        fromBlockHex,
        fromAddress:      wallet,
        contractAddresses: [USDC_CONTRACT],
        category:         ['erc20'],
        withMetadata:     true,
        excludeZeroValue: true,
        maxCount:         '0x3e8',
        ...(pageKey ? { pageKey } : {}),
      }],
    };

    const res = await fetch(process.env.ALCHEMY_RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Alchemy API ${res.status}`);

    const data: AlchemyResponse = await res.json();
    all     = all.concat(data.result?.transfers ?? []);
    pageKey = data.result?.pageKey;
  } while (pageKey);

  // Filter to transfers that happened after commitment was minted
  return all.filter(tx => {
    const ts = new Date(tx.metadata.blockTimestamp).getTime() / 1000;
    return ts >= mintTimestamp;
  });
}

// ── Failed txs via BaseScan ───────────────────────────────────────────────────

interface BaseScanTx {
  hash: string; from: string; to: string;
  timeStamp: string; isError: '0' | '1';
}

async function getFailedTxsSinceMint(
  wallet:        string,
  mintTimestamp: number,
): Promise<BaseScanTx[]> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) return [];

  const url = new URL('https://api.etherscan.io/v2/api');
  url.searchParams.set('chainid', '8453');
  url.searchParams.set('module',     'account');
  url.searchParams.set('action',     'txlist');
  url.searchParams.set('address',    wallet);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock',   '99999999');
  url.searchParams.set('sort',       'asc');
  url.searchParams.set('apikey',     apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return [];

  const data = await res.json();
  if (data.status !== '1') return [];

  return (data.result as BaseScanTx[]).filter(tx =>
    tx.isError === '1' && parseInt(tx.timeStamp) >= mintTimestamp,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function usdcAmount(tx: AlchemyTransfer): number {
  // Alchemy returns token value as decimal string in tx.value
  // USDC has 6 decimals
  const raw = tx.rawContract?.value;
  if (raw) return parseInt(raw, 16) / 1e6;
  const val = tx.value;
  if (val) return parseFloat(val);
  return 0;
}

function isX402Payment(tx: AlchemyTransfer, agentWallet: string): boolean {
  if (!tx.to) return false;
  // Not a self-transfer
  if (tx.to.toLowerCase() === agentWallet.toLowerCase()) return false;
  // Must be USDC
  if (tx.rawContract?.address?.toLowerCase() !== USDC_CONTRACT.toLowerCase()) return false;
  const amount = usdcAmount(tx);
  // x402 payments are typically $0.001–$5; filter noise and large transfers
  return amount >= 0.001 && amount <= 5;
}

function checkMaxGap(
  payments:      AlchemyTransfer[],
  maxGapHours:   number,
  mintTimestamp: number,
  deadline:      number,
): boolean {
  if (payments.length === 0) return false;

  const timestamps = payments
    .map(tx => new Date(tx.metadata.blockTimestamp).getTime() / 1000)
    .sort((a, b) => a - b);

  if (timestamps[0] - mintTimestamp > maxGapHours * 3600) return false;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > maxGapHours * 3600) return false;
  }
  if (deadline - timestamps[timestamps.length - 1] > maxGapHours * 3600) return false;

  return true;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifyX402PaymentReliability(
  params:         X402VerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now      = Math.floor(Date.now() / 1000);
  const deadline = params.mintTimestamp + params.windowDays * 86400;

  const [usdcTransfers, failedTxs] = await Promise.all([
    getUSDCTransfersSinceMint(params.agentWallet, params.mintTimestamp),
    getFailedTxsSinceMint(params.agentWallet, params.mintTimestamp),
  ]);

  // Only count transfers to other addresses (outgoing x402 payments)
  const payments           = usdcTransfers.filter(tx => isX402Payment(tx, params.agentWallet));
  const totalAttempted     = payments.length + failedTxs.length;
  const successRate        = totalAttempted === 0 ? 0 : (payments.length / totalAttempted) * 100;
  const totalUSD           = payments.reduce((sum, tx) => sum + usdcAmount(tx), 0);
  const recipients         = new Set(payments.map(tx => tx.to?.toLowerCase()).filter(Boolean));
  const distinctRecipients = recipients.size;

  const baseEvidence = {
    checkedAt:      now,
    dataSource:     'alchemy_erc20_transfers + basescan_failed_txs',
    attestationUID,
    rawMetrics: {
      paymentCount:       payments.length,
      failedCount:        failedTxs.length,
      totalAttempted,
      successRate:        parseFloat(successRate.toFixed(2)),
      totalUSD:           parseFloat(totalUSD.toFixed(4)),
      distinctRecipients,
      windowDays:         params.windowDays,
    },
  };

  // ── Check committed thresholds (agent's own targets, not static tiers) ────
  const minSuccess    = params.minSuccessRate    ?? 95;
  const minTotal      = params.minTotalUSD       ?? 0;
  const minRecipients = params.requireDistinctRecipients ?? 0;

  const meetsSuccessRate  = successRate >= minSuccess;
  const meetsTotalUSD     = totalUSD    >= minTotal;
  const meetsRecipients   = distinctRecipients >= minRecipients;
  const meetsGap          = params.maxGapHours
    ? checkMaxGap(payments, params.maxGapHours, params.mintTimestamp, deadline)
    : true;

  // If nothing at all — fail fast
  if (payments.length === 0) {
    return {
      passed:        false,
      failureReason: 'No USDC x402 payments detected in the commitment window.',
      evidence:      baseEvidence,
    };
  }

  // Partial pass check: did they meet at least some metrics?
  const metricResults = {
    successRate:  meetsSuccessRate,
    totalUSD:     meetsTotalUSD,
    recipients:   meetsRecipients,
    gap:          meetsGap,
  };
  const metricsPassed = Object.values(metricResults).filter(Boolean).length;
  const metricsTotal  = Object.values(metricResults).length;

  const fullPass = meetsSuccessRate && meetsTotalUSD && meetsRecipients && meetsGap;

  if (!fullPass) {
    const reasons: string[] = [];
    if (!meetsSuccessRate)  reasons.push(`success rate ${successRate.toFixed(1)}% < ${minSuccess}%`);
    if (!meetsTotalUSD)     reasons.push(`total volume $${totalUSD.toFixed(2)} < $${minTotal}`);
    if (!meetsRecipients)   reasons.push(`distinct recipients ${distinctRecipients} < ${minRecipients}`);
    if (!meetsGap)          reasons.push(`activity gap exceeded ${params.maxGapHours}h`);

    // Still pass as partial if they have payments and met some metrics
    const partialPass = payments.length > 0 && metricsPassed > 0;

    return {
      passed:        partialPass,
      failureReason: reasons.join('; '),
      evidence: {
        ...baseEvidence,
        rawMetrics: { ...baseEvidence.rawMetrics, metricsPassed, metricsTotal },
      },
    };
  }

  return {
    passed:   true,
    evidence: {
      ...baseEvidence,
      rawMetrics: { ...baseEvidence.rawMetrics, metricsPassed: metricsTotal, metricsTotal },
    },
  };
}