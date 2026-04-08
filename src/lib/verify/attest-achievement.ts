// src/lib/verify/attest-achievement.ts
import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { mintCertificate } from '@/lib/nft';
import {
  computeDifficulty,
  type CommitmentThresholds,
  type HistoricalRecord,
} from '@/lib/difficulty';
import type { ClaimType } from './types';

const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const EAS_ADDRESS            = '0x4200000000000000000000000000000000000021';
const ACHIEVEMENT_SCHEMA_UID = process.env.EAS_ACHIEVEMENT_SCHEMA_UID!;

const SCHEMA_STRING =
  'string claimType,string commitmentUID,string evidence,string metric,' +
  'uint64 achievedAt,bool onTime,uint8 difficulty,uint8 difficultyVersion,' +
  'bool bootstrapped,int16 daysEarly,uint32 proofPoints,uint8 metricsMet,uint8 metricsTotal';

export type CertificateOutcome = 'FULL' | 'PARTIAL' | 'FAILED';
const OUTCOME_ENUM: Record<CertificateOutcome, 0 | 1 | 2> = { FAILED: 0, PARTIAL: 1, FULL: 2 };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CertificateMetric {
  label:    string;
  target:   string;
  achieved: string;
  met:      boolean;
  weight?:  number;
}

export interface AttestAchievementParams {
  agentId:              `0x${string}`;
  claimType:            ClaimType;
  commitmentUID:        string;
  evidence:             string;
  metric:               string;
  outcome:              CertificateOutcome;
  onTime:               boolean;
  daysEarly:            number;
  metricsMet:           number;
  metricsTotal:         number;
  proofPoints:          number;
  sid?:                 string;
  // Certificate v9 display
  commitmentText:       string;
  certificateMetrics:   CertificateMetric[];
  issuedAt:             number;       // unix seconds (= now)
  periodStart:          number;       // unix seconds (= mintTimestamp)
  periodEnd:            number;       // unix seconds (= deadline)
  deadlineDays:         number;
  difficultyVersion?:   number;
  commitmentThresholds: CommitmentThresholds;
  historicalRecords:    HistoricalRecord[];
}

