// src/lib/verify/defi.ts
// Verifier for DeFi Trading Performance achievements
//
// Supports two chains:
//   base   — BaseScan tx history + known EVM DEX method IDs + Coingecko ETH price
//   solana — Helius Enhanced Transactions API (SWAP type, single REST call per page)
//
// PnL approach (both chains):
//   Entry price at mintTimestamp vs exit price at verification time.
//   Uses ETH/SOL price movement as proxy. If Coingecko unavailable, pnl is skipped.
//
// Anti-gaming (Base):
//   Only transactions matching known DEX router method IDs are counted.
//
// Anti-gaming (Solana):
//   Only SWAP-type transactions from Helius Enhanced API are counted.
//   Helius classifies SWAPs based on known DEX programs (Jupiter, Orca, Raydium etc.)

import type { VerificationResult, AchievementLevel } from './types';

export interface DefiVerificationParams {
  agentWallet:    string;
  protocol:       string;
  chain?:         'base' | 'solana';  // default: 'base'
  windowDays:     number;
  mintTimestamp:  number;
  minTradeCount?: number;
  minVolumeUSD?:  number;
  minPnlPercent?: number;
  maxDrawdownPct?: number;
}

const THRESHOLDS: Record<AchievementLevel, {
  minTradeCount: number;
  minVolumeUSD:  number;
}> = {
  bronze: { minTradeCount: 5,   minVolumeUSD: 100   },
  silver: { minTradeCount: 25,  minVolumeUSD: 1000  },
  gold:   { minTradeCount: 100, minVolumeUSD: 10000 },
};

// ── Base: known DEX router contract addresses ────────────────────────────────
// Matching on router address is more reliable than method IDs —
// covers all functions (exactInput, exactOutput, execute, multicall etc.)
//
// Uniswap v2 Router:          0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
// Uniswap v3 Router:          0x2626664c2603336E57B271c5C0b26F421741e481
// Uniswap Universal Router:   0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD
// Aerodrome Router:            0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
// Velodrome Router:            0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858
// SushiSwap Router:            0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891
// BaseSwap Router:             0x327Df1E6de05895d2ab08513aaDD9313Fe505d86
// SwapBased Router:            0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066
// 0x Protocol (Permit2):       0xdef1c0ded9bec7f1a1670819833240f027b25eff
// Odos Router:                 0x19cEeAd7105607Cd444F5ad10dd51356716fA3F9

const DEX_ROUTER_ADDRESSES = new Set([
  '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',   // Uniswap v2
  '0x2626664c2603336e57b271c5c0b26f421741e481',   // Uniswap v3 SwapRouter02
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',   // Uniswap Universal Router
  '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',   // Aerodrome
  '0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858',   // Velodrome
  '0x6bded42c6da8fbf0d2ba55b2fa120c5e0c8d7891',   // SushiSwap
  '0x327df1e6de05895d2ab08513aadd9313fe505d86',   // BaseSwap
  '0xaaa3b1f1bd7bcc97fd1917c18ade665c5d31f066',   // SwapBased
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff',   // 0x Protocol
  '0x19ceead7105607cd444f5ad10dd51356716fa3f9',   // Odos
]);

// Solana USDC mint
const SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ── Base chain helpers ────────────────────────────────────────────────────────

interface BaseScanTx {
  hash: string; from: string; to: string;
  value: string; timeStamp: string;
  isError: '0' | '1'; methodId: string; functionName: string;
}

async function fetchBaseScanTxs(wallet: string, mintTimestamp: number): Promise<BaseScanTx[]> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) throw new Error('BASESCAN_API_KEY not set');

  // Etherscan API V2 — V1 (api.basescan.org) is deprecated
  const url = new URL('https://api.etherscan.io/v2/api');
  url.searchParams.set('chainid',    '8453');   // Base mainnet
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
    tx => parseInt(tx.timeStamp) >= mintTimestamp && tx.isError === '0'
  );
}

function detectSwaps(txs: BaseScanTx[], wallet: string): BaseScanTx[] {
  return txs.filter(tx =>
    tx.from.toLowerCase() === wallet.toLowerCase() &&
    tx.to &&
    tx.to.toLowerCase() !== wallet.toLowerCase() &&
    tx.isError === '0' &&
    DEX_ROUTER_ADDRESSES.has(tx.to.toLowerCase())
  );
}

