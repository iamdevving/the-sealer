// src/app/api/leaderboard/[claimType]/route.ts
//
// SECURITY CHANGES:
//
// 1. limit param capped at 20 (MEDIUM): Previously ?limit=100 was accepted,
//    enabling bulk wallet harvest in a single request. Now silently capped at 20.
//
// 2. Rate limiting added (MEDIUM): 60 req/min per IP — generous for legitimate
//    use, blocks automated bulk scraping.
//
// Note: leaderboard stays intentionally public. The Sealer's value prop is
// verifiable public reputation — requiring auth would contradict the product.

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { rateLimitRequest } from '@/lib/security';

export const runtime = 'nodejs';

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX = 'achievement:pending:';

const VALID_CLAIM_TYPES = [
  'x402_payment_reliability',
  'defi_trading_performance',
  'code_software_delivery',
  'website_app_delivery',
  'social_media_growth',
];

const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payments',
  defi_trading_performance: 'DeFi Trading',
  code_software_delivery:   'Code Delivery',
  website_app_delivery:     'App Delivery',
  social_media_growth:      'Social Growth',
  all:                      'All Categories',
};

const MAX_LIMIT = 20; // hard cap — prevents bulk harvest in a single request

export interface LeaderboardEntry {
  rank:        number;
  wallet:      string;
  handle:      string | null;
  proofPoints: number;
  claimType:   string;
  claimLabel:  string;
  difficulty:  number;
  onTime:      boolean;
  achievementCount: number;
}

export async function GET(
  req:     NextRequest,
  context: { params: Promise<{ claimType: string }> },
) {
  // ── Rate limiting: 60/min per IP ──────────────────────────────────────────
  const limited = await rateLimitRequest(req, 'leaderboard', 60, 60);
  if (limited) return limited;

  const { claimType } = await context.params;

  // Enforce limit cap — silently clamp rather than error, so existing
  // integrations sending limit=100 don't break, they just get 20
  const rawLimit = parseInt(new URL(req.url).searchParams.get('limit') || '20');
  const limit    = Math.min(isNaN(rawLimit) ? 20 : Math.max(1, rawLimit), MAX_LIMIT);

  if (claimType !== 'all' && !VALID_CLAIM_TYPES.includes(claimType)) {
    return NextResponse.json({ error: 'Invalid claimType' }, { status: 400 });
  }

  // Scan all achievement keys
  const keys = await redis.keys(`${KEY_PREFIX}*`);
  if (!keys.length) return NextResponse.json({ leaderboard: [], claimType, total: 0 });

  // Fetch all in parallel
  const raws = await Promise.all(keys.map(k => redis.get(k)));

  // Aggregate by wallet
  const walletMap = new Map<string, {
    proofPoints:      number;
    bestDifficulty:   number;
    onTime:           boolean;
    claimType:        string;
    achievementCount: number;
  }>();

  for (const raw of raws) {
    if (!raw) continue;
    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw as any;

    if (entry.status !== 'achieved') continue;
    if (claimType !== 'all' && entry.claimType !== claimType) continue;

    const wallet = (entry.subject as string)?.toLowerCase();
    if (!wallet) continue;

    const points   = Number(entry.proofPoints ?? 0);
    const diff     = Number(entry.difficulty  ?? 0);
    const onTime   = Boolean(entry.onTime);
    const existing = walletMap.get(wallet);

    if (existing) {
      existing.proofPoints     += points;
      existing.achievementCount++;
      if (diff > existing.bestDifficulty) existing.bestDifficulty = diff;
      if (onTime) existing.onTime = true;
    } else {
      walletMap.set(wallet, {
        proofPoints:      points,
        bestDifficulty:   diff,
        onTime,
        claimType:        entry.claimType,
        achievementCount: 1,
      });
    }
  }

  if (!walletMap.size) return NextResponse.json({ leaderboard: [], claimType, total: 0 });

  // Sort by proofPoints desc, slice to capped limit
  const sorted = [...walletMap.entries()]
    .sort((a, b) => b[1].proofPoints - a[1].proofPoints)
    .slice(0, limit);

  // Resolve handles in parallel
  const handles = await Promise.all(
    sorted.map(([wallet]) => redis.get(`sid:wallet:${wallet}`) as Promise<string | null>)
  );

  const leaderboard: LeaderboardEntry[] = sorted.map(([wallet, data], i) => ({
    rank:             i + 1,
    wallet,
    handle:           handles[i] || null,
    proofPoints:      data.proofPoints,
    claimType:        data.claimType,
    claimLabel:       CLAIM_LABELS[data.claimType] || data.claimType,
    difficulty:       data.bestDifficulty,
    onTime:           data.onTime,
    achievementCount: data.achievementCount,
  }));

  return NextResponse.json({
    leaderboard,
    claimType,
    claimLabel: CLAIM_LABELS[claimType] || claimType,
    total:      walletMap.size,
    limit,
  });
}