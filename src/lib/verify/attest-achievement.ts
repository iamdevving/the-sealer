// src/lib/verify/attest-achievement.ts
//
// Called by any verifier (x402, defi, github, website, social) when
// verification passes. Issues an EAS Achievement attestation and mints
// a Badge NFT as the visible reward.
//
// v2 changes:
//   - Difficulty scoring via computeDifficulty() from @/lib/difficulty
//   - New EAS schema fields: difficulty uint8, difficultyVersion uint8, bootstrapped bool
//   - Schema: 0x6348b363af438e6b35ef28e2d1a798e213f54a38809f58f0397a20e592a70ffb
//   - imageUri now passes full certificate v2 query params
//   - level/score/tier removed — achievements are just "Achieved"
//
// v2.1 changes:
//   - executionScore computed via computeExecution() — display-only until schema v2 deployed
//   - actualValues added to params — verifier passes measured values alongside thresholds

import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { mintBadge } from '@/lib/nft';
import {
  computeDifficulty,
  computeExecution,
  type CommitmentThresholds,
  type ActualValues,
  type HistoricalRecord,
} from '@/lib/difficulty';
import type { ClaimType } from './types';

const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const EAS_ADDRESS            = '0x4200000000000000000000000000000000000021';
const ACHIEVEMENT_SCHEMA_UID = process.env.EAS_ACHIEVEMENT_SCHEMA_UID!;

// Matches EAS schema 0x6348b363…
const SCHEMA_STRING =
  'string claimType,string commitmentUID,string evidence,string metric,' +
  'uint64 achievedAt,bool onTime,uint8 difficulty,uint8 difficultyVersion,bool bootstrapped';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CertificateMetric {
  label:   string;
  value:   string;
  accent?: boolean;
}

export interface AttestAchievementParams {
  agentId:              `0x${string}`;
  claimType:            ClaimType;
  commitmentUID:        string;
  evidence:             string;
  metric:               string;
  onTime:               boolean;
  sid?:                 string;
  // Certificate display
  commitmentText:       string;
  certificateMetrics:   CertificateMetric[];
  committedDate:        number;
  deadline:             number;
  achievedDate:         number;
  daysEarly:            number;
  amended?:             boolean;
  originalText?:        string;
  // Difficulty inputs
  commitmentThresholds: CommitmentThresholds;
  historicalRecords:    HistoricalRecord[];
  // Execution inputs — actual measured values from the verifier
  // Optional: if not provided, executionScore is skipped (0 on certificate)
  actualValues?:        ActualValues;
}

