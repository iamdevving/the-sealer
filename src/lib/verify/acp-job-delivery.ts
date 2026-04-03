// src/lib/verify/acp-job-delivery.ts
//
// ACP Job Delivery verifier — core logic only.
// Called by handleVerifyRoute in route-handler.ts via the thin route wrapper.
//
// Data source: Base mainnet onchain logs via Alchemy eth_getLogs + decodeEventLog.
// No dependency on Virtuals REST API at close time.
//
// Events used:
//   JobCreated(uint256 jobId, address client[indexed], address provider[indexed], address evaluator[indexed])
//     → builds jobId → clientAddress map filtered to this provider
//   JobPhaseUpdated(uint256 jobId[indexed], uint8 oldPhase, uint8 newPhase)
//     → newPhase = 4 (COMPLETED), 5 (REJECTED)
//
// rawMetrics keys (used by route-handler.ts buildCertificateMetrics):
//   completedJobsDelta  — count of completed jobs in window
//   successRate         — completed / (completed + rejected) × 100, 0–100
//   uniqueBuyersDelta   — distinct buyer wallets from completed jobs
//   rejectedJobCount    — informational (weight 0)
//   totalScoredJobs     — informational (weight 0)
//   checkedToBlock      — informational (weight 0)
//
// SECURITY: agentWallet validated as EVM address before any URL/log use.

import {
  createPublicClient,
  http,
  decodeEventLog,
  type Address,
  type Log,
} from 'viem';
import { base } from 'viem/chains';
import type { VerificationResult } from '@/lib/verify/types';

// ── ACP phase constants (from SDK AcpJobPhases enum) ─────────────────────────
const PHASE_COMPLETED = 4;
const PHASE_REJECTED  = 5;

// ── Event ABIs ────────────────────────────────────────────────────────────────

const JOB_CREATED_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: 'jobId',     type: 'uint256' },
      { indexed: true,  name: 'client',    type: 'address' },
      { indexed: true,  name: 'provider',  type: 'address' },
      { indexed: true,  name: 'evaluator', type: 'address' },
    ],
    name: 'JobCreated',
    type: 'event',
  },
] as const;

const JOB_PHASE_UPDATED_V1_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true,  name: 'jobId',    type: 'uint256' },
      { indexed: false, name: 'oldPhase', type: 'uint8' },
      { indexed: false, name: 'phase',    type: 'uint8' },   // v1: 'phase'
    ],
    name: 'JobPhaseUpdated',
    type: 'event',
  },
] as const;

const JOB_PHASE_UPDATED_V2_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true,  name: 'jobId',    type: 'uint256' },
      { indexed: false, name: 'oldPhase', type: 'uint8' },
      { indexed: false, name: 'newPhase', type: 'uint8' },   // v2: 'newPhase'
    ],
    name: 'JobPhaseUpdated',
    type: 'event',
  },
] as const;

// ── Params ────────────────────────────────────────────────────────────────────

export interface AcpJobDeliveryParams {
  agentWallet:           string;
  acpContractAddress:    string;
  mintBlock:             bigint;
  minCompletedJobsDelta: number;
  minSuccessRate:        number;  // 0–1 fraction
  minUniqueBuyersDelta:  number;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifyAcpJobDelivery(
  params: AcpJobDeliveryParams,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);

