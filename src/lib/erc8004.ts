// src/lib/erc8004.ts
// Non-blocking ERC-8004 ReputationRegistry integration.
// Posts Sealer certificate outcomes as feedback signals to the ERC-8004
// ReputationRegistry on Base mainnet. Silently skips if agent has no
// ERC-8004 registration.

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const IDENTITY_REGISTRY  = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const;

const IDENTITY_ABI = parseAbi([
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);

const REPUTATION_ABI = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpointURI, string fileURI, bytes32 fileHash, bytes feedbackAuth) external',
]);

const rpcUrl    = process.env.ALCHEMY_RPC_URL!;
const rawPk     = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = (rawPk.startsWith('0x') ? rawPk : `0x${rawPk}`) as `0x${string}`;

export interface Erc8004FeedbackParams {
  agentWallet:    `0x${string}`;
  proofPoints:    number;
  claimType:      string;
  outcome:        'FULL' | 'PARTIAL' | 'FAILED';
  achievementUID: string;
}

export async function postErc8004Feedback(
  params: Erc8004FeedbackParams,
): Promise<void> {
  const { agentWallet, proofPoints, claimType, outcome, achievementUID } = params;

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });

    // 1. Check if agent has an ERC-8004 identity
    const balance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi:     IDENTITY_ABI,
      functionName: 'balanceOf',
      args:    [agentWallet],
    });

    if (!balance || balance === BigInt(0)) {
      console.log(`[erc8004] Agent ${agentWallet} has no ERC-8004 registration — skipping`);
      return;
    }

    // 2. Get their agentId (first token)
    const agentId = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi:     IDENTITY_ABI,
      functionName: 'tokenOfOwnerByIndex',
      args:    [agentWallet, BigInt(0)],
    });

    console.log(`[erc8004] Agent ${agentWallet} has ERC-8004 agentId=${agentId}`);

    // 3. Post feedback to ReputationRegistry
    const account      = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

    const easUrl = `https://base.easscan.org/attestation/view/${achievementUID}`;

    // value = proofPoints (0-100+ scaled to int128, valueDecimals=0)
    // tag1 = claimType, tag2 = outcome
    // feedbackAuth = 0x (no pre-auth required when posting as third-party validator)
    const tx = await walletClient.writeContract({
      address:      REPUTATION_REGISTRY,
      abi:          REPUTATION_ABI,
      functionName: 'giveFeedback',
      args: [
        agentId,
        BigInt(proofPoints),  // value
        0,                     // valueDecimals
        claimType,             // tag1
        outcome,               // tag2
        easUrl,                // endpointURI
        easUrl,                // fileURI — points to EAS attestation
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`, // fileHash
        '0x' as `0x${string}`, // feedbackAuth — empty for open feedback
      ],
    });

    console.log(`[erc8004] ✅ Feedback posted agentId=${agentId} proofPoints=${proofPoints} tx=${tx}`);

  } catch (err) {
    // Non-blocking — never throw, just log
    console.warn('[erc8004] Feedback post failed (non-fatal):', err);
  }
}