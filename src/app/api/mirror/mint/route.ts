// src/app/api/mirror/mint/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base, mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { withZauthX402Payment } from '@/lib/zauth';
import { mintSolanaMirror } from '@/lib/solana-mint';
import { x402Challenge } from '@/lib/x402';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const MIRROR_ADDRESS = process.env.MIRROR_CONTRACT_ADDRESS as `0x${string}`;
const ALCHEMY_KEY    = process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_RPC_URL?.split('/').pop() || '';
const HELIUS_KEY     = process.env.HELIUS_API_KEY || '';
const BASE_URL       = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
const OPERATOR_KEY   = process.env.TEST_PRIVATE_KEY as `0x${string}`;
const MIRROR_PRICE_BASE   = '0.30';
const MIRROR_PRICE_SOLANA = '0.90';

const MIRROR_ABI = parseAbi([
  'function mintMirror((address recipient, string tokenURI, string originalChain, string originalContract, string originalTokenId, string attestationTxHash, string paymentChain) p) external returns (uint256)',
  'function mirrors(uint256) external view returns (string originalChain, string originalContract, string originalTokenId, address originalOwner, string attestationTxHash, string paymentChain, bool invalidated)',
]);

const ERC721_ABI  = parseAbi(['function ownerOf(uint256 tokenId) external view returns (address)']);
const ERC1155_ABI = parseAbi(['function balanceOf(address account, uint256 id) view returns (uint256)']);

const baseClient = createPublicClient({ chain: base,    transport: http(process.env.ALCHEMY_RPC_URL!) });
const ethClient  = createPublicClient({ chain: mainnet, transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`) });

function getClient(chain: string) {
  return chain === 'ethereum' ? ethClient : baseClient;
}

async function verifyEVMOwnership(chain: string, contract: string, tokenId: string, wallet: string): Promise<boolean> {
  const client     = getClient(chain);
  const tokenIdBig = BigInt(tokenId);

  try {
    const owner = await client.readContract({
      address: contract as `0x${string}`, abi: ERC721_ABI,
      functionName: 'ownerOf', args: [tokenIdBig],
    });
    return owner.toLowerCase() === wallet.toLowerCase();
  } catch {}

  try {
    const balance = await client.readContract({
      address: contract as `0x${string}`, abi: ERC1155_ABI,
      functionName: 'balanceOf', args: [wallet as `0x${string}`, tokenIdBig],
    });
    return balance > BigInt(0);
  } catch {}

  try {
    const network    = chain === 'ethereum' ? 'eth-mainnet' : 'base-mainnet';
    const alchemyUrl = `https://${network}.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/isHolderOfCollection?wallet=${wallet}&contractAddress=${contract}`;
    const res        = await fetch(alchemyUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return !!data.isHolderOfCollection;
    }
  } catch {}

  return false;
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

function buildTokenURI(params: {
  imageUrl: string; chain: string; originalChain: string;
  nftName: string; txHash: string; originalContract: string;
  originalTokenId: string; mirrorTokenId: string;
}): string {
  const { imageUrl, chain, originalChain, nftName, txHash, originalContract, originalTokenId, mirrorTokenId } = params;
  return `${BASE_URL}/api/mirror/card?chain=${encodeURIComponent(chain)}&originalChain=${encodeURIComponent(originalChain)}&nftName=${encodeURIComponent(nftName)}&txHash=${encodeURIComponent(txHash)}&originalContract=${encodeURIComponent(originalContract)}&originalTokenId=${encodeURIComponent(originalTokenId)}&mirrorTokenId=${encodeURIComponent(mirrorTokenId)}${imageUrl ? `&imageUrl=${encodeURIComponent(imageUrl)}` : ''}`;
}

// ── Mint on Base (EVM SealerMirror contract) ─────────────────────────────────
async function mintOnBase(params: {
  recipientWallet: string; originalChain: string; originalContract: string;
  originalTokenId: string; ownerWallet: string; nftName: string;
  imageUrl: string; paymentSource: string;
}) {
  const { recipientWallet, originalChain, originalContract, originalTokenId, ownerWallet, nftName, imageUrl, paymentSource } = params;

  const account      = privateKeyToAccount(OPERATOR_KEY);
  const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.ALCHEMY_RPC_URL!) });

  const mintTxHash = await walletClient.writeContract({
    address:      MIRROR_ADDRESS,
    abi:          MIRROR_ABI,
    functionName: 'mintMirror',
    args: [{
      recipient:         recipientWallet as `0x${string}`,
      tokenURI:          `${BASE_URL}/api/mirror/card?mirrorTokenId=pending`,
      originalChain,
      originalContract:  originalContract || originalTokenId,
      originalTokenId,
      attestationTxHash: '',
      paymentChain:      paymentSource,
    }],
  });

  const receipt = await baseClient.waitForTransactionReceipt({ hash: mintTxHash });

  let mirrorTokenId = '0';
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === MIRROR_ADDRESS.toLowerCase() && log.topics[3]) {
      mirrorTokenId = BigInt(log.topics[3]).toString();
      break;
    }
  }

  const tokenURI = buildTokenURI({
    imageUrl, chain: 'Base', originalChain,
    nftName: nftName || `#${originalTokenId}`, txHash: mintTxHash,
    originalContract: originalContract || originalTokenId, originalTokenId, mirrorTokenId,
  });

  // Update tokenURI with real mirrorTokenId
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

  return { mirrorTokenId, txHash: mintTxHash, tokenURI, targetChain: 'Base' };
}

