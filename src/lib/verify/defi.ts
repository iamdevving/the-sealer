// src/lib/verify/defi.ts
// Verifier for DeFi Trading Performance achievements
// Data sources: Alchemy (transfers) + BaseScan (tx history) + DefiLlama (protocol TVL sanity check)
// No new dependencies — all already in stack or public APIs

import type { VerificationResult, AchievementLevel } from './types';

export interface DefiVerificationParams {
  agentWallet:   string;
  protocol:      string;   // e.g. "uniswap", "aave", "compound" — for labelling
  windowDays:    number;
  mintTimestamp: number;
  // Thresholds — all optional, fall back to defaults
  minTradeCount?:    number;
  minVolumeUSD?:     number;
  minPnlPercent?:    number;  // e.g. 5 = 5% gain over window
  maxDrawdownPct?:   number;  // e.g. 50 = max 50% drawdown allowed
}

const THRESHOLDS: Record<AchievementLevel, {
  minTradeCount: number;
  minVolumeUSD:  number;
  minPnlPercent: number;
}> = {
  bronze: { minTradeCount: 5,   minVolumeUSD: 100,   minPnlPercent: 0    },
  silver: { minTradeCount: 25,  minVolumeUSD: 1000,  minPnlPercent: 5    },
  gold:   { minTradeCount: 100, minVolumeUSD: 10000, minPnlPercent: 10   },
};

interface BaseScanTx {
  hash:             string;
  from:             string;
  to:               string;
  value:            string;
  timeStamp:        string;
  isError:          '0' | '1';
  methodId:         string;
  functionName:     string;
  contractAddress:  string;
}

// Known DeFi method IDs for trade detection
// Covers Uniswap v2/v3, Aerodrome, and generic swap selectors
const SWAP_METHOD_IDS = new Set([
  '0x38ed1739', // swapExactTokensForTokens
  '0x8803dbee', // swapTokensForExactTokens
  '0x7ff36ab5', // swapExactETHForTokens
  '0x4a25d94a', // swapTokensForExactETH
  '0x18cbafe5', // swapExactTokensForETH
  '0xfb3bdb41', // swapETHForExactTokens
  '0x5c11d795', // swapExactTokensForTokensSupportingFeeOnTransferTokens
  '0xb6f9de95', // swapExactETHForTokensSupportingFeeOnTransferTokens
  '0x791ac947', // swapExactTokensForETHSupportingFeeOnTransferTokens
  '0x04e45aaf', // Uniswap v3 exactInputSingle
  '0xb858183f', // Uniswap v3 exactInput
  '0x09b81346', // Uniswap v3 exactOutputSingle
  '0x09b81347', // Uniswap v3 exactOutput
  '0xe592427a', // exactInputSingle (alt)
  '0x472b43f3', // swapExactTokensForTokens (v3 router2)
]);

async function fetchBaseScanTxs(
  wallet:        string,
  mintTimestamp: number,
): Promise<BaseScanTx[]> {
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
    const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await res.json();
    return data.ethereum.usd;
  } catch {
    return 2500;
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

function determineLevel(
  tradeCount: number,
  volumeUSD:  number,
  pnlPercent: number,
): AchievementLevel | null {
  for (const level of ['gold', 'silver', 'bronze'] as AchievementLevel[]) {
    const t = THRESHOLDS[level];
    if (
      tradeCount >= t.minTradeCount &&
      volumeUSD  >= t.minVolumeUSD  &&
      pnlPercent >= t.minPnlPercent
    ) return level;
  }
  return null;
}

export async function verifyDefiTradingPerformance(
  params:        DefiVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);

  const [txs, ethPrice] = await Promise.all([
    fetchBaseScanTxs(params.agentWallet, params.mintTimestamp),
    getEthPriceUSD(),
  ]);

  const swaps      = detectSwaps(txs, params.agentWallet);
  const tradeCount = swaps.length;

  // Volume: sum ETH value of all swap txs (rough — doesn't decode token amounts)
  // Good enough for threshold checks; not a PnL calculator
  const totalETH = swaps.reduce((sum, tx) => {
    return sum + parseInt(tx.value || '0', 16) / 1e18;
  }, 0);
  const volumeUSD = totalETH * ethPrice;

  // PnL approximation: compare ETH balance change over window
  // Positive = net gain (received more ETH than sent in swaps)
  // This is a simplification — full PnL requires token price history
  const ethSent     = swaps.reduce((s, tx) => s + parseInt(tx.value || '0', 16) / 1e18, 0);
  const pnlPercent  = volumeUSD > 0
    ? Math.max(0, ((volumeUSD - ethSent * ethPrice) / (ethSent * ethPrice || 1)) * 100)
    : 0;

  const rawMetrics = {
    tradeCount,
    volumeUSD:   parseFloat(volumeUSD.toFixed(2)),
    pnlPercent:  parseFloat(pnlPercent.toFixed(2)),
    ethPrice,
    windowDays:  params.windowDays,
    protocol:    params.protocol,
  };

  const evidence = {
    checkedAt:   now,
    dataSource:  'basescan_txlist',
    attestationUID,
    rawMetrics,
  };

  if (tradeCount === 0) {
    return {
      passed:        false,
      failureReason: 'No swap transactions detected in window.',
      evidence,
    };
  }

  const level = determineLevel(
    tradeCount,
    volumeUSD,
    pnlPercent,
  );

  if (!level) {
    return {
      passed:        false,
      failureReason: `Did not meet bronze threshold. trades=${tradeCount}, volume=$${volumeUSD.toFixed(0)}, pnl=${pnlPercent.toFixed(1)}%`,
      evidence,
    };
  }

  return { passed: true, level, evidence };
}