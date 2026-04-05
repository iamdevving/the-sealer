// src/lib/verify/prediction-market.ts
//
// Prediction Market Accuracy verifier — supports Polymarket, Kalshi, Limitless.
//
// Polymarket: public Data API, no auth, Polygon-based
// Kalshi: CFTC-regulated REST API, requires agent-provided JWT key
// Limitless: public portfolio API, Base-based
//
// Win rate is volume-weighted per scoring model design decision.
// All metrics are measured over the commitment window only (mintTimestamp → deadline).

import type { ClaimType } from './types';

export interface PredictionMarketParams {
  agentWallet:        string;
  platform:           'polymarket' | 'kalshi' | 'limitless';
  category:           string;   // crypto | politics | sports | economics | culture | all
  minMarketsResolved: number;
  minWinRate:         number;   // 0–100
  minROI:             number;   // percent, e.g. 10 = 10%
  minVolumeUSD:       number;
  windowStart:        number;   // unix seconds (mintTimestamp)
  windowEnd:          number;   // unix seconds (deadline)
  kalshiApiKey?:      string;   // required for Kalshi only
}

export interface PredictionMarketResult {
  passed:             boolean;
  marketsResolved:    number;
  winRate:            number;   // volume-weighted, 0–100
  roi:                number;   // percent
  volumeUSD:          number;
  metricsMet:         number;
  metricsTotal:       number;
  evidence:           string;   // URL or data source description
  failureReason?:     string;
  perMetric: {
    marketsResolved: { achieved: number; target: number; met: boolean };
    winRate:         { achieved: number; target: number; met: boolean };
    roi:             { achieved: number; target: number; met: boolean };
    volumeUSD:       { achieved: number; target: number; met: boolean };
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function verifyPredictionMarket(
  params: PredictionMarketParams,
): Promise<PredictionMarketResult> {
  switch (params.platform) {
    case 'polymarket': return verifyPolymarket(params);
    case 'kalshi':     return verifyKalshi(params);
    case 'limitless':  return verifyLimitless(params);
    default:
      return failResult(`Unsupported platform: ${params.platform}`);
  }
}

// ── Polymarket ────────────────────────────────────────────────────────────────
// Public Data API — no auth required.
// Endpoint: GET https://data-api.polymarket.com/closed-positions?user={wallet}
// Returns all resolved positions with realizedPnl, avgPrice, totalBought, outcome.
// We filter by timestamp within the commitment window.

async function verifyPolymarket(params: PredictionMarketParams): Promise<PredictionMarketResult> {
  const { agentWallet, minMarketsResolved, minWinRate, minROI, minVolumeUSD, windowStart, windowEnd, category } = params;

  try {
    // Polymarket uses a proxy wallet — first resolve it
    const profileUrl = `https://data-api.polymarket.com/profile?address=${agentWallet}`;
    const profileRes = await fetch(profileUrl, { signal: AbortSignal.timeout(10000) });

    let proxyWallet = agentWallet;
    if (profileRes.ok) {
      const profile = await profileRes.json();
      proxyWallet = profile?.proxyWallet || agentWallet;
    }

    // Fetch all closed positions
    const url = `https://data-api.polymarket.com/closed-positions?user=${proxyWallet}&limit=500`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return failResult(`Polymarket API error: HTTP ${res.status}`);
    }

    const positions: PolymarketPosition[] = await res.json();

    // Filter to commitment window
    const windowPositions = positions.filter(p => {
      const ts = p.timestamp ? Number(p.timestamp) : 0;
      return ts >= windowStart && ts <= windowEnd;
    });

    // Filter by category if specified
    const filtered = category === 'all'
      ? windowPositions
      : windowPositions.filter(p => matchesCategory(p.title || p.slug || '', category));

    return computeMetrics(filtered, params, 'Polymarket Data API (data-api.polymarket.com)');

  } catch (err) {
    return failResult(`Polymarket verification error: ${String(err)}`);
  }
}

// ── Kalshi ────────────────────────────────────────────────────────────────────
// CFTC-regulated REST API — requires agent-provided API key.
// Endpoint: GET https://trading-api.kalshi.com/trade-api/v2/portfolio/positions
// Agent provides kalshiApiKey at commitment time, stored in verificationParams.
// Settled positions have status = 'settled' with yes/no resolution.

async function verifyKalshi(params: PredictionMarketParams): Promise<PredictionMarketResult> {
  const { kalshiApiKey, minMarketsResolved, minWinRate, minROI, minVolumeUSD, windowStart, windowEnd, category } = params;

  if (!kalshiApiKey) {
    return failResult('Kalshi verification requires a kalshiApiKey in verificationParams');
  }

  try {
    // Kalshi requires login to get JWT first, then use it
    // Their API key IS the bearer token for v2
    const url = 'https://trading-api.kalshi.com/trade-api/v2/portfolio/positions?settlement_status=settled&limit=200';
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${kalshiApiKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return failResult(`Kalshi API error: HTTP ${res.status} — check kalshiApiKey`);
    }

    const data = await res.json();
    const positions: KalshiPosition[] = data.positions || data.market_positions || [];

    // Filter to commitment window by settled_time
    const windowPositions = positions.filter(p => {
      const ts = p.settled_time ? Math.floor(new Date(p.settled_time).getTime() / 1000) : 0;
      return ts >= windowStart && ts <= windowEnd;
    });

    // Filter by category
    const filtered = category === 'all'
      ? windowPositions
      : windowPositions.filter(p => matchesCategory(p.market_title || p.ticker || '', category));

    // Convert to unified format
    const unified: UnifiedPosition[] = filtered.map(p => {
      const isYesBet     = (p.position ?? 0) > 0;
      const resolved_yes = p.result === 'yes';
      const won          = isYesBet ? resolved_yes : !resolved_yes;
      const costBasis    = Math.abs((p.total_cost ?? 0) / 100); // Kalshi uses cents
      const payout       = won ? Math.abs((p.total_shares_owned ?? p.position ?? 0) / 100) : 0;
      return {
        won,
        costBasis,
        payout,
        realizedPnl: payout - costBasis,
        volumeUSD:   costBasis,
        title:       p.market_title || p.ticker || '',
      };
    });

    return computeUnifiedMetrics(unified, params, 'Kalshi Trading API (trading-api.kalshi.com)');

  } catch (err) {
    return failResult(`Kalshi verification error: ${String(err)}`);
  }
}

// ── Limitless ─────────────────────────────────────────────────────────────────
// Public Portfolio API — no auth required for public endpoints.
// Endpoint: GET https://api.limitless.exchange/portfolio/{account}/positions
// Returns positions including resolved ones with outcome data.

async function verifyLimitless(params: PredictionMarketParams): Promise<PredictionMarketResult> {
  const { agentWallet, windowStart, windowEnd, category } = params;

  try {
    const url = `https://api.limitless.exchange/portfolio/${agentWallet}/positions`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return failResult(`Limitless API error: HTTP ${res.status}`);
    }

    const data = await res.json();
    // Limitless returns positions array — resolved ones have outcome data
    const positions: LimitlessPosition[] = data.positions || data || [];

    // Filter to resolved positions within window
    const resolved = positions.filter(p => {
      const isResolved = p.status === 'resolved' || p.resolved === true || p.winner !== undefined;
      const ts = p.resolvedAt
        ? Math.floor(new Date(p.resolvedAt).getTime() / 1000)
        : p.closedAt
          ? Math.floor(new Date(p.closedAt).getTime() / 1000)
          : 0;
      return isResolved && ts >= windowStart && ts <= windowEnd;
    });

    // Filter by category
    const filtered = category === 'all'
      ? resolved
      : resolved.filter(p => matchesCategory(p.title || p.marketTitle || '', category));

    // Convert to unified format
    const unified: UnifiedPosition[] = filtered.map(p => {
      const investedUsdc = Number(p.investedUsdc ?? p.collateral ?? 0) / 1e6;
      const won = p.winner === p.outcome || p.won === true;
      const payout = won ? investedUsdc / Number(p.avgPrice ?? 0.5) : 0;
      return {
        won,
        costBasis:   investedUsdc,
        payout,
        realizedPnl: payout - investedUsdc,
        volumeUSD:   investedUsdc,
        title:       p.title || p.marketTitle || '',
      };
    });

    return computeUnifiedMetrics(unified, params, 'Limitless Public Portfolio API (api.limitless.exchange)');

  } catch (err) {
    return failResult(`Limitless verification error: ${String(err)}`);
  }
}