export interface AttestAchievementResult {
  success:            boolean;
  achievementTxHash?: string;
  achievementUID?:    string;
  nftTxHash?:         string;
  difficulty?:        number;
  bootstrapped?:      boolean;
  executionScore?:    number;
  error?:             string;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function attestAchievement(
  params: AttestAchievementParams,
): Promise<AttestAchievementResult> {
  const {
    agentId,
    claimType,
    commitmentUID,
    evidence,
    metric,
    onTime,
    sid            = '',
    commitmentText,
    certificateMetrics,
    committedDate,
    deadline,
    achievedDate,
    daysEarly,
    amended        = false,
    originalText   = '',
    commitmentThresholds,
    historicalRecords,
    actualValues,
  } = params;

  console.log(`[attest-achievement] ${claimType} onTime=${onTime} agent=${agentId}`);

  try {
    // ── 1. Compute difficulty ─────────────────────────────────────────────
    const diffResult = computeDifficulty(claimType, commitmentThresholds, historicalRecords);
    console.log(
      `[attest-achievement] difficulty=${diffResult.difficulty} ` +
      `bootstrapped=${diffResult.bootstrapped} ` +
      `percentile=${diffResult.breakdown.percentileScore} ` +
      `breadth=${diffResult.breakdown.breadthMultiplier} ` +
      `metrics=[${diffResult.breakdown.metricsScored.join(',')}]`
    );

    // ── 2. Compute execution score (display-only until schema v2) ─────────
    const execResult = actualValues
      ? computeExecution(claimType, commitmentThresholds, actualValues)
      : null;

    if (execResult) {
      console.log(
        `[attest-achievement] executionScore=${execResult.executionScore} ` +
        `metrics=[${execResult.breakdown.metricsScored.join(',')}] ` +
        `headrooms=${JSON.stringify(execResult.breakdown.headrooms)}`
      );
    }

    // ── 3. Issue EAS attestation ──────────────────────────────────────────
    const account      = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

    const eas = new EAS(EAS_ADDRESS);
    (eas as any).connect(walletClient);

    const schemaEncoder = new SchemaEncoder(SCHEMA_STRING);
    const encodedData   = schemaEncoder.encodeData([
      { name: 'claimType',         value: claimType,                         type: 'string' },
      { name: 'commitmentUID',     value: commitmentUID,                     type: 'string' },
      { name: 'evidence',          value: evidence,                          type: 'string' },
      { name: 'metric',            value: metric,                            type: 'string' },
      { name: 'achievedAt',        value: BigInt(Math.floor(achievedDate)),  type: 'uint64' },
      { name: 'onTime',            value: onTime,                            type: 'bool'   },
      { name: 'difficulty',        value: diffResult.difficulty,             type: 'uint8'  },
      { name: 'difficultyVersion', value: diffResult.difficultyVersion,      type: 'uint8'  },
      { name: 'bootstrapped',      value: diffResult.bootstrapped,           type: 'bool'   },
      // executionScore not yet in schema — added in schema v2
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
        data: encodedData,
      },
    });

    const preparedTx    = (txResponse as any).data || txResponse;
    const achievementTx = await walletClient.sendTransaction(preparedTx as any);

    const txReceipt = await publicClient.waitForTransactionReceipt({
      hash:            achievementTx as Hash,
      pollingInterval: 1000,
      timeout:         90_000,
    });

    const achievementUID =
      (txReceipt.logs?.[0]?.topics?.[1] as string | undefined) ?? achievementTx;

    console.log('[attest-achievement] ✅ EAS attestation mined:', achievementTx);
    console.log('[attest-achievement]    UID:', achievementUID);

    // ── 4. Mint Badge NFT ─────────────────────────────────────────────────
    const baseUrl  = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
    const label    = claimTypeToLabel(claimType);
    const imageUri = buildCertificateUrl(baseUrl, {
      claimType,
      commitmentText,
      metrics:        certificateMetrics,
      committedDate,
      deadline,
      achievedDate,
      daysEarly,
      agentId,
      sid,
      txHash:         achievementTx,
      uid:            achievementUID,
      difficulty:     diffResult.difficulty,
      executionScore: execResult?.executionScore ?? 0,
      amended,
      originalText,
    });

    const nftReceipt = await mintBadge(agentId, imageUri, achievementTx, label);

    console.log('[attest-achievement] ✅ Badge NFT minted:', nftReceipt.txHash);

    return {
      success:           true,
      achievementTxHash: achievementTx,
      achievementUID,
      nftTxHash:         nftReceipt.txHash,
      difficulty:        diffResult.difficulty,
      bootstrapped:      diffResult.bootstrapped,
      executionScore:    execResult?.executionScore,
    };

  } catch (err: unknown) {
    console.error('[attest-achievement] Failed:', err);
    return { success: false, error: String(err) };
  }
}

// ── Certificate URL builder ───────────────────────────────────────────────────

interface CertUrlParams {
  claimType:      string;
  commitmentText: string;
  metrics:        CertificateMetric[];
  committedDate:  number;
  deadline:       number;
  achievedDate:   number;
  daysEarly:      number;
  agentId:        string;
  sid:            string;
  txHash:         string;
  uid:            string;
  difficulty:     number;
  executionScore: number;
  amended:        boolean;
  originalText:   string;
}

function buildCertificateUrl(baseUrl: string, p: CertUrlParams): string {
  const params = new URLSearchParams({
    claimType:      p.claimType,
    commitmentText: p.commitmentText,
    metrics:        JSON.stringify(p.metrics),
    committedDate:  String(p.committedDate),
    deadline:       String(p.deadline),
    achievedDate:   String(p.achievedDate),
    daysEarly:      String(p.daysEarly),
    agentId:        p.agentId,
    sid:            p.sid,
    txHash:         p.txHash,
    uid:            p.uid,
    difficulty:     String(p.difficulty),
    executionScore: String(p.executionScore),
  });
  if (p.amended) {
    params.set('amended', 'true');
    if (p.originalText) params.set('originalText', p.originalText);
  }
  return `${baseUrl}/api/certificate?${params.toString()}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function claimTypeToLabel(claimType: ClaimType): string {
  const map: Record<string, string> = {
    x402_payment_reliability: 'x402 Payment Reliability',
    code_software_delivery:   'Code Software Delivery',
    website_app_delivery:     'Website App Delivery',
    defi_trading_performance: 'DeFi Trading Performance',
    social_media_growth:      'Social Media Growth',
  };
  return map[claimType] ?? 'Achievement';
}

function isValidUID(uid: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(uid);
}