// src/app/api/mirror/mint/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base, mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { withX402Payment } from '@/lib/x402';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const MIRROR_ADDRESS = process.env.MIRROR_CONTRACT_ADDRESS as `0x${string}`;
const ALCHEMY_KEY    = process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_RPC_URL?.split('/').pop() || '';
const HELIUS_KEY     = process.env.HELIUS_API_KEY || '';
const BASE_URL       = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
const OPERATOR_KEY   = process.env.TEST_PRIVATE_KEY as `0x${string}`;
const MIRROR_PRICE   = '0.20';

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

async function buildTokenURI(params: {
  imageUrl: string; chain: string; originalChain: string;
  nftName: string; txHash: string; originalContract: string;
  originalTokenId: string; mirrorTokenId: string;
}): Promise<string> {
  const { imageUrl, chain, originalChain, nftName, txHash, originalContract, originalTokenId, mirrorTokenId } = params;
  return `${BASE_URL}/api/mirror/card?chain=${encodeURIComponent(chain)}&originalChain=${encodeURIComponent(originalChain)}&nftName=${encodeURIComponent(nftName)}&txHash=${encodeURIComponent(txHash)}&originalContract=${encodeURIComponent(originalContract)}&originalTokenId=${encodeURIComponent(originalTokenId)}&mirrorTokenId=${encodeURIComponent(mirrorTokenId)}${imageUrl ? `&imageUrl=${encodeURIComponent(imageUrl)}` : ''}`;
}

export async function POST(req: NextRequest) {
  return withX402Payment(req, async (paymentChain) => {
    let body: any = {};
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const {
      originalChain,
      originalContract,
      originalTokenId,
      ownerWallet,
      recipientWallet,
      targetChain,
      nftName,
      imageUrl,
    } = body;

    if (!originalChain || !originalTokenId || !ownerWallet || !recipientWallet) {
      return NextResponse.json({ error: 'originalChain, originalTokenId, ownerWallet, recipientWallet required' }, { status: 400 });
    }

    const paymentSource = paymentChain === 'solana' ? 'Solana' : 'Base';

    // ── Verify ownership ────────────────────────────────────────────────────
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

    if (!OPERATOR_KEY) {
      return NextResponse.json({ error: 'Operator key not configured' }, { status: 500 });
    }

    try {
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

      const tokenURI = await buildTokenURI({
        imageUrl: imageUrl || '', chain: targetChain || 'Base', originalChain,
        nftName: nftName || `#${originalTokenId}`, txHash: mintTxHash,
        originalContract: originalContract || originalTokenId, originalTokenId, mirrorTokenId,
      });

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

      const mirrorData = {
        mirrorTokenId, originalChain,
        originalContract: originalContract || originalTokenId,
        originalTokenId, ownerWallet, recipientWallet,
        nftName: nftName || `#${originalTokenId}`,
        imageUrl: imageUrl || '', txHash: mintTxHash, tokenURI,
        mintedAt: new Date().toISOString(), invalidated: false,
        paymentChain: paymentSource,
      };
      await redis.set(`mirror:data:${mirrorTokenId}`, JSON.stringify(mirrorData), { ex: 365 * 86400 });
      await redis.set(`mirror:owner:${ownerWallet.toLowerCase()}:${originalChain}:${originalTokenId}`, mirrorTokenId, { ex: 365 * 86400 });

      return NextResponse.json({
        success: true, mirrorTokenId,
        txHash:  mintTxHash, tokenURI,
        permalink: `${BASE_URL}/mirror?mirrorTokenId=${mirrorTokenId}&txHash=${mintTxHash}&chain=${targetChain || 'Base'}&originalChain=${originalChain}&originalTokenId=${encodeURIComponent(originalTokenId)}&nftName=${encodeURIComponent(nftName || '')}&imageUrl=${encodeURIComponent(imageUrl || '')}`,
      });

    } catch (err: any) {
      console.error('[mirror/mint]', err);
      return NextResponse.json({ error: 'Mint failed', details: String(err) }, { status: 500 });
    }
  }, MIRROR_PRICE);
}