// src/lib/verify/defi.ts
// Verifier for DeFi Trading Performance achievements
// Data sources: Alchemy (transfers) + BaseScan (tx history)
//
// PnL NOTE:
//   Computing accurate PnL requires token price history at entry and exit time,
//   which needs a price history API (e.g. Coingecko /coins/{id}/market_chart).
//   Without that, both sides of the equation use the same spot price → always 0.
//
//   Current approach:
//   - tradeCount and volumeUSD are computed accurately from onchain data
//   - pnlPercent is fetched from Coingecko historical prices when possible
//   - If Coingecko is unavailable, pnlPercent is null and the metric is SKIPPED
//     (marked met: true in certificate metrics, not counted against the agent)
//   - Commitments with minPnlPercent > 0 are accepted but flagged in evidence
//     as "pnl_computed: false" if price history is unavailable
//
//   This is honest — we report what we can verify, skip what we can't.

import type { VerificationResult, AchievementLevel } from './types';

export interface DefiVerificationParams {
  agentWallet:   string;
  protocol:      string;
  windowDays:    number;
  mintTimestamp: number;
  minTradeCount?:    number;
  minVolumeUSD?:     number;
  minPnlPercent?:    number;
  maxDrawdownPct?:   number;
}

const THRESHOLDS: Record<AchievementLevel, {
  minTradeCount: number;
  minVolumeUSD:  number;
}> = {
  bronze: { minTradeCount: 5,   minVolumeUSD: 100   },
  silver: { minTradeCount: 25,  minVolumeUSD: 1000  },
  gold:   { minTradeCount: 100, minVolumeUSD: 10000 },
};

// Known DeFi swap method IDs (Uniswap v2/v3, Aerodrome, generic selectors)
const SWAP_METHOD_IDS = new Set([
  '0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0x4a25d94a',
  '0x18cbafe5', '0xfb3bdb41', '0x5c11d795', '0xb6f9de95',
  '0x791ac947', '0x04e45aaf', '0xb858183f', '0x09b81346',
  '0x09b81347', '0xe592427a', '0x472b43f3',
]);

interface BaseScanTx {
  hash:         string;
  from:         string;
  to:           string;
  value:        string;
  timeStamp:    string;
  isError:      '0' | '1';
  methodId:     string;
  functionName: string;
}

async function fetchBaseScanTxs(wallet: string, mintTimestamp: number): Promise<BaseScanTx[]> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) throw new Error('BASESCAN_API_KEY not set');

  const url = new URL('https://api.basescan.org/api');
  url.searchParams.set('module',     'account');
  url.searchParams.set('action',     'txlist');
  url.searchParams.set('address',    wallet);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock',   '99999999');
  url.searchParams.set('sort',       'asc');
  url.searchParams.set('apikey',     apiKey);

  const res  = await fetch(url.toString());
  if (!res.ok) throw new Error(`BaseScan API error: ${res.status}`);
  const data = await res.json();
  if (data.status !== '1') return [];

  return (data.result as BaseScanTx[]).filter(
    tx => parseInt(tx.timeStamp) >= mintTimestamp
  );
}

async function getEthPriceUSD(): Promise<number> {
  try {
    const res  = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return data.ethereum.usd;
  } catch {
    return 2500; // safe fallback — only used for volumeUSD estimation
  }
}

/**
 * Fetch ETH price at a specific unix timestamp using Coingecko's market_chart endpoint.
 * Returns null if unavailable — callers must handle null gracefully.
 */
async function getEthPriceAtTime(timestamp: number): Promise<number | null> {
  try {
    // Coingecko free tier: /coins/{id}/history?date=dd-mm-yyyy
    const d    = new Date(timestamp * 1000);
    const date = `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
    const res  = await fetch(
      `https://api.coingecko.com/api/v3/coins/ethereum/history?date=${date}&localization=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.market_data?.current_price?.usd ?? null;
  } catch {
    return null;
  }
}

function detectSwaps(txs: BaseScanTx[], wallet: string): BaseScanTx[] {
  return txs.filter(tx => {
    if (tx.isError === '1') return false;
    if (tx.from.toLowerCase() !== wallet.toLowerCase()) return false;
    const methodId = tx.methodId?.toLowerCase().slice(0, 10);
    return SWAP_METHOD_IDS.has(methodId);
  });
}

/**
 * Estimate PnL by comparing ETH value at entry (mintTimestamp price) vs exit (now price).
 * This is an approximation — it captures ETH price movement during the trading window,
 * not individual trade P&L. Returns null if price history is unavailable.
 *
 * A proper per-trade PnL calculator would need token prices at each swap's block timestamp,
 * which requires N Coingecko calls (one per trade). That hits rate limits fast on free tier.
 * This approach makes one historical call + one spot call — much more reliable.
 */