// ── Shared computation ────────────────────────────────────────────────────────

interface UnifiedPosition {
  won:        boolean;
  costBasis:  number;  // USD wagered
  payout:     number;  // USD received
  realizedPnl: number; // payout - costBasis
  volumeUSD:  number;  // USD wagered (same as costBasis for our purposes)
  title:      string;
}

interface PolymarketPosition {
  proxyWallet?:  string;
  realizedPnl?:  number;
  avgPrice?:     number;
  totalBought?:  number;
  curPrice?:     number;
  timestamp?:    number | string;
  title?:        string;
  slug?:         string;
  outcome?:      string;
  outcomeIndex?: number;
  endDate?:      string;
}

interface KalshiPosition {
  ticker?:             string;
  market_title?:       string;
  position?:           number;
  total_shares_owned?: number;
  total_cost?:         number;
  result?:             'yes' | 'no';
  settled_time?:       string;
}

interface LimitlessPosition {
  title?:        string;
  marketTitle?:  string;
  status?:       string;
  resolved?:     boolean;
  winner?:       string;
  outcome?:      string;
  won?:          boolean;
  investedUsdc?: number | string;
  collateral?:   number | string;
  avgPrice?:     number | string;
  resolvedAt?:   string;
  closedAt?:     string;
}

// Polymarket-specific computation using raw position data
function computeMetrics(
  positions: PolymarketPosition[],
  params:    PredictionMarketParams,
  source:    string,
): PredictionMarketResult {
  const unified: UnifiedPosition[] = positions.map(p => {
    // On Polymarket: realizedPnl is the actual P&L in USDC
    // totalBought is total USDC spent on this position
    const costBasis   = Number(p.totalBought ?? 0);
    const realizedPnl = Number(p.realizedPnl ?? 0);
    const payout      = costBasis + realizedPnl;
    const won         = realizedPnl > 0;
    return {
      won,
      costBasis,
      payout,
      realizedPnl,
      volumeUSD: costBasis,
      title:     p.title || p.slug || '',
    };
  });

  return computeUnifiedMetrics(unified, params, source);
}

