// src/lib/agentSig.ts
//
// EIP-712 wallet ownership verification for agentId.
//
// SECURITY CHANGES:
//
// 1. Nonce replay protection (MEDIUM): Previously a valid {agentSig, agentNonce}
//    pair could be submitted multiple times within the 5-minute TTL window.
//    Fix: after a sig passes, we SETNX `sig:used:{wallet}:{nonce}` in Redis
//    with TTL=300s. Any replay of the same pair is rejected with 401.
//    This protects ALL endpoints in one place.
//
// 2. Action scope constants (HIGH): Exported ACTIONS map so each endpoint
//    uses a distinct action string. /api/sid/claim uses ACTIONS.CLAIM_HANDLE
//    ("claim-handle") instead of "attest" — prevents cross-endpoint replay
//    where a paid attestation sig is reused to claim a handle for free.
//
// Everything else (interface, verifyAgentSignature signature, getSigningPayload)
// is unchanged — no callers need updating except sid/claim's action string.

import { verifyTypedData } from 'viem';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// ── Action constants ──────────────────────────────────────────────────────────
// Each endpoint must use its own action. A sig scoped to one action is
// cryptographically invalid at any endpoint expecting a different one.
export const ACTIONS = {
  ATTEST:           'attest',           // /api/attest, /api/attest-commitment
  ATTEST_AMENDMENT: 'attest-amendment', // /api/attest-amendment
  MIRROR_MINT:      'mirror-mint',      // /api/mirror/mint
  CLAIM_HANDLE:     'claim-handle',     // /api/sid/claim
  UPLOAD:           'upload',           // /api/upload
} as const;

const SIGNATURE_TTL_SECS = 5 * 60; // 5 minutes

const DOMAIN = {
  name:    'SealerProtocol',
  version: '1',
  chainId: 8453,
} as const;

const TYPES = {
  SealerAction: [
    { name: 'wallet', type: 'address' },
    { name: 'action', type: 'string'  },
    { name: 'nonce',  type: 'uint256' },
  ],
} as const;

export interface AgentSigVerifyResult {
  valid:  boolean;
  reason: string;
}

/**
 * Verify that the caller owns the wallet they claim as agentId.
 * On success, consumes the nonce — replay within TTL window is rejected.
 */
export async function verifyAgentSignature(
  agentId:   string,
  action:    string,
  nonce:     number,
  signature: string,
): Promise<AgentSigVerifyResult> {

  // 1. Check nonce freshness
  const nowSecs = Math.floor(Date.now() / 1000);
  const ageSecs = nowSecs - nonce;

  if (ageSecs < 0) {
    return { valid: false, reason: 'Signature nonce is in the future — clock skew or replay attempt' };
  }
  if (ageSecs > SIGNATURE_TTL_SECS) {
    return {
      valid:  false,
      reason: `Signature expired (${ageSecs}s old, max ${SIGNATURE_TTL_SECS}s). Re-sign with a fresh nonce.`,
    };
  }

  // 2. Replay protection — SETNX: only succeeds if key does not exist
  const replayKey = `sig:used:${agentId.toLowerCase()}:${nonce}`;
  const wasSet = await redis.set(replayKey, '1', { nx: true, ex: SIGNATURE_TTL_SECS });

  if (wasSet === null) {
    // Key already existed — nonce was already consumed
    return { valid: false, reason: 'Nonce already used — generate a fresh signature' };
  }

  // 3. Verify EIP-712 signature
  try {
    const address = agentId as `0x${string}`;

    const valid = await verifyTypedData({
      address,
      domain:  DOMAIN,
      types:   TYPES,
      primaryType: 'SealerAction',
      message: {
        wallet: address,
        action,
        nonce:  BigInt(nonce),
      },
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      // Wrong sig — release the nonce so caller can retry with the correct key
      await redis.del(replayKey).catch(() => {});
      return {
        valid:  false,
        reason: 'Signature verification failed — signature does not match the claimed wallet',
      };
    }

    return { valid: true, reason: 'ok' };

  } catch (err: any) {
    // On error — release nonce so caller can retry
    await redis.del(replayKey).catch(() => {});
    console.error('[agentSig] verifyTypedData error:', err?.message ?? err);
    return {
      valid:  false,
      reason: 'Signature verification error — ensure signature is a valid EIP-712 hex string',
    };
  }
}

/**
 * Returns the EIP-712 payload the agent must sign.
 * Include this in 401 responses so agents know exactly what to sign.
 */
export function getSigningPayload(agentId: string, action: string, nonce: number) {
  return {
    domain: DOMAIN,
    types:  TYPES,
    primaryType: 'SealerAction',
    message: {
      wallet: agentId,
      action,
      nonce,
    },
  };
}