// ── Mint on Solana (Metaplex Core) ───────────────────────────────────────────
async function mintOnSolana(params: {
  recipientWallet: string; originalChain: string; originalContract: string;
  originalTokenId: string; nftName: string; imageUrl: string;
}) {
  const { recipientWallet, originalChain, originalContract, originalTokenId, nftName, imageUrl } = params;

  // Build a temp token URI — we use a unique ID based on timestamp
  const tempId   = `sol-${Date.now()}`;
  const tokenURI = buildTokenURI({
    imageUrl, chain: 'Solana', originalChain,
    nftName: nftName || `#${originalTokenId}`, txHash: tempId,
    originalContract: originalContract || originalTokenId, originalTokenId, mirrorTokenId: tempId,
  });

  const result = await mintSolanaMirror({
    recipientAddress: recipientWallet,
    name:             `Mirror: ${nftName || originalTokenId}`,
    uri:              tokenURI,
    mirrorTokenId:    tempId,
  });

  // Final token URI with real mint address
  const finalTokenURI = buildTokenURI({
    imageUrl, chain: 'Solana', originalChain,
    nftName: nftName || `#${originalTokenId}`, txHash: result.txSignature,
    originalContract: originalContract || originalTokenId, originalTokenId,
    mirrorTokenId: result.mintAddress,
  });

  return {
    mirrorTokenId: result.mintAddress,
    txHash:        result.txSignature,
    tokenURI:      finalTokenURI,
    targetChain:   'Solana',
  };
}