function computeUnifiedMetrics(
  positions: UnifiedPosition[],
  params:    PredictionMarketParams,
  source:    string,
): PredictionMarketResult {
  const { minMarketsResolved, minWinRate, minROI, minVolumeUSD } = params;

  const marketsResolved = positions.length;
  const totalVolume     = positions.reduce((s, p) => s + p.volumeUSD, 0);
  const totalPnl        = positions.reduce((s, p) => s + p.realizedPnl, 0);

  // Volume-weighted win rate
  const weightedWins = positions.reduce((s, p) => s + (p.won ? p.volumeUSD : 0), 0);
  const winRate      = totalVolume > 0 ? (weightedWins / totalVolume) * 100 : 0;

  // ROI = total PnL / total cost basis * 100
  const roi = totalVolume > 0 ? (totalPnl / totalVolume) * 100 : 0;

  const perMetric = {
    marketsResolved: { achieved: marketsResolved, target: minMarketsResolved, met: marketsResolved >= minMarketsResolved },
    winRate:         { achieved: Math.round(winRate * 100) / 100, target: minWinRate, met: winRate >= minWinRate },
    roi:             { achieved: Math.round(roi * 100) / 100, target: minROI, met: roi >= minROI },
    volumeUSD:       { achieved: Math.round(totalVolume * 100) / 100, target: minVolumeUSD, met: totalVolume >= minVolumeUSD },
  };

  const metricsMet  = Object.values(perMetric).filter(m => m.met).length;
  const metricsTotal = 4;
  const passed       = metricsMet === metricsTotal;

  const failureReason = passed ? undefined : Object.entries(perMetric)
    .filter(([, m]) => !m.met)
    .map(([k, m]) => `${k}: got ${m.achieved}, needed ${m.target}`)
    .join('; ');

  return {
    passed,
    marketsResolved,
    winRate:   Math.round(winRate * 100) / 100,
    roi:       Math.round(roi * 100) / 100,
    volumeUSD: Math.round(totalVolume * 100) / 100,
    metricsMet,
    metricsTotal,
    evidence: source,
    failureReason,
    perMetric,
  };
}

// ── Category matching ─────────────────────────────────────────────────────────
// Simple keyword matching against market title/slug.
// Polymarket and Limitless titles are descriptive enough for this to work well.

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto:     ['btc', 'bitcoin', 'eth', 'ethereum', 'crypto', 'token', 'sol', 'solana', 'defi', 'nft', 'usdc', 'stablecoin', 'altcoin', 'coinbase', 'binance'],
  politics:   ['election', 'president', 'senate', 'congress', 'vote', 'trump', 'biden', 'harris', 'political', 'legislation', 'supreme court', 'governor', 'parliament'],
  sports:     ['nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'tennis', 'golf', 'ufc', 'mma', 'champion', 'playoff', 'superbowl', 'world cup'],
  economics:  ['fed', 'interest rate', 'gdp', 'inflation', 'recession', 'unemployment', 'cpi', 'fomc', 'rate cut', 'rate hike', 'treasury', 'market cap'],
  culture:    ['oscars', 'grammy', 'movie', 'music', 'celebrity', 'award', 'box office', 'album', 'film', 'tv show', 'streaming'],
};

function matchesCategory(title: string, category: string): boolean {
  if (category === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[category] ?? [];
  const lower    = title.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function failResult(reason: string): PredictionMarketResult {
  return {
    passed:          false,
    marketsResolved: 0,
    winRate:         0,
    roi:             0,
    volumeUSD:       0,
    metricsMet:      0,
    metricsTotal:    4,
    evidence:        'verification failed before data fetch',
    failureReason:   reason,
    perMetric: {
      marketsResolved: { achieved: 0, target: 0, met: false },
      winRate:         { achieved: 0, target: 0, met: false },
      roi:             { achieved: 0, target: 0, met: false },
      volumeUSD:       { achieved: 0, target: 0, met: false },
    },
  };
}