export interface AttestAchievementResult {
  success:            boolean;
  achievementUID?:    string;
  achievementTxHash?: string;
  nftTxHash?:         string;
  tokenId?:           string;
  difficulty?:        number;
  bootstrapped?:      boolean;
  proofPoints?:       number;
  certificateUrl?:    string;
  error?:             string;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function attestAchievement(
  params: AttestAchievementParams,
): Promise<AttestAchievementResult> {
  const {
    agentId, claimType, commitmentUID,
    evidence, metric, outcome, onTime, daysEarly,
    metricsMet, metricsTotal, proofPoints,
    sid = '', commitmentText, certificateMetrics,
    issuedAt, periodStart, periodEnd, deadlineDays,
    difficultyVersion = 1,
    commitmentThresholds, historicalRecords,
  } = params;

  console.log(`[attest-achievement] ${claimType} outcome=${outcome} agent=${agentId}`);

  try {
    // 1. Compute difficulty
    const diffResult = computeDifficulty(claimType, commitmentThresholds, historicalRecords);
    console.log(`[attest-achievement] difficulty=${diffResult.difficulty} bootstrapped=${diffResult.bootstrapped}`);

    // 2. EAS attestation
    const account      = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
    const eas          = new EAS(EAS_ADDRESS);
    (eas as any).connect(walletClient);

    const schemaEncoder = new SchemaEncoder(SCHEMA_STRING);
    console.log('[attest-achievement] encoding values:', { daysEarly, proofPoints, metricsMet, metricsTotal, difficulty: diffResult.difficulty });
    const encodedData   = schemaEncoder.encodeData([
      { name: 'claimType',         value: claimType,                    type: 'string' },
      { name: 'commitmentUID',     value: commitmentUID,                type: 'string' },
      { name: 'evidence',          value: evidence,                     type: 'string' },
      { name: 'metric',            value: metric,                       type: 'string' },
      { name: 'achievedAt',        value: BigInt(issuedAt),             type: 'uint64' },
      { name: 'onTime',            value: onTime,                       type: 'bool'   },
      { name: 'difficulty',        value: diffResult.difficulty,        type: 'uint8'  },
      { name: 'difficultyVersion', value: diffResult.difficultyVersion, type: 'uint8'  },
      { name: 'bootstrapped',      value: diffResult.bootstrapped,      type: 'bool'   },
      { name: 'daysEarly',         value: Math.round(daysEarly)    || 0, type: 'int16'  },
      { name: 'proofPoints',       value: Math.round(proofPoints)  || 0, type: 'uint32' },
      { name: 'metricsMet',        value: Math.round(metricsMet)   || 0, type: 'uint8'  },
      { name: 'metricsTotal',      value: Math.round(metricsTotal) || 0, type: 'uint8'  },
    ]);

    const txResponse = await eas.attest({
      schema: ACHIEVEMENT_SCHEMA_UID,
      data: {
        recipient:      agentId,
        expirationTime: BigInt(0),
        revocable:      false,
        refUID: isValidUID(commitmentUID)
          ? commitmentUID as `0x${string}`
          : '0x0000000000000000000000000000000000000000000000000000000000000000',
        data: encodedData,
      },
    });

    let achievementTxHash: string;
    let achievementUID:    string;

    // Always use viem directly — avoid EAS SDK .wait() which is unreliable across versions
    {
      const preparedTx  = (txResponse as any).data ?? (txResponse as any).tx ?? txResponse;
      achievementTxHash = await walletClient.sendTransaction(preparedTx as any);
      const receipt     = await publicClient.waitForTransactionReceipt({
        hash: achievementTxHash as Hash, pollingInterval: 1000, timeout: 90_000,
      });
      achievementTxHash = receipt.transactionHash;
      // EAS Attested event: UID is non-indexed — lives in log.data first 32 bytes
      // topic0 = keccak256("Attested(address,address,bytes32,bytes32)")
      const attestedLog = receipt.logs?.find(log =>
        log.topics?.[0] === '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35'
      );
      achievementUID = attestedLog?.data
        ? `0x${attestedLog.data.slice(2, 66)}`
        : achievementTxHash;
    }

    console.log(`[attest-achievement] ✅ EAS tx=${achievementTxHash} uid=${achievementUID}`);

    // 3. Build certificate URL
    const baseUrl        = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
    const certificateUrl = buildCertificateUrl(baseUrl, {
      uid: achievementUID, claimType, commitmentText,
      metrics: certificateMetrics, outcome,
      difficulty: diffResult.difficulty, deadlineDays, daysEarly,
      issuedAt, periodStart, periodEnd,
      agentId, sid, proofPoints, metricsMet, metricsTotal,
      txHash: achievementTxHash,
    });

    // 4. Mint Certificate NFT
    const nft = await mintCertificate({
      recipient:         agentId,
      achievementTx:     achievementTxHash,
      commitmentTx:      commitmentUID,
      achievementUid:    achievementUID,
      claimType,
      outcome:           OUTCOME_ENUM[outcome],
      difficulty:        diffResult.difficulty,
      proofPoints,
      metricsMet,
      metricsTotal,
      onTime,
      daysEarly,
      deadline:          periodEnd,
    });

    console.log(`[attest-achievement] ✅ Certificate NFT minted: ${nft.txHash} tokenId=${nft.tokenId}`);
    try {
  const { postErc8004Feedback } = await import('@/lib/erc8004');
  await postErc8004Feedback({
    agentWallet:    agentId,
    proofPoints,
    claimType,
    outcome,
    achievementUID,
  });
} catch { /* non-fatal */ }

    return {
      success: true,
      achievementUID, achievementTxHash,
      nftTxHash:    nft.txHash,
      tokenId:      nft.tokenId.toString(),
      difficulty:   diffResult.difficulty,
      bootstrapped: diffResult.bootstrapped,
      proofPoints,
      certificateUrl,
    };

  } catch (err: unknown) {
    console.error('[attest-achievement] Failed:', err);
    return { success: false, error: String(err) };
  }
}

// ── Certificate URL builder ───────────────────────────────────────────────────

interface CertUrlParams {
  uid: string; claimType: string; commitmentText: string;
  metrics: CertificateMetric[]; outcome: CertificateOutcome;
  difficulty: number; deadlineDays: number; daysEarly: number;
  issuedAt: number; periodStart: number; periodEnd: number;
  agentId: string; sid: string; proofPoints: number;
  metricsMet: number; metricsTotal: number; txHash: string;
}

function buildCertificateUrl(baseUrl: string, p: CertUrlParams): string {
  return `${baseUrl}/api/certificate?` + new URLSearchParams({
    uid:            p.uid,
    claimType:      p.claimType,
    commitmentText: p.commitmentText,
    metrics:        JSON.stringify(p.metrics),
    outcome:        p.outcome,
    difficulty:     String(p.difficulty),
    deadlineDays:   String(p.deadlineDays),
    daysEarly:      String(p.daysEarly),
    issuedAt:       String(p.issuedAt),
    periodStart:    String(p.periodStart),
    periodEnd:      String(p.periodEnd),
    agentId:        p.agentId,
    sid:            p.sid,
    proofPoints:    String(p.proofPoints),
    metricsMet:     String(p.metricsMet),
    metricsTotal:   String(p.metricsTotal),
    txHash:         p.txHash,
  }).toString();
}

function isValidUID(uid: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(uid);
}