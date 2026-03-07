// src/lib/verify/attest-achievement.ts
//
// Called by any verifier (x402, defi, github, website, social) when
// verification passes. Issues an EAS Achievement attestation and mints
// a Badge NFT as the visible reward (all tiers — bronze, silver, gold).
//
// Cards remain exclusively under /api/attest (self-declared, manual).
// Badges are the achievement reward tier — earned not bought.

import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { mintBadge } from '@/lib/nft';
import type { AchievementLevel, ClaimType } from './types';

const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const EAS_ADDRESS            = '0x4200000000000000000000000000000000000021';
const ACHIEVEMENT_SCHEMA_UID = process.env.EAS_ACHIEVEMENT_SCHEMA_UID!;

// ── Schema (deploy once on EAS, set EAS_ACHIEVEMENT_SCHEMA_UID in env) ────────
// string claimType, string level, string commitmentUID, string evidence,
// string metric, uint64 score, uint64 achievedAt, bool onTime
//
// score and onTime are included now so leaderboard queries work from EAS data
// alone — no secondary DB needed for ranking.

export interface AttestAchievementParams {
  agentId:       `0x${string}`;
  claimType:     ClaimType;
  level:         AchievementLevel;
  commitmentUID: string;        // TX hash / EAS UID of the original commitment
  evidence:      string;        // JSON-serialised VerificationEvidence[]
  metric:        string;        // Human-readable metric, e.g. "97.3% success rate"
  score:         number;        // 0–1000 weighted score (see scoring guide below)
  onTime:        boolean;       // achieved before or on deadline
  themeKey?:     string;
}

export interface AttestAchievementResult {
  success:           boolean;
  achievementTxHash?: string;
  nftTxHash?:        string;
  error?:            string;
}

// ── Scoring guide (bake this into every verifier's return value) ─────────────
//
// Base score by level:   bronze=300  silver=600  gold=900
// On-time bonus:         +50
// Speed bonus:           +0–50  (days_remaining / deadline_days * 50, capped)
// Evidence depth bonus:  +0–50  (number of evidence items, capped at 5 → +50)
// Raw metric bonus:      +0–50  (verifier-specific, e.g. success rate above threshold)
//
// Max possible: 1000
// Stored onchain in EAS so leaderboard logic can be rebuilt from chain data alone.

export async function attestAchievement(
  params: AttestAchievementParams,
): Promise<AttestAchievementResult> {
  const {
    agentId,
    claimType,
    level,
    commitmentUID,
    evidence,
    metric,
    score,
    onTime,
    themeKey = 'circuit-anim',
  } = params;

  console.log(
    `[attest-achievement] ${claimType}/${level} score=${score} onTime=${onTime} agent=${agentId}`
  );

  try {
    const account      = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

    const eas = new EAS(EAS_ADDRESS);
    (eas as any).connect(walletClient);

    // ── 1. Issue EAS Achievement attestation ──────────────────────────────
    const schemaEncoder = new SchemaEncoder(
      'string claimType,string level,string commitmentUID,string evidence,string metric,uint64 score,uint64 achievedAt,bool onTime'
    );
    const encodedData = schemaEncoder.encodeData([
      { name: 'claimType',     value: claimType,                           type: 'string' },
      { name: 'level',         value: level,                               type: 'string' },
      { name: 'commitmentUID', value: commitmentUID,                       type: 'string' },
      { name: 'evidence',      value: evidence,                            type: 'string' },
      { name: 'metric',        value: metric,                              type: 'string' },
      { name: 'score',         value: BigInt(Math.round(score)),           type: 'uint64' },
      { name: 'achievedAt',    value: BigInt(Math.floor(Date.now()/1000)), type: 'uint64' },
      { name: 'onTime',        value: onTime,                              type: 'bool'   },
    ]);

    const txResponse = await eas.attest({
      schema: ACHIEVEMENT_SCHEMA_UID,
      data: {
        recipient:      agentId,
        expirationTime: BigInt(0),
        revocable:      false,
        refUID:         isValidUID(commitmentUID)
          ? (commitmentUID as `0x${string}`)
          : '0x0000000000000000000000000000000000000000000000000000000000000000',
        data:           encodedData,
      },
    });

    const preparedTx     = (txResponse as any).data || txResponse;
    const achievementTxH = await walletClient.sendTransaction(preparedTx as any);

    await publicClient.waitForTransactionReceipt({
      hash:            achievementTxH as Hash,
      pollingInterval: 1000,
      timeout:         90_000,
    });

    console.log('[attest-achievement] ✅ EAS attestation mined:', achievementTxH);

    // ── 2. Mint Badge NFT (all tiers — bronze, silver, gold) ──────────────
    // Cards remain self-declared only via /api/attest.
    // Theme maps to tier visually. TODO: replace with dedicated achievement
    // certificate SVG themes once theme alignment task is completed.
    const badgeTheme = tierTheme(level, themeKey);
    const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
    const label      = levelToLabel(level, claimType);
    const imageUri   = [
      `${baseUrl}/api/badge`,
      `?statement=${encodeURIComponent(label)}`,
      `&agentId=${encodeURIComponent(agentId.slice(0, 8))}`,
      `&theme=${badgeTheme}`,
      `&txHash=${achievementTxH}`,
    ].join('');

    const receipt   = await mintBadge(agentId, imageUri, achievementTxH, label);
    const nftTxHash = receipt.txHash;

    console.log('[attest-achievement] ✅ Badge NFT minted:', nftTxHash);

    return { success: true, achievementTxHash: achievementTxH, nftTxHash };

  } catch (err: unknown) {
    console.error('[attest-achievement] Failed:', err);
    return { success: false, error: String(err) };
  }
}

// ── Score calculator (exported — every verifier should use this) ──────────────
export function calculateScore(params: {
  level:         AchievementLevel;
  onTime:        boolean;
  daysRemaining: number;   // negative = late
  deadlineDays:  number;   // total commitment window
  evidenceCount: number;
  metricBonus:   number;   // 0–50, verifier-specific
}): number {
  const base         = { bronze: 300, silver: 600, gold: 900 }[params.level] ?? 300;
  const onTimeBonus  = params.onTime ? 50 : 0;
  const speedBonus   = params.onTime && params.deadlineDays > 0
    ? Math.round(Math.min(params.daysRemaining / params.deadlineDays, 1) * 50)
    : 0;
  const evidenceBonus = Math.min(params.evidenceCount, 5) * 10;
  const metricBonus   = Math.min(Math.max(params.metricBonus, 0), 50);
  return Math.min(base + onTimeBonus + speedBonus + evidenceBonus + metricBonus, 1000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierTheme(level: AchievementLevel, fallback: string): string {
  switch (level) {
    case 'gold':   return 'gold';
    case 'silver': return 'silver';
    case 'bronze': return 'bronze';
    default:       return fallback;
  }
}

function levelToLabel(level: AchievementLevel, claimType: ClaimType): string {
  return `${claimTypeToLabel(claimType)} · ${level.charAt(0).toUpperCase() + level.slice(1)}`;
}

function claimTypeToLabel(claimType: ClaimType): string {
  const map: Record<string, string> = {
    x402_reliability: 'x402 Payment Reliability',
    defi_pnl:         'DeFi Trading Performance',
    github_delivery:  'Code Delivery',
    website_delivery: 'Website Delivery',
    social_growth:    'Social Growth',
  };
  return map[claimType] ?? 'Achievement';
}

function isValidUID(uid: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(uid);
}