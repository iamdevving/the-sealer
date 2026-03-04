// src/lib/nft.ts
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const rpcUrl      = process.env.ALCHEMY_RPC_URL!;
const rawKey      = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey  = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;

const account      = privateKeyToAccount(privateKey as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

// Contract addresses
const STATEMENT_ADDRESS = process.env.STATEMENT_CONTRACT_ADDRESS as `0x${string}`;
const SID_ADDRESS       = process.env.SEALER_ID_CONTRACT_ADDRESS as `0x${string}`;
const SEALED_ADDRESS    = process.env.SEALED_CONTRACT_ADDRESS as `0x${string}`;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.thesealer.xyz';

// ABIs
const STATEMENT_ABI = parseAbi([
  'function mint(address recipient, string uri, uint8 productType, string attestationTx) returns (uint256)',
]);

const SID_ABI = parseAbi([
  'function mint(address recipient, string uri, string attestationTx) returns (uint256)',
  'function renew(address recipient, string newUri, string newAttestationTx)',
  'function hasSID(address wallet) view returns (bool)',
]);

const SEALED_ABI = parseAbi([
  'function mint(address recipient, string uri, string attestationTx, string paymentChain) returns (uint256)',
]);

async function sendAndWait(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 90000 });
}

function extractTokenId(receipt: any): bigint {
  // Transfer event: topics[3] is tokenId
  const log = receipt.logs?.find((l: any) => l.topics?.length === 4);
  return log ? BigInt(log.topics[3]) : BigInt(0);
}

async function storeMetadata(
  contract: 'statement' | 'sid' | 'sealed',
  tokenId: bigint,
  metadata: object,
) {
  const key = `nft:metadata:${contract}:${tokenId.toString()}`;
  await redis.set(key, metadata);
  console.log(`[NFT] Metadata stored: ${key}`);
}

/**
 * Mint a Badge NFT (productType = 0)
 */
export async function mintBadge(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  statement: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Badge for ${recipient}`);

  // Use metadata URL as tokenURI
  // We'll store first with a temp ID, then update after mint
  const hash = await walletClient.writeContract({
    address: STATEMENT_ADDRESS,
    abi:     STATEMENT_ABI,
    functionName: 'mint',
    args: [recipient, `${BASE_URL}/api/metadata/statement/pending`, 0, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  // Build and store metadata
  const metadata = {
    name:        `Sealer Badge #${tokenId}`,
    description: statement,
    image:       svgUrl,
    external_url: `${BASE_URL}/c/`,
    attributes: [
      { trait_type: 'Product',   value: 'Badge' },
      { trait_type: 'Chain',     value: 'Base' },
      { trait_type: 'Protocol',  value: 'EAS' },
      { trait_type: 'Soulbound', value: 'true' },
    ],
  };
  await storeMetadata('statement', tokenId, metadata);

  console.log(`[NFT] Badge minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

/**
 * Mint a Card NFT (productType = 1)
 */
export async function mintCard(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  statement: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Card for ${recipient}`);

  const hash = await walletClient.writeContract({
    address: STATEMENT_ADDRESS,
    abi:     STATEMENT_ABI,
    functionName: 'mint',
    args: [recipient, `${BASE_URL}/api/metadata/statement/pending`, 1, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  const metadata = {
    name:        `Sealer Card #${tokenId}`,
    description: statement,
    image:       svgUrl,
    external_url: `${BASE_URL}/c/`,
    attributes: [
      { trait_type: 'Product',   value: 'Card' },
      { trait_type: 'Chain',     value: 'Base' },
      { trait_type: 'Protocol',  value: 'EAS' },
      { trait_type: 'Soulbound', value: 'true' },
    ],
  };
  await storeMetadata('statement', tokenId, metadata);

  console.log(`[NFT] Card minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

/**
 * Mint or renew a Sealer ID NFT.
 */
export async function mintOrRenewSealerID(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  name: string,
  entityType: string,
  chain: string,
): Promise<{ tokenId: bigint | null; txHash: string; renewed: boolean }> {
  const hasSID = await publicClient.readContract({
    address:      SID_ADDRESS,
    abi:          SID_ABI,
    functionName: 'hasSID',
    args:         [recipient],
  });

  const metadataUrl = (tokenId: bigint) =>
    `${BASE_URL}/api/metadata/sid/${tokenId.toString()}`;

  if (hasSID) {
    console.log(`[NFT] Renewing SealerID for ${recipient}`);
    // For renewal we need the existing tokenId — read from Redis
    const existingKey = `nft:sid:wallet:${recipient}`;
    const existingTokenId = await redis.get<string>(existingKey) || '0';

    const hash = await walletClient.writeContract({
      address:      SID_ADDRESS,
      abi:          SID_ABI,
      functionName: 'renew',
      args:         [recipient, metadataUrl(BigInt(existingTokenId)), attestationTx],
    });
    await sendAndWait(hash);

    // Update metadata
    const metadata = buildSIDMetadata(existingTokenId, name, entityType, chain, svgUrl);
    await storeMetadata('sid', BigInt(existingTokenId), metadata);

    console.log(`[NFT] SealerID renewed — tx: ${hash}`);
    return { tokenId: BigInt(existingTokenId), txHash: hash, renewed: true };
  }

  console.log(`[NFT] Minting SealerID for ${recipient}`);
  const hash = await walletClient.writeContract({
    address:      SID_ADDRESS,
    abi:          SID_ABI,
    functionName: 'mint',
    args:         [recipient, `${BASE_URL}/api/metadata/sid/pending`, attestationTx],
  });

  const receipt  = await sendAndWait(hash);
  const tokenId  = extractTokenId(receipt);

  // Store wallet → tokenId mapping
  await redis.set(`nft:sid:wallet:${recipient}`, tokenId.toString());

  // Build and store metadata
  const metadata = buildSIDMetadata(tokenId.toString(), name, entityType, chain, svgUrl);
  await storeMetadata('sid', tokenId, metadata);

  console.log(`[NFT] SealerID minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash, renewed: false };
}

function buildSIDMetadata(
  tokenId: string,
  name: string,
  entityType: string,
  chain: string,
  svgUrl: string,
) {
  return {
    name:        `Sealer ID — ${name}`,
    description: `Onchain identity for ${name}. Issued by The Sealer Protocol.`,
    image:       svgUrl,
    external_url: `${BASE_URL}`,
    attributes: [
      { trait_type: 'Name',        value: name },
      { trait_type: 'Entity Type', value: entityType },
      { trait_type: 'Chain',       value: chain },
      { trait_type: 'Product',     value: 'Sealer ID' },
      { trait_type: 'Soulbound',   value: 'true' },
    ],
  };
}

/**
 * Mint a SEALed NFT (transferable)
 */
export async function mintSealed(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  paymentChain: string,
  statement: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting SEALed for ${recipient}`);

  const hash = await walletClient.writeContract({
    address:      SEALED_ADDRESS,
    abi:          SEALED_ABI,
    functionName: 'mint',
    args:         [recipient, `${BASE_URL}/api/metadata/sealed/pending`, attestationTx, paymentChain],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  const metadata = {
    name:        `Sealer Sealed #${tokenId}`,
    description: statement,
    image:       svgUrl,
    external_url: `${BASE_URL}/c/`,
    attributes: [
      { trait_type: 'Product',       value: 'SEALed' },
      { trait_type: 'Payment Chain', value: paymentChain },
      { trait_type: 'Protocol',      value: 'EAS' },
      { trait_type: 'Transferable',  value: 'true' },
    ],
  };
  await storeMetadata('sealed', tokenId, metadata);

  console.log(`[NFT] SEALed minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}