  // SECURITY: validate agentWallet before use in log filtering
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.agentWallet)) {
    return {
      passed:        false,
      failureReason: `Invalid agentWallet address: ${params.agentWallet}`,
      evidence: {
        checkedAt:      now,
        dataSource:     'Base mainnet onchain logs (Alchemy)',
        attestationUID: '',
        rawMetrics:     {},
      },
    };
  }

  const alchemyRpc = process.env.ALCHEMY_RPC_URL;
  if (!alchemyRpc) throw new Error('[acp-job-delivery] ALCHEMY_RPC_URL not set');

  const client          = createPublicClient({ chain: base, transport: http(alchemyRpc) });
  const contractAddress = params.acpContractAddress as Address;
  const providerAddress = params.agentWallet.toLowerCase();
  const latestBlock     = await client.getBlockNumber();

  // ── Step 1: JobCreated → jobId → clientAddress map ───────────────────────
  let jobCreatedLogs: Log[] = [];
  try {
    jobCreatedLogs = await client.getLogs({
      address:   contractAddress,
      event:     JOB_CREATED_ABI[0],
      fromBlock: params.mintBlock,
      toBlock:   latestBlock,
    });
  } catch (err) {
    console.warn('[acp-job-delivery] getLogs(JobCreated) failed:', err);
  }

  const jobIdToClient = new Map<bigint, string>();
  for (const log of jobCreatedLogs) {
    try {
      const decoded = decodeEventLog({
        abi:    JOB_CREATED_ABI,
        data:   log.data,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
      const args = decoded.args as { jobId: bigint; client: string; provider: string };
      if (args.provider?.toLowerCase() === providerAddress) {
        jobIdToClient.set(args.jobId, args.client.toLowerCase());
      }
    } catch { /* skip malformed */ }
  }

  // ── Step 2: JobPhaseUpdated → completions + rejections ───────────────────
  let phaseUpdatedLogs: Log[] = [];
  try {
    phaseUpdatedLogs = await client.getLogs({
      address:   contractAddress,
      event:     JOB_PHASE_UPDATED_V2_ABI[0],
      fromBlock: params.mintBlock,
      toBlock:   latestBlock,
    });
  } catch {
    try {
      phaseUpdatedLogs = await client.getLogs({
        address:   contractAddress,
        event:     JOB_PHASE_UPDATED_V1_ABI[0],
        fromBlock: params.mintBlock,
        toBlock:   latestBlock,
      });
    } catch (err) {
      console.warn('[acp-job-delivery] getLogs(JobPhaseUpdated) failed:', err);
    }
  }

  // ── Step 3: Compute metrics ───────────────────────────────────────────────
  const completedJobIds = new Set<bigint>();
  const rejectedJobIds  = new Set<bigint>();
  const completedBuyers = new Set<string>();

  for (const log of phaseUpdatedLogs) {
    try {
      let jobId:    bigint;
      let newPhase: number;

      try {
        const decoded = decodeEventLog({
          abi:    JOB_PHASE_UPDATED_V2_ABI,
          data:   log.data,
          topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        });
        const args = decoded.args as { jobId: bigint; oldPhase: number; newPhase: number };
        jobId    = args.jobId;
        newPhase = Number(args.newPhase);
      } catch {
        const decoded = decodeEventLog({
          abi:    JOB_PHASE_UPDATED_V1_ABI,
          data:   log.data,
          topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        });
        const args = decoded.args as { jobId: bigint; oldPhase: number; phase: number };
        jobId    = args.jobId;
        newPhase = Number(args.phase);
      }

      if (!jobIdToClient.has(jobId)) continue;

      if (newPhase === PHASE_COMPLETED) {
        completedJobIds.add(jobId);
        const buyer = jobIdToClient.get(jobId);
        if (buyer) completedBuyers.add(buyer);
      } else if (newPhase === PHASE_REJECTED) {
        rejectedJobIds.add(jobId);
      }
    } catch { /* skip malformed */ }
  }

  const completedCount = completedJobIds.size;
  const rejectedCount  = rejectedJobIds.size;
  const totalScored    = completedCount + rejectedCount;
  const successRateRaw = totalScored > 0 ? completedCount / totalScored : 0;
  // Store as 0–100 to match how other verifiers store rates (e.g. x402 successRate)
  const successRatePct = Math.round(successRateRaw * 1000) / 10;
  const uniqueBuyers   = completedBuyers.size;

  // ── Step 4: Evaluate thresholds ───────────────────────────────────────────
  const completedMet    = completedCount >= params.minCompletedJobsDelta;
  const successRateMet  = successRateRaw  >= params.minSuccessRate;  // both 0–1
  const uniqueBuyersMet = uniqueBuyers    >= params.minUniqueBuyersDelta;
  const passed          = completedMet && successRateMet && uniqueBuyersMet;

  const failureParts: string[] = [];
  if (!completedMet)    failureParts.push(`completed jobs ${completedCount} < target ${params.minCompletedJobsDelta}`);
  if (!successRateMet)  failureParts.push(`success rate ${successRatePct}% < target ${Math.round(params.minSuccessRate * 100)}%`);
  if (!uniqueBuyersMet) failureParts.push(`unique buyers ${uniqueBuyers} < target ${params.minUniqueBuyersDelta}`);

  return {
    passed,
    failureReason: failureParts.length > 0 ? failureParts.join('; ') : undefined,
    evidence: {
      checkedAt:      now,
      dataSource:     'Base mainnet onchain logs (Alchemy eth_getLogs)',
      attestationUID: params.acpContractAddress,
      rawMetrics: {
        completedJobsDelta: completedCount,
        successRate:        successRatePct,   // 0–100 to match x402 pattern
        uniqueBuyersDelta:  uniqueBuyers,
        rejectedJobCount:   rejectedCount,
        totalScoredJobs:    totalScored,
        checkedToBlock:     Number(latestBlock),
      },
    },
  };
}

// ── Snapshot helper — called at commitment mint time ─────────────────────────
// Returns { acpContractAddress, mintBlock } to be stored in verificationParams.

export interface AcpMintSnapshot {
  acpContractAddress: string;
  mintBlock:          string;  // string for safe JSON storage (BigInt)
}

export async function snapshotAcpBaseline(agentWallet: string): Promise<AcpMintSnapshot> {
  // SECURITY: validate address before URL construction
  if (!/^0x[0-9a-fA-F]{40}$/.test(agentWallet)) {
    throw new Error(`[acp-job-delivery] Invalid agentWallet: ${agentWallet}`);
  }

  const res = await fetch(
    `https://acpx.virtuals.io/api/agents?filters%5BwalletAddress%5D=${encodeURIComponent(agentWallet)}`,
    { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000) },
  );

  if (!res.ok) {
    throw new Error(
      `[acp-job-delivery] Virtuals API returned ${res.status} for wallet ${agentWallet}`,
    );
  }

  const json = await res.json() as { data?: { contractAddress?: string }[] };
  const contractAddress = json.data?.[0]?.contractAddress;

  if (!contractAddress) {
    throw new Error(
      `[acp-job-delivery] No ACP agent found for wallet ${agentWallet}. ` +
      'Agent must be registered on the Virtuals ACP platform.',
    );
  }

  const alchemyRpc = process.env.ALCHEMY_RPC_URL;
  if (!alchemyRpc) throw new Error('[acp-job-delivery] ALCHEMY_RPC_URL not set');

  const publicClient = createPublicClient({ chain: base, transport: http(alchemyRpc) });
  const mintBlock    = await publicClient.getBlockNumber();

  return {
    acpContractAddress: contractAddress,
    mintBlock:          mintBlock.toString(),
  };
}