// ── Solana helpers ────────────────────────────────────────────────────────────
// Uses Helius Enhanced Transactions API — single REST call per page,
// SWAP type filter built-in, no getSignaturesForAddress + getParsedTransactions needed.

interface HeliusEnhancedTx {
  type:             string;   // e.g. "SWAP"
  timestamp:        number;   // unix seconds
  signature:        string;
  nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[];
  tokenTransfers?:  { fromUserAccount: string; toUserAccount: string; mint: string; tokenAmount: number }[];
}

interface SolanaSwap {
  signature: string;
  blockTime:  number;
  volumeUSD:  number;
}

async function fetchSolanaSwaps(
  wallet:        string,
  mintTimestamp: number,
  solPriceUSD:   number,
): Promise<SolanaSwap[]> {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) throw new Error('HELIUS_API_KEY not set');

  const swaps: SolanaSwap[] = [];
  let before: string | undefined;
  const maxPages = 10; // 100 txs/page × 10 pages = 1000 max

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(
      `https://api-mainnet.helius-rpc.com/v0/addresses/${wallet}/transactions`
    );
    url.searchParams.set('api-key', heliusKey);
    url.searchParams.set('type',    'SWAP');
    url.searchParams.set('limit',   '100');
    if (before) url.searchParams.set('before', before);

    let data: HeliusEnhancedTx[];
    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        const retry = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
        if (!retry.ok) throw new Error(`Helius Enhanced API ${retry.status}`);
        data = await retry.json();
      } else {
        if (!res.ok) throw new Error(`Helius Enhanced API ${res.status}`);
        data = await res.json();
      }
    } catch (err) {
      throw new Error(`Helius Enhanced Transactions API failed: ${String(err)}`);
    }

    if (!Array.isArray(data) || !data.length) break;

    const inWindow = data.filter(tx => tx.timestamp >= mintTimestamp);

    for (const tx of inWindow) {
      let volumeUSD = 0;

      // Sum USDC token transfers involving this wallet
      for (const t of tx.tokenTransfers ?? []) {
        if (t.mint === SOL_USDC_MINT &&
            (t.fromUserAccount === wallet || t.toUserAccount === wallet)) {
          volumeUSD += t.tokenAmount;
        }
      }

      // Fall back to SOL native transfers if no USDC flow
      if (volumeUSD === 0) {
        for (const t of tx.nativeTransfers ?? []) {
          if (t.fromUserAccount === wallet) {
            volumeUSD += (t.amount / 1e9) * solPriceUSD;
          }
        }
      }

      swaps.push({ signature: tx.signature, blockTime: tx.timestamp, volumeUSD });
    }

    const oldest = data[data.length - 1];
    if (!oldest || oldest.timestamp < mintTimestamp) break;

    before = oldest.signature;
    if (data.length < 100) break; // last page

    await new Promise(r => setTimeout(r, 300)); // rate limit courtesy delay
  }

  return swaps;
}

// ── Price helpers (shared) ────────────────────────────────────────────────────

async function getCoinPrice(coinId: 'ethereum' | 'solana'): Promise<number> {
  const fallback = coinId === 'ethereum' ? 2500 : 150;
  try {
    const res  = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return data[coinId]?.usd ?? fallback;
  } catch {
    return fallback;
  }
}

async function getCoinPriceAtTime(
  coinId:        'ethereum' | 'solana',
  mintTimestamp: number,
): Promise<number | null> {
  try {
    const date    = new Date(mintTimestamp * 1000);
    const dd      = String(date.getUTCDate()).padStart(2, '0');
    const mm      = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy    = date.getUTCFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;

    const res  = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&localization=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.market_data?.current_price?.usd ?? null;
  } catch {
    return null;
  }
}