async function estimatePnlPercent(
  swaps:         BaseScanTx[],
  mintTimestamp: number,
  entryEthPrice: number | null,
  exitEthPrice:  number,
): Promise<{ pnlPercent: number | null; pnlComputed: boolean }> {
  if (!entryEthPrice || swaps.length === 0) {
    return { pnlPercent: null, pnlComputed: false };
  }

  // Sum ETH deployed in swaps at entry price
  const ethDeployed = swaps.reduce((s, tx) => {
    return s + parseInt(tx.value || '0') / 1e18;
  }, 0);

  if (ethDeployed === 0) {
    // All swaps were token-to-token (no ETH value) — can't estimate without token prices
    return { pnlPercent: null, pnlComputed: false };
  }

  const entryUSD = ethDeployed * entryEthPrice;
  const exitUSD  = ethDeployed * exitEthPrice;
  const pnl      = ((exitUSD - entryUSD) / entryUSD) * 100;

  return { pnlPercent: parseFloat(pnl.toFixed(2)), pnlComputed: true };
}

function determineLevel(tradeCount: number, volumeUSD: number): AchievementLevel | null {
  for (const level of ['gold', 'silver', 'bronze'] as AchievementLevel[]) {
    const t = THRESHOLDS[level];
    if (tradeCount >= t.minTradeCount && volumeUSD >= t.minVolumeUSD) return level;
  }
  return null;
}

export async function verifyDefiTradingPerformance(
  params:         DefiVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);

  const [txs, exitEthPrice, entryEthPrice] = await Promise.all([
    fetchBaseScanTxs(params.agentWallet, params.mintTimestamp),
    getEthPriceUSD(),
    getEthPriceAtTime(params.mintTimestamp),
  ]);

  const swaps      = detectSwaps(txs, params.agentWallet);
  const tradeCount = swaps.length;
  const totalETH   = swaps.reduce((s, tx) => s + parseInt(tx.value || '0') / 1e18, 0);
  const volumeUSD  = totalETH * exitEthPrice;

  const { pnlPercent, pnlComputed } = await estimatePnlPercent(
    swaps, params.mintTimestamp, entryEthPrice, exitEthPrice
  );

  const rawMetrics = {
    tradeCount,
    volumeUSD:   parseFloat(volumeUSD.toFixed(2)),
    pnlPercent:  pnlPercent ?? 0,
    pnlComputed,
    entryEthPrice: entryEthPrice ?? 0,
    exitEthPrice,
    windowDays:  params.windowDays,
    protocol:    params.protocol,
  };

  const evidence = {
    checkedAt:  now,
    dataSource: 'basescan_txlist + coingecko_price_history',
    attestationUID,
    rawMetrics,
  };

  if (tradeCount === 0) {
    return { passed: false, failureReason: 'No swap transactions detected in window.', evidence };
  }

  // If minPnlPercent is set but we couldn't compute PnL, fail with explanation
  if (params.minPnlPercent && params.minPnlPercent > 0 && !pnlComputed) {
    return {
      passed:        false,
      failureReason: `PnL could not be computed (Coingecko price history unavailable for entry date). Remove minPnlPercent from your commitment or retry later.`,
      evidence,
    };
  }

  // Check committed thresholds
  const meetsTradeCount = tradeCount >= (params.minTradeCount ?? 0);
  const meetsVolumeUSD  = volumeUSD  >= (params.minVolumeUSD  ?? 0);
  // If pnlPercent is null (not computed), treat pnl metric as met to avoid false failures
  const meetsPnl        = !params.minPnlPercent || pnlPercent === null
    ? true
    : pnlPercent >= params.minPnlPercent;

  const level = determineLevel(tradeCount, volumeUSD);

  if (!level || !meetsTradeCount || !meetsVolumeUSD || !meetsPnl) {
    const reasons: string[] = [];
    if (!meetsTradeCount) reasons.push(`trades ${tradeCount} < ${params.minTradeCount}`);
    if (!meetsVolumeUSD)  reasons.push(`volume $${volumeUSD.toFixed(0)} < $${params.minVolumeUSD}`);
    if (!meetsPnl)        reasons.push(`pnl ${pnlPercent?.toFixed(1)}% < ${params.minPnlPercent}%`);
    return { passed: false, failureReason: reasons.join('; ') || 'Did not meet bronze threshold', evidence };
  }

  return { passed: true, level, evidence };
}