export async function POST(req: NextRequest) {
  // Read body first to determine price based on target chain
  // We need to clone before withX402Payment consumes it
  let price = MIRROR_PRICE_BASE;
  try {
    const preview = await req.clone().json();
    if (preview?.targetChain === 'Solana') price = MIRROR_PRICE_SOLANA;
  } catch {}

  return withZauthX402Payment(req, async (paymentChain: 'base' | 'solana' | undefined) => {
    let body: any = {};
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const {
      originalChain,
      originalContract,
      originalTokenId,
      ownerWallet,
      recipientWallet,
      targetChain,     // 'Base' | 'Solana'
      nftName,
      imageUrl,
    } = body;

    if (!originalChain || !originalTokenId || !ownerWallet || !recipientWallet) {
      return NextResponse.json({ error: 'originalChain, originalTokenId, ownerWallet, recipientWallet required' }, { status: 400 });
    }

    const paymentSource = paymentChain === 'solana' ? 'Solana' : 'Base';
    const target        = targetChain || 'Base';

    // Validate recipient format matches target chain
    if (target === 'Base' && !recipientWallet.startsWith('0x')) {
      return NextResponse.json({ error: 'Base target requires an EVM wallet address (0x...)' }, { status: 400 });
    }
    if (target === 'Solana' && recipientWallet.startsWith('0x')) {
      return NextResponse.json({ error: 'Solana target requires a Solana wallet address' }, { status: 400 });
    }

    // ── Verify ownership ──────────────────────────────────────────────────────
    let ownershipVerified = false;

    if (originalChain === 'base' || originalChain === 'ethereum') {
      if (!originalContract) return NextResponse.json({ error: 'originalContract required for EVM NFTs' }, { status: 400 });
      ownershipVerified = await verifyEVMOwnership(originalChain, originalContract, originalTokenId, ownerWallet);
    } else if (originalChain === 'solana') {
      ownershipVerified = await verifySolanaOwnership(originalTokenId, ownerWallet);
    }

    if (!ownershipVerified) {
      return NextResponse.json({
        error: 'Ownership verification failed. The wallet does not own this NFT.',
        originalChain, originalContract, originalTokenId, ownerWallet,
      }, { status: 403 });
    }

    // ── Mint ──────────────────────────────────────────────────────────────────
    try {
      let mintResult: { mirrorTokenId: string; txHash: string; tokenURI: string; targetChain: string };

      if (target === 'Solana') {
        mintResult = await mintOnSolana({
          recipientWallet, originalChain,
          originalContract: originalContract || originalTokenId,
          originalTokenId, nftName: nftName || `#${originalTokenId}`,
          imageUrl: imageUrl || '',
        });
      } else {
        if (!OPERATOR_KEY) return NextResponse.json({ error: 'Operator key not configured' }, { status: 500 });
        mintResult = await mintOnBase({
          recipientWallet, originalChain,
          originalContract: originalContract || originalTokenId,
          originalTokenId, ownerWallet,
          nftName: nftName || `#${originalTokenId}`,
          imageUrl: imageUrl || '', paymentSource,
        });
      }

      // Store in Redis
      const mirrorData = {
        mirrorTokenId:    mintResult.mirrorTokenId,
        targetChain:      mintResult.targetChain,
        originalChain,
        originalContract: originalContract || originalTokenId,
        originalTokenId,  ownerWallet, recipientWallet,
        nftName:          nftName || `#${originalTokenId}`,
        imageUrl:         imageUrl || '',
        txHash:           mintResult.txHash,
        tokenURI:         mintResult.tokenURI,
        mintedAt:         new Date().toISOString(),
        invalidated:      false,
        paymentChain:     paymentSource,
      };

      const redisKey = target === 'Solana'
        ? `mirror:sol:${mintResult.mirrorTokenId}`
        : `mirror:data:${mintResult.mirrorTokenId}`;

      await redis.set(redisKey, JSON.stringify(mirrorData), { ex: 365 * 86400 });
      await redis.set(
        `mirror:owner:${ownerWallet.toLowerCase()}:${originalChain}:${originalTokenId}`,
        `${target}:${mintResult.mirrorTokenId}`,
        { ex: 365 * 86400 }
      );

      return NextResponse.json({
        success:      true,
        mirrorTokenId: mintResult.mirrorTokenId,
        txHash:       mintResult.txHash,
        tokenURI:     mintResult.tokenURI,
        targetChain:  mintResult.targetChain,
        permalink:    `${BASE_URL}/mirror?mirrorTokenId=${encodeURIComponent(mintResult.mirrorTokenId)}&txHash=${encodeURIComponent(mintResult.txHash)}&chain=${mintResult.targetChain}&originalChain=${originalChain}&originalTokenId=${encodeURIComponent(originalTokenId)}&nftName=${encodeURIComponent(nftName || '')}&imageUrl=${encodeURIComponent(imageUrl || '')}`,
      });

    } catch (err: any) {
      console.error('[mirror/mint]', err);
      return NextResponse.json({ error: 'Mint failed', details: String(err) }, { status: 500 });
    }
  }, price, {
  schema: { properties: {
    input: { properties: { body: { type: 'object', required: ['originalChain','originalTokenId','ownerWallet','recipientWallet'], properties: { originalChain: { type: 'string' }, originalContract: { type: 'string' }, originalTokenId: { type: 'string' }, ownerWallet: { type: 'string' }, recipientWallet: { type: 'string' }, targetChain: { type: 'string' } } } } },
    output: { properties: { example: { success: true, mirrorTokenId: 'abc', txHash: '0xdef', targetChain: 'Base' } } },
  } },
});
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/mirror/mint',
    description: 'Mint a soulbound Mirror NFT of any Base or Solana NFT you own',
    docs: 'https://thesealer.xyz/api/infoproducts',
    x402: true,
    price: '$0.30 (Base NFT) | $0.90 (Solana NFT) USDC',
    networks: ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    params: {
      walletAddress: 'your wallet address',
      sourceChain: 'base | solana',
      contractAddress: 'NFT contract address (Base) or mint address (Solana)',
      tokenId: 'token ID (Base NFTs only)',
    },
  });
}