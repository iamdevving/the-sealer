// src/lib/agentSig.ts
//
// EIP-712 wallet ownership verification for agentId.
//
// The problem:
//   agentId is caller-supplied with no proof of wallet ownership.
//   Any agent (or attacker) can claim any address as their agentId,
//   minting attestations and NFTs linked to wallets they don't control.
//
// The fix:
//   Before minting, require a fresh EIP-712 signature from the claimed wallet.
//   We verify the signature server-side using viem's verifyTypedData.
//   The signed payload binds: wallet address + action type + nonce (timestamp),
//   so signatures cannot be replayed across actions or after expiry.
//
// Agent UX impact:
//   The agent must sign a typed-data payload before submitting the request.
//   This is a single additional step and is standard in agent wallet flows.
//   Agents using Solana wallets (non-EVM) are exempt — they use a different
//   verification path where payment itself proves wallet control.
//
// Schema (what the agent signs):
//   Domain: { name: 'SealerProtocol', version: '1', chainId: 8453 }
//   Type:   SealerAction { wallet, action, nonce }
//   wallet: the agentId they're claiming
//   action: the endpoint action string ('attest' | 'attest-commitment')
//   nonce:  Unix timestamp (seconds) — valid for SIGNATURE_TTL_SECS

import { verifyTypedData } from 'viem';

// Signatures are valid for 5 minutes. Prevents replay without blocking
// slow agents that sign and then POST.
const SIGNATURE_TTL_SECS = 5 * 60;

// EIP-712 domain — tied to Base mainnet (chainId 8453)
const DOMAIN = {
  name:    'SealerProtocol',
  version: '1',
  chainId: 8453,
} as const;

// EIP-712 type definition
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
 *
 * @param agentId   - The wallet address the caller claims to be
 * @param action    - The action string (e.g. 'attest', 'attest-commitment')
 * @param nonce     - Unix timestamp (seconds) from the signed payload
 * @param signature - Hex EIP-712 signature from the agent's wallet
 */
export async function verifyAgentSignature(
  agentId:   string,
  action:    string,
  nonce:     number,
  signature: string,
): Promise<AgentSigVerifyResult> {

  // ── 1. Check nonce freshness ──────────────────────────────────────────────
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

  // ── 2. Verify EIP-712 signature ───────────────────────────────────────────
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
      return {
        valid:  false,
        reason: 'Signature verification failed — signature does not match the claimed wallet',
      };
    }

    return { valid: true, reason: 'ok' };

  } catch (err: any) {
    console.error('[agentSig] verifyTypedData error:', err?.message ?? err);
    return {
      valid:  false,
      reason: 'Signature verification error — ensure signature is a valid EIP-712 hex string',
    };
  }
}

/**
 * Returns the EIP-712 payload the agent must sign.
 * Include this in error responses so agents know exactly what to sign.
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
