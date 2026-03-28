// src/app/api/sid/claim/route.ts
// Free first-time handle claim for existing SIDs (legacy grace).
// Paid renewals go through /api/attest with format=sid.
//
// SECURITY CHANGES:
//
// 1. agentSig required (MEDIUM): Previously any caller could claim a handle for
//    any wallet that hadn't used its free claim — no signature or payment needed.
//    Fix: EIP-712 wallet ownership verification added before any business logic.
//    Same pattern as all other write endpoints.
//
// 2. Wallet state enumeration fix (MEDIUM): Previously the endpoint revealed
//    whether a wallet had a SID and whether it had claimed a handle, without
//    any authentication. An attacker could silently probe any wallet address.
//    Fix: signature is verified FIRST. Only after auth passes does the server
//    check and disclose wallet registration state.
//
// Solana wallets (non-0x) could not use this endpoint anyway (it calls
// hasSID on Base contract), so EVM-only auth is appropriate here.

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyAgentSignature, getSigningPayload } from '@/lib/agentSig';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const HANDLE_REGEX  = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;
const SID_ADDRESS   = process.env.SEALER_ID_CONTRACT_ADDRESS as `0x${string}`;
const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const SID_ABI = parseAbi([
  'function hasSID(address wallet) view returns (bool)',
  'function walletToTokenId(address wallet) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function renew(address recipient, string newUri, string newAttestationTx) external',
]);

export async function POST(req: NextRequest) {
  let body: { walletAddress?: string; handle?: string; agentSig?: string; agentNonce?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const walletAddress = body.walletAddress?.trim().toLowerCase();
  const handle        = body.handle?.trim().toLowerCase();
  const agentSig      = body.agentSig?.trim()   || req.headers.get('X-AGENT-SIG')   || '';
  const agentNonce    = body.agentNonce?.trim()  || req.headers.get('X-AGENT-NONCE') || '';

  if (!walletAddress || !walletAddress.startsWith('0x')) {
    return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
  }
  if (!handle) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 });
  }
  if (!HANDLE_REGEX.test(handle)) {
    return NextResponse.json({ error: 'Invalid handle format' }, { status: 400 });
  }

  // ── SECURITY: Verify wallet ownership BEFORE any state checks ─────────────
  // Previously the endpoint executed business logic (hasSID, free claim check)
  // before any auth — leaking wallet registration state to unauthenticated callers.
  // Now we verify ownership first; only after passing does the server reveal
  // whether the wallet has a SID or has used its free claim.
  if (!agentSig || !agentNonce) {
    const nonce = Math.floor(Date.now() / 1000);
    return NextResponse.json(
      {
        error:   'Wallet ownership verification required',
        message: 'POST /api/sid/claim requires an EIP-712 signature proving you control the wallet.',
        howToFix: {
          step1: 'Sign the EIP-712 payload with your wallet',
          step2: 'Include agentSig (signature hex) and agentNonce (timestamp used) in your JSON body',
        },
        signingPayload: getSigningPayload(walletAddress, 'attest', nonce),
        exampleNonce:   nonce,
      },
      { status: 401 },
    );
  }

  const sigResult = await verifyAgentSignature(
    walletAddress,
    'attest',        // action — reuses the 'attest' action, consistent with SID mint
    Number(agentNonce),
    agentSig,
  );

  if (!sigResult.valid) {
    const nonce = Math.floor(Date.now() / 1000);
    return NextResponse.json(
      {
        error:          'Wallet ownership verification failed',
        reason:         sigResult.reason,
        signingPayload: getSigningPayload(walletAddress, 'attest', nonce),
        exampleNonce:   nonce,
      },
      { status: 401 },
    );
  }

  // ── Auth passed — now check business logic state ──────────────────────────

  // Check wallet has a SID
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const hasSID = await publicClient.readContract({
    address: SID_ADDRESS, abi: SID_ABI, functionName: 'hasSID',
    args: [walletAddress as `0x${string}`],
  });
  if (!hasSID) return NextResponse.json({ error: 'Wallet has no Sealer ID' }, { status: 400 });

  // Check free claim already used
  const freeClaim = await redis.get(`sid:free_claim_used:${walletAddress}`);
  if (freeClaim) {
    return NextResponse.json({
      error: 'Free handle claim already used. Handle updates require a paid renewal via /api/attest.',
      paid: true,
    }, { status: 402 });
  }

  // Check handle availability
  const existing = await redis.get(`sid:handle:${handle}`);
  if (existing) return NextResponse.json({ error: 'Handle already taken' }, { status: 409 });

  // Get current tokenURI to preserve existing params
  const tokenId    = await publicClient.readContract({
    address: SID_ADDRESS, abi: SID_ABI, functionName: 'walletToTokenId',
    args: [walletAddress as `0x${string}`],
  });
  const currentUri = await publicClient.readContract({
    address: SID_ADDRESS, abi: SID_ABI, functionName: 'tokenURI',
    args: [tokenId],
  });

  // Inject handle into tokenURI
  let newUri: string;
  try {
    const url = new URL(currentUri as string);
    url.searchParams.set('handle', handle);
    newUri = url.toString();
  } catch {
    return NextResponse.json({ error: 'Could not parse current tokenURI' }, { status: 500 });
  }

  // Call renew() on contract
  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  const txHash = await walletClient.writeContract({
    address:      SID_ADDRESS,
    abi:          SID_ABI,
    functionName: 'renew',
    args:         [walletAddress as `0x${string}`, newUri, 'handle-claim-free'],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1000, timeout: 60_000 });

  // Write to Redis
  await Promise.all([
    redis.set(`sid:handle:${handle}`, walletAddress),
    redis.set(`sid:wallet:${walletAddress}`, handle),
    redis.set(`sid:free_claim_used:${walletAddress}`, 'true'),
  ]);

  console.log(`[sid/claim] ✅ ${walletAddress} claimed handle ${handle} — tx: ${txHash}`);

  return NextResponse.json({
    success: true,
    handle,
    walletAddress,
    txHash,
    newUri,
  });
}