async function estimatePnl(
  nativeDeployed: number,
  entryPrice:     number | null,
  exitPrice:      number,
): Promise<{ pnlPercent: number | null; pnlComputed: boolean }> {
  if (!entryPrice || nativeDeployed === 0) {
    return { pnlPercent: null, pnlComputed: false };
  }
  const entryUSD = nativeDeployed * entryPrice;
  const exitUSD  = nativeDeployed * exitPrice;
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

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifyDefiTradingPerformance(
  params:         DefiVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now   = Math.floor(Date.now() / 1000);
  const chain = params.chain ?? 'base';

  // ── Solana path ────────────────────────────────────────────────────────────
  if (chain === 'solana') {
    const [exitSolPrice, entrySolPrice] = await Promise.all([
      getCoinPrice('solana'),
      getCoinPriceAtTime('solana', params.mintTimestamp),
    ]);

    let swaps: SolanaSwap[] = [];
    try {
      swaps = await fetchSolanaSwaps(params.agentWallet, params.mintTimestamp, exitSolPrice);
    } catch (err) {
      return {
        passed:        false,
        failureReason: `Solana verification failed: ${String(err)}`,
        evidence: {
          checkedAt: now, dataSource: 'helius_enhanced_transactions_api',
          attestationUID, rawMetrics: { chain: 'solana' },
        },
      };
    }

    const tradeCount = swaps.length;
    const volumeUSD  = swaps.reduce((s, sw) => s + sw.volumeUSD, 0);
    const solDeployed = volumeUSD / exitSolPrice;
    const { pnlPercent, pnlComputed } = await estimatePnl(solDeployed, entrySolPrice, exitSolPrice);

    const rawMetrics = {
      chain:         'solana',
      tradeCount,
      volumeUSD:     parseFloat(volumeUSD.toFixed(2)),
      pnlPercent:    pnlPercent ?? 0,
      pnlComputed,
      entrySOLPrice: entrySolPrice ?? 0,
      exitSOLPrice:  exitSolPrice,
      windowDays:    params.windowDays,
      protocol:      params.protocol,
      dataSource:    'helius_enhanced_transactions_api',
    };

    const evidence = {
      checkedAt:  now,
      dataSource: 'helius_enhanced_transactions_api (SWAP type)',
      attestationUID,
      rawMetrics,
    };

    if (tradeCount === 0) {
      return { passed: false, failureReason: 'No DEX swap transactions detected on Solana in the commitment window.', evidence };
    }

    if (params.minPnlPercent && params.minPnlPercent > 0 && !pnlComputed) {
      return {
        passed:        false,
        failureReason: 'PnL could not be computed (Coingecko SOL price history unavailable). Remove minPnlPercent or retry later.',
        evidence,
      };
    }

    const meetsTradeCount = tradeCount >= (params.minTradeCount ?? 0);
    const meetsVolumeUSD  = volumeUSD  >= (params.minVolumeUSD  ?? 0);
    const meetsPnl        = !params.minPnlPercent || pnlPercent === null
      ? true : pnlPercent >= params.minPnlPercent;

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

  // ── Base path (default) ───────────────────────────────────────────────────
  const [txs, exitEthPrice, entryEthPrice] = await Promise.all([
    fetchBaseScanTxs(params.agentWallet, params.mintTimestamp),
    getCoinPrice('ethereum'),
    getCoinPriceAtTime('ethereum', params.mintTimestamp),
  ]);

  const swaps      = detectSwaps(txs, params.agentWallet);
  const tradeCount = swaps.length;
  const totalETH   = swaps.reduce((s, tx) => s + parseInt(tx.value || '0') / 1e18, 0);
  const volumeUSD  = totalETH * exitEthPrice;

  const { pnlPercent, pnlComputed } = await estimatePnl(totalETH, entryEthPrice, exitEthPrice);

  const rawMetrics = {
    chain:         'base',
    tradeCount,
    volumeUSD:     parseFloat(volumeUSD.toFixed(2)),
    pnlPercent:    pnlPercent ?? 0,
    pnlComputed,
    entryEthPrice: entryEthPrice ?? 0,
    exitEthPrice,
    windowDays:    params.windowDays,
    protocol:      params.protocol,
  };

  const evidence = {
    checkedAt:  now,
    dataSource: 'basescan_txlist + known_dex_method_ids + coingecko_price_history',
    attestationUID,
    rawMetrics,
  };

  if (tradeCount === 0) {
    return { passed: false, failureReason: 'No DEX swap transactions detected on Base in the commitment window.', evidence };
  }

  if (params.minPnlPercent && params.minPnlPercent > 0 && !pnlComputed) {
    return {
      passed:        false,
      failureReason: 'PnL could not be computed (Coingecko ETH price history unavailable). Remove minPnlPercent or retry later.',
      evidence,
    };
  }

  const meetsTradeCount = tradeCount >= (params.minTradeCount ?? 0);
  const meetsVolumeUSD  = volumeUSD  >= (params.minVolumeUSD  ?? 0);
  const meetsPnl        = !params.minPnlPercent || pnlPercent === null
    ? true : pnlPercent >= params.minPnlPercent;

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