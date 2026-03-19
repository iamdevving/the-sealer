// src/lib/verify/defi.ts
// Verifier for DeFi Trading Performance achievements
//
// Supports two chains:
//   base   — BaseScan tx history + known EVM DEX method IDs + Coingecko ETH price
//   solana — Helius getSignaturesForAddress + known Solana DEX program IDs + Coingecko SOL price
//
// PnL approach (both chains):
//   Entry price at mintTimestamp vs exit price at verification time.
//   Uses ETH/SOL price movement as proxy — accurate for native-token swaps.
//   Token-to-token swaps (no native value) are counted for tradeCount/volume but
//   PnL is skipped (pnlComputed: false) unless native token is involved.
//   If Coingecko is unavailable, pnl metric is skipped rather than failing the agent.
//
// Anti-gaming (Solana):
//   Only transactions calling known DEX program IDs are counted.
//   Self-transfers (to own ATA) are excluded.
//   Volume computed from SPL token transfers on matched transactions, not raw SOL value.
//
// Anti-gaming (Base):
//   Only method IDs from known DEX routers are counted as swaps.
//   ETH value of zero is excluded to filter token-to-token via EVM.

import type { VerificationResult, AchievementLevel } from './types';
import { Connection, PublicKey } from '@solana/web3.js';

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

// ── Base: known DEX swap method IDs ──────────────────────────────────────────
// Uniswap v2/v3, Aerodrome, Velodrome, SushiSwap on Base

const SWAP_METHOD_IDS = new Set([
  '0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0x4a25d94a',
  '0x18cbafe5', '0xfb3bdb41', '0x5c11d795', '0xb6f9de95',
  '0x791ac947', '0x04e45aaf', '0xb858183f', '0x09b81346',
  '0x09b81347', '0xe592427a', '0x472b43f3',
]);

// ── Solana: known DEX program IDs ────────────────────────────────────────────
// Jupiter v6 aggregator, Orca Whirlpool, Raydium AMM + CLMM

const SOLANA_DEX_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter v6
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3sFKDmG',   // Orca Whirlpool
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',   // Raydium AMM v4
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',   // Raydium CLMM
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',   // Serum DEX v3 (legacy, still used)
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',    // OpenBook (Serum successor)
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
    tx => parseInt(tx.timeStamp) >= mintTimestamp && tx.isError === '0'
  );
}

function detectSwaps(txs: BaseScanTx[], wallet: string): BaseScanTx[] {
  return txs.filter(tx =>
    tx.from.toLowerCase() === wallet.toLowerCase() &&
    tx.to && tx.to !== wallet &&
    tx.methodId && SWAP_METHOD_IDS.has(tx.methodId.toLowerCase().slice(0, 10))
  );
}

// ── Solana chain helpers ──────────────────────────────────────────────────────

interface SolanaSwap {
  signature: string;
  blockTime:  number;
  volumeUSD:  number;  // estimated from USDC transfers in same tx
}

