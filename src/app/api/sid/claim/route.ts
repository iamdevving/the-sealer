// src/app/api/sid/claim/route.ts
// Free first-time handle claim for existing SIDs (legacy grace).
// Paid renewals go through /api/attest with format=sid.
//
// SECURITY CHANGES:
//
// 1. Action scope fix (HIGH): Changed required action from "attest" to
//    ACTIONS.CLAIM_HANDLE ("claim-handle"). Previously both /api/attest (paid)
//    and /api/sid/claim (free) accepted identical EIP-712 payloads — a sig from
//    a paid attestation call could be replayed here within the 5-min TTL window.
//
// 2. Rate limiting added (LOW): Was missing entirely. Now 20/hr per IP,
//    consistent with other write endpoints.
//
// 3. agentSig + wallet state enumeration fix (MEDIUM, previous session):
//    Signature verified before any state is revealed to the caller.

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyAgentSignature, getSigningPayload, ACTIONS } from '@/lib/agentSig';
import { rateLimitRequest } from '@/lib/security';

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
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const limited = await rateLimitRequest(req, 'sid-claim', 20, 3600);
  if (limited) return limited;

  let body: { walletAddress?: string; handle?: string; agentSig?: string; agentNonce?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const walletAddress = body.walletAddress?.trim().toLowerCase();
  const handle        = body.handle?.trim().toLowerCase();
  const agentSig      = body.agentSig?.trim()  || req.headers.get('X-AGENT-SIG')   || '';
  const agentNonce    = body.agentNonce?.trim() || req.headers.get('X-AGENT-NONCE') || '';

  if (!walletAddress || !walletAddress.startsWith('0x')) {
    return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
  }
  if (!handle) {
    return NextResponse.json({ error: 'handle required' }, { status: 400 });
  }
  if (!HANDLE_REGEX.test(handle)) {
    return NextResponse.json({ error: 'Invalid handle format' }, { status: 400 });
  }

  // ── Wallet ownership verification ─────────────────────────────────────────
  // Uses ACTIONS.CLAIM_HANDLE ("claim-handle") — distinct from "attest".
  // A sig obtained for /api/attest is cryptographically invalid here.
  if (!agentSig || !agentNonce) {
    const nonce = Math.floor(Date.now() / 1000);
    return NextResponse.json(
      {
        error:   'Wallet ownership verification required',
        message: 'POST /api/sid/claim requires an EIP-712 signature proving you control the wallet.',
        howToFix: {
          step1: `Sign the EIP-712 payload with action="${ACTIONS.CLAIM_HANDLE}"`,
          step2: 'Include agentSig (signature hex) and agentNonce (timestamp used) in your JSON body',
        },
        signingPayload: getSigningPayload(walletAddress, ACTIONS.CLAIM_HANDLE, nonce),
        exampleNonce:   nonce,
      },
      { status: 401 },
    );
  }

  const sigResult = await verifyAgentSignature(
    walletAddress,
    ACTIONS.CLAIM_HANDLE,
    Number(agentNonce),
    agentSig,
  );

  if (!sigResult.valid) {
    const nonce = Math.floor(Date.now() / 1000);
    return NextResponse.json(
      {
        error:          'Wallet ownership verification failed',
        reason:         sigResult.reason,
        signingPayload: getSigningPayload(walletAddress, ACTIONS.CLAIM_HANDLE, nonce),
        exampleNonce:   nonce,
      },
      { status: 401 },
    );
  }

  // ── Business logic — only reached after auth passes ───────────────────────

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const hasSID = await publicClient.readContract({
    address: SID_ADDRESS, abi: SID_ABI, functionName: 'hasSID',
    args: [walletAddress as `0x${string}`],
  });
  if (!hasSID) return NextResponse.json({ error: 'Wallet has no Sealer ID' }, { status: 400 });

  const freeClaim = await redis.get(`sid:free_claim_used:${walletAddress}`);
  if (freeClaim) {
    return NextResponse.json({
      error: 'Free handle claim already used. Handle updates require a paid renewal via /api/attest.',
      paid: true,
    }, { status: 402 });
  }

  const existing = await redis.get(`sid:handle:${handle}`);
  if (existing) return NextResponse.json({ error: 'Handle already taken' }, { status: 409 });

  const tokenId    = await publicClient.readContract({
    address: SID_ADDRESS, abi: SID_ABI, functionName: 'walletToTokenId',
    args: [walletAddress as `0x${string}`],
  });
  const currentUri = await publicClient.readContract({
    address: SID_ADDRESS, abi: SID_ABI, functionName: 'tokenURI',
    args: [tokenId],
  });

  let newUri: string;
  try {
    const url = new URL(currentUri as string);
    url.searchParams.set('handle', handle);
    newUri = url.toString();
  } catch {
    return NextResponse.json({ error: 'Could not parse current tokenURI' }, { status: 500 });
  }

  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  const txHash = await walletClient.writeContract({
    address:      SID_ADDRESS,
    abi:          SID_ABI,
    functionName: 'renew',
    args:         [walletAddress as `0x${string}`, newUri, 'handle-claim-free'],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1000, timeout: 60_000 });

  await Promise.all([
    redis.set(`sid:handle:${handle}`, walletAddress),
    redis.set(`sid:wallet:${walletAddress}`, handle),
    redis.set(`sid:free_claim_used:${walletAddress}`, 'true'),
  ]);

  console.log(`[sid/claim] ✅ ${walletAddress} claimed handle ${handle} — tx: ${txHash}`);

  return NextResponse.json({ success: true, handle, walletAddress, txHash, newUri });
}