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

const STATEMENT_ADDRESS = process.env.STATEMENT_CONTRACT_ADDRESS as `0x${string}`;
const SID_ADDRESS       = process.env.SEALER_ID_CONTRACT_ADDRESS as `0x${string}`;
const SLEEVE_ADDRESS    = process.env.SLEEVE_CONTRACT_ADDRESS as `0x${string}`;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.thesealer.xyz';

const STATEMENT_ABI = parseAbi([
  'function mint(address recipient, string uri, uint8 productType, string attestationTx) returns (uint256)',
]);

const SID_ABI = parseAbi([
  'function mint(address recipient, string uri, string attestationTx) returns (uint256)',
  'function renew(address recipient, string newUri, string newAttestationTx)',
  'function hasSID(address wallet) view returns (bool)',
]);

const SLEEVE_ABI = parseAbi([
  'function mint(address recipient, string uri, string attestationTx, string paymentChain) returns (uint256)',
]);

async function sendAndWait(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 90000 });
}

function extractTokenId(receipt: any): bigint {
  const log = receipt.logs?.find((l: any) => l.topics?.length === 4);
  return log ? BigInt(log.topics[3]) : BigInt(0);
}

async function storeMetadata(
  contract: 'statement' | 'sid' | 'sleeve',
  tokenId: bigint,
  metadata: object,
) {
  const key = `nft:metadata:${contract}:${tokenId.toString()}`;
  await redis.set(key, metadata);
  console.log(`[NFT] Metadata stored: ${key}`);
}

export async function mintBadge(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  statement: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Badge for ${recipient}`);

  const hash = await walletClient.writeContract({
    address: STATEMENT_ADDRESS,
    abi:     STATEMENT_ABI,
    functionName: 'mint',
    args: [recipient, `${BASE_URL}/api/metadata/statement/pending`, 0, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

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
    const existingKey     = `nft:sid:wallet:${recipient}`;
    const existingTokenId = await redis.get<string>(existingKey) || '0';

    const hash = await walletClient.writeContract({
      address:      SID_ADDRESS,
      abi:          SID_ABI,
      functionName: 'renew',
      args:         [recipient, metadataUrl(BigInt(existingTokenId)), attestationTx],
    });
    await sendAndWait(hash);

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

  await redis.set(`nft:sid:wallet:${recipient}`, tokenId.toString());

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

export async function mintSleeve(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  paymentChain: string,
  statement: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Sleeve for ${recipient}`);

  const hash = await walletClient.writeContract({
    address:      SLEEVE_ADDRESS,
    abi:          SLEEVE_ABI,
    functionName: 'mint',
    args:         [recipient, `${BASE_URL}/api/metadata/sleeve/pending`, attestationTx, paymentChain],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  const metadata = {
    name:        `Sealer Sleeve #${tokenId}`,
    description: statement,
    image:       svgUrl,
    external_url: `${BASE_URL}/c/`,
    attributes: [
      { trait_type: 'Product',       value: 'Sleeve' },
      { trait_type: 'Payment Chain', value: paymentChain },
      { trait_type: 'Protocol',      value: 'EAS' },
      { trait_type: 'Soulbound',     value: 'true' },
    ],
  };
  await storeMetadata('sleeve', tokenId, metadata);

  console.log(`[NFT] Sleeve minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}