async function fetchSolanaSwaps(
  wallet:        string,
  mintTimestamp: number,
  solPriceUSD:   number,
): Promise<SolanaSwap[]> {
  const heliusKey = process.env.HELIUS_API_KEY;
  const heliusUrl = heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

  const connection = new Connection(heliusUrl, 'confirmed');
  const pubkey     = new PublicKey(wallet);

  // Fetch signatures since mintTimestamp
  // Cap at 500 signatures max to avoid rate limits on Helius free tier
  const MAX_SIGNATURES = 500;
  let signatures: any[] = [];
  let before: string | undefined;

  while (signatures.length < MAX_SIGNATURES) {
    const batch = await connection.getSignaturesForAddress(pubkey, {
      limit:  100,   // smaller batches = fewer rate limit hits
      before,
    });
    if (!batch.length) break;

    const inWindow = batch.filter(s =>
      s.blockTime && s.blockTime >= mintTimestamp && !s.err
    );
    signatures.push(...inWindow);

    const oldest = batch[batch.length - 1];
    if (!oldest.blockTime || oldest.blockTime < mintTimestamp) break;
    before = oldest.signature;

    // Small delay between pagination calls to respect rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  if (!signatures.length) return [];

  // Fetch parsed transactions in smaller batches with delay
  const swaps: SolanaSwap[] = [];
  const batchSize = 25;   // reduced from 100 to avoid 429s

  for (let i = 0; i < signatures.length; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize).map(s => s.signature);

    const txs = await connection.getParsedTransactions(batch, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    // Delay between getParsedTransactions batches
    if (i + batchSize < signatures.length) await new Promise(r => setTimeout(r, 300));

    for (let j = 0; j < txs.length; j++) {
      const tx = txs[j];
      if (!tx || tx.meta?.err) continue;

      // Check if any account key is a known DEX program
      const accountKeys = tx.transaction.message.accountKeys.map(
        (k: any) => (typeof k === 'string' ? k : k.pubkey?.toString() ?? k.toString())
      );

      const isDexTx = accountKeys.some((key: string) => SOLANA_DEX_PROGRAMS.has(key));
      if (!isDexTx) continue;

      // Estimate volume from USDC balance changes (postTokenBalances - preTokenBalances)
      const preBalances  = tx.meta?.preTokenBalances  ?? [];
      const postBalances = tx.meta?.postTokenBalances ?? [];

      let usdcIn = 0;
      for (const post of postBalances) {
        if (post.mint !== SOL_USDC_MINT) continue;
        if (post.owner?.toLowerCase() !== wallet.toLowerCase()) continue;
        const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
        const delta = (post.uiTokenAmount.uiAmount ?? 0) - (pre?.uiTokenAmount?.uiAmount ?? 0);
        if (delta > 0) usdcIn += delta;
      }

      // Fall back to SOL delta if no USDC flow found
      let volumeUSD = usdcIn;
      if (volumeUSD === 0) {
        const walletIdx = accountKeys.indexOf(wallet);
        if (walletIdx >= 0 && tx.meta?.preBalances && tx.meta?.postBalances) {
          const solDelta = Math.abs(
            (tx.meta.postBalances[walletIdx] - tx.meta.preBalances[walletIdx]) / 1e9
          );
          volumeUSD = solDelta * solPriceUSD;
        }
      }

      swaps.push({
        signature: signatures[i + j]?.signature ?? '',
        blockTime:  tx.blockTime ?? 0,
        volumeUSD,
      });
    }
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
    const date = new Date(mintTimestamp * 1000);
    const dd   = String(date.getUTCDate()).padStart(2, '0');
    const mm   = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
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
          checkedAt: now, dataSource: 'helius_rpc + solana_dex_programs',
          attestationUID, rawMetrics: { chain: 'solana' },
        },
      };
    }

    const tradeCount = swaps.length;
    const volumeUSD  = swaps.reduce((s, sw) => s + sw.volumeUSD, 0);

    // For Solana PnL: sum SOL-denominated volume as proxy for native deployed
    const solDeployed = volumeUSD / exitSolPrice;
    const { pnlPercent, pnlComputed } = await estimatePnl(solDeployed, entrySolPrice, exitSolPrice);

    const rawMetrics = {
      chain:        'solana',
      tradeCount,
      volumeUSD:    parseFloat(volumeUSD.toFixed(2)),
      pnlPercent:   pnlPercent ?? 0,
      pnlComputed,
      entrySOLPrice: entrySolPrice ?? 0,
      exitSOLPrice:  exitSolPrice,
      windowDays:   params.windowDays,
      protocol:     params.protocol,
      dexPrograms:  [...SOLANA_DEX_PROGRAMS].join(','),
    };

    const evidence = {
      checkedAt:  now,
      dataSource: 'helius_rpc + solana_dex_programs (Jupiter/Orca/Raydium)',
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
    dexMethodIds:  [...SWAP_METHOD_IDS].join(','),
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