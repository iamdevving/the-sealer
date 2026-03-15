// src/app/api/mirror/mint/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const MIRROR_ADDRESS = process.env.MIRROR_CONTRACT_ADDRESS as `0x${string}`;
const ALCHEMY_KEY    = process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_RPC_URL?.split('/').pop() || '';
const HELIUS_KEY     = process.env.HELIUS_API_KEY || '';
const BASE_URL       = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
const OPERATOR_KEY   = process.env.TEST_PRIVATE_KEY as `0x${string}`;

const MIRROR_ABI = parseAbi([
  'function mintMirror((address recipient, string tokenURI, string originalChain, string originalContract, string originalTokenId, string attestationTxHash, string paymentChain) p) external returns (uint256)',
  'function mirrors(uint256) external view returns (string originalChain, string originalContract, string originalTokenId, address originalOwner, string attestationTxHash, string paymentChain, bool invalidated)',
]);

const ERC721_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) external view returns (address)',
]);

const publicClient = createPublicClient({ chain: base, transport: http(process.env.ALCHEMY_RPC_URL!) });

async function verifyBaseOwnership(contract: string, tokenId: string, wallet: string): Promise<boolean> {
  try {
    const owner = await publicClient.readContract({
      address:      contract as `0x${string}`,
      abi:          ERC721_ABI,
      functionName: 'ownerOf',
      args:         [BigInt(tokenId)],
    });
    return owner.toLowerCase() === wallet.toLowerCase();
  } catch { return false; }
}

async function verifySolanaOwnership(mint: string, wallet: string): Promise<boolean> {
  if (!HELIUS_KEY) return false;
  try {
    const url  = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
    const body = { jsonrpc: '2.0', id: 'get-asset', method: 'getAsset', params: { id: mint } };
    const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    return data.result?.ownership?.owner === wallet;
  } catch { return false; }
}

async function buildTokenURI(params: {
  imageUrl: string; chain: string; originalChain: string;
  nftName: string; txHash: string; originalContract: string;
  originalTokenId: string; mirrorTokenId: string;
}): Promise<string> {
  const { imageUrl, chain, originalChain, nftName, txHash, originalContract, originalTokenId, mirrorTokenId } = params;
  return `${BASE_URL}/api/mirror/card?chain=${encodeURIComponent(chain)}&originalChain=${encodeURIComponent(originalChain)}&nftName=${encodeURIComponent(nftName)}&txHash=${encodeURIComponent(txHash)}&originalContract=${encodeURIComponent(originalContract)}&originalTokenId=${encodeURIComponent(originalTokenId)}&mirrorTokenId=${encodeURIComponent(mirrorTokenId)}${imageUrl ? `&imageUrl=${encodeURIComponent(imageUrl)}` : ''}`;
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const {
    originalChain,    // 'base' | 'solana'
    originalContract, // contract address (base) or collection/mint (solana)
    originalTokenId,  // token id (base) or mint address (solana)
    ownerWallet,      // wallet that owns the original NFT
    recipientWallet,  // wallet to receive the mirror (can differ)
    targetChain,      // currently always 'Base'
    nftName,
    imageUrl,
    paymentChain,     // 'Base' | 'Solana'
  } = body;

  if (!originalChain || !originalTokenId || !ownerWallet || !recipientWallet) {
    return NextResponse.json({ error: 'originalChain, originalTokenId, ownerWallet, recipientWallet required' }, { status: 400 });
  }

  // ── Verify ownership ──────────────────────────────────────────────────────
  let ownershipVerified = false;

  if (originalChain === 'base') {
    if (!originalContract) return NextResponse.json({ error: 'originalContract required for Base NFTs' }, { status: 400 });
    ownershipVerified = await verifyBaseOwnership(originalContract, originalTokenId, ownerWallet);
  } else if (originalChain === 'solana') {
    ownershipVerified = await verifySolanaOwnership(originalTokenId, ownerWallet);
  }

  // Allow test bypass
  if (req.headers.get('X-TEST-PAYMENT') === 'true') ownershipVerified = true;

  if (!ownershipVerified) {
    return NextResponse.json({
      error: 'Ownership verification failed. The wallet does not own this NFT.',
      originalChain, originalContract, originalTokenId, ownerWallet,
    }, { status: 403 });
  }

  // ── Mint via contract ─────────────────────────────────────────────────────
  if (!OPERATOR_KEY) {
    return NextResponse.json({ error: 'Operator key not configured' }, { status: 500 });
  }

  try {
    const account      = privateKeyToAccount(OPERATOR_KEY);
    const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.ALCHEMY_RPC_URL!) });

    // Placeholder tokenURI — we'll update with real tokenId after mint
    const placeholderURI = `${BASE_URL}/api/mirror/card?mirrorTokenId=pending`;

    const mintTxHash = await walletClient.writeContract({
      address:      MIRROR_ADDRESS,
      abi:          MIRROR_ABI,
      functionName: 'mintMirror',
      args: [{
        recipient:         recipientWallet as `0x${string}`,
        tokenURI:          placeholderURI,
        originalChain:     originalChain,
        originalContract:  originalContract || originalTokenId,
        originalTokenId:   originalTokenId,
        attestationTxHash: '',
        paymentChain:      paymentChain || 'Base',
      }],
    });

    // Wait for receipt to get tokenId
    const receipt = await publicClient.waitForTransactionReceipt({ hash: mintTxHash });

    // Parse tokenId from Transfer event (topic[3])
    let mirrorTokenId = '0';
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === MIRROR_ADDRESS.toLowerCase() && log.topics[3]) {
        mirrorTokenId = BigInt(log.topics[3]).toString();
        break;
      }
    }

    // Build and update tokenURI with real tokenId
    const tokenURI = await buildTokenURI({
      imageUrl: imageUrl || '', chain: targetChain || 'Base', originalChain,
      nftName: nftName || `#${originalTokenId}`, txHash: mintTxHash,
      originalContract: originalContract || originalTokenId, originalTokenId, mirrorTokenId,
    });

    // Update tokenURI via updateMirror
    await walletClient.writeContract({
      address:      MIRROR_ADDRESS,
      abi:          parseAbi(['function updateMirror(uint256 tokenId, string tokenURI_, string newOriginalChain, string newOriginalContract, string newOriginalTokenId, address newOriginalOwner, string newAttestationTxHash) external']),
      functionName: 'updateMirror',
      args: [
        BigInt(mirrorTokenId), tokenURI, originalChain,
        originalContract || originalTokenId, originalTokenId,
        ownerWallet as `0x${string}`, mintTxHash,
      ],
    });

    // Store in Redis
    const mirrorData = {
      mirrorTokenId, originalChain, originalContract: originalContract || originalTokenId,
      originalTokenId, ownerWallet, recipientWallet, nftName: nftName || `#${originalTokenId}`,
      imageUrl: imageUrl || '', txHash: mintTxHash, tokenURI,
      mintedAt: new Date().toISOString(), invalidated: false, paymentChain: paymentChain || 'Base',
    };
    await redis.set(`mirror:data:${mirrorTokenId}`, JSON.stringify(mirrorData), { ex: 365 * 86400 });
    await redis.set(`mirror:owner:${ownerWallet.toLowerCase()}:${originalChain}:${originalTokenId}`, mirrorTokenId, { ex: 365 * 86400 });

    return NextResponse.json({
      success:       true,
      mirrorTokenId,
      txHash:        mintTxHash,
      tokenURI,
      permalink:     `${BASE_URL}/mirror?mirrorTokenId=${mirrorTokenId}&txHash=${mintTxHash}&chain=${targetChain || 'Base'}&originalChain=${originalChain}&originalTokenId=${encodeURIComponent(originalTokenId)}&nftName=${encodeURIComponent(nftName || '')}&imageUrl=${encodeURIComponent(imageUrl || '')}`,
    });

  } catch (err: any) {
    console.error('[mirror/mint]', err);
    return NextResponse.json({ error: 'Mint failed', details: String(err) }, { status: 500 });
  }
}