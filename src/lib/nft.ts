// src/lib/nft.ts
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const rpcUrl     = process.env.ALCHEMY_RPC_URL!;
const rawKey     = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const BASE_URL   = process.env.NEXT_PUBLIC_BASE_URL!;

const account      = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

// ── Contract addresses ────────────────────────────────────────────────────────
const STATEMENT_ADDRESS   = process.env.STATEMENT_CONTRACT_ADDRESS   as `0x${string}`;
const SID_ADDRESS         = process.env.SEALER_ID_CONTRACT_ADDRESS   as `0x${string}`;
const SLEEVE_ADDRESS      = process.env.SLEEVE_CONTRACT_ADDRESS      as `0x${string}`;
const MIRROR_ADDRESS      = process.env.MIRROR_CONTRACT_ADDRESS      as `0x${string}`;
const COMMITMENT_ADDRESS  = process.env.COMMITMENT_CONTRACT_ADDRESS  as `0x${string}`;
const CERTIFICATE_ADDRESS = process.env.CERTIFICATE_CONTRACT_ADDRESS as `0x${string}`;

// ── ABIs ──────────────────────────────────────────────────────────────────────
const STATEMENT_ABI = parseAbi([
  'function mint(address recipient, string uri, uint8 productType, string attestationTx) returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const SID_ABI = parseAbi([
  'function mint(address recipient, string uri, string attestationTx) returns (uint256)',
  'function renew(address recipient, string newUri, string newAttestationTx)',
  'function hasSID(address wallet) view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const SLEEVE_ABI = parseAbi([
  'function mint(address recipient, string uri, string attestationTx, string paymentChain) returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const MIRROR_ABI = parseAbi([
  'function mintMirror((address recipient, string tokenURI, string originalChain, string originalContract, string originalTokenId, string attestationTxHash, string paymentChain) p) returns (uint256)',
  'function invalidate(uint256 tokenId) external',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const COMMITMENT_ABI = parseAbi([
  'function mint(address recipient, string uri, string claimType, string attestationTx, uint64 deadline) returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const CERTIFICATE_ABI = parseAbi([
  'function mint(address recipient, string uri, string claimType, uint8 outcome, uint8 difficulty, uint32 proofPoints, uint8 metricsMet, uint8 metricsTotal, bool onTime, int16 daysEarly, uint64 deadline, string commitmentTx, string achievementTx) returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sendAndWait(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1000, timeout: 90_000 });
}

function extractTokenId(receipt: Awaited<ReturnType<typeof sendAndWait>>): bigint {
  // Transfer event: topics[3] is tokenId (indexed)
  for (const log of receipt.logs) {
    if (log.topics.length === 4) {
      return BigInt(log.topics[3]);
    }
  }
  return BigInt(0);
}

async function storeMetadata(
  contract: 'statement' | 'sid' | 'sleeve' | 'mirror' | 'commitment' | 'certificate',
  tokenId: bigint,
  metadata: object,
) {
  const key = `nft:metadata:${contract}:${tokenId.toString()}`;
  await redis.set(key, metadata);
  console.log(`[NFT] Metadata stored: ${key}`);
}

// ── Existing functions (unchanged) ───────────────────────────────────────────

export async function mintBadge(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  statement: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Badge for ${recipient}`);

  const hash = await walletClient.writeContract({
    address:      STATEMENT_ADDRESS,
    abi:          STATEMENT_ABI,
    functionName: 'mint',
    args:         [recipient, `${BASE_URL}/api/metadata/statement/pending`, 0, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  await storeMetadata('statement', tokenId, {
    name:         `Sealer Badge #${tokenId}`,
    description:  statement,
    image:        svgUrl,
    external_url: `${BASE_URL}/c/${tokenId}`,
    attributes: [
      { trait_type: 'Product',   value: 'Badge' },
      { trait_type: 'Chain',     value: 'Base' },
      { trait_type: 'Protocol',  value: 'EAS' },
      { trait_type: 'Soulbound', value: 'true' },
    ],
  });

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
    address:      STATEMENT_ADDRESS,
    abi:          STATEMENT_ABI,
    functionName: 'mint',
    args:         [recipient, `${BASE_URL}/api/metadata/statement/pending`, 1, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  await storeMetadata('statement', tokenId, {
    name:         `Sealer Card #${tokenId}`,
    description:  statement,
    image:        svgUrl,
    external_url: `${BASE_URL}/c/${tokenId}`,
    attributes: [
      { trait_type: 'Product',   value: 'Card' },
      { trait_type: 'Chain',     value: 'Base' },
      { trait_type: 'Protocol',  value: 'EAS' },
      { trait_type: 'Soulbound', value: 'true' },
    ],
  });

  console.log(`[NFT] Card minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

export async function mintSID(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  name: string,
  entityType: string,
  chain: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting SID for ${recipient}`);

  const hash = await walletClient.writeContract({
    address:      SID_ADDRESS,
    abi:          SID_ABI,
    functionName: 'mint',
    args:         [recipient, `${BASE_URL}/api/metadata/sid/pending`, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  await storeMetadata('sid', tokenId, {
    name:         `Sealer ID — ${name}`,
    description:  `${entityType} identity on ${chain}. Attested via The Sealer Protocol.`,
    image:        svgUrl,
    external_url: `${BASE_URL}/c/${tokenId}`,
    attributes: [
      { trait_type: 'Product',     value: 'SID' },
      { trait_type: 'Entity Type', value: entityType },
      { trait_type: 'Chain',       value: chain },
      { trait_type: 'Protocol',    value: 'EAS' },
      { trait_type: 'Soulbound',   value: 'true' },
    ],
  });

  console.log(`[NFT] SID minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

export async function renewSID(
  recipient: `0x${string}`,
  newSvgUrl: string,
  newAttestationTx: string,
): Promise<{ txHash: string }> {
  console.log(`[NFT] Renewing SID for ${recipient}`);

  const hash = await walletClient.writeContract({
    address:      SID_ADDRESS,
    abi:          SID_ABI,
    functionName: 'renew',
    args:         [recipient, `${BASE_URL}/api/metadata/sid/pending`, newAttestationTx],
  });

  await sendAndWait(hash);
  console.log(`[NFT] SID renewed — tx: ${hash}`);
  return { txHash: hash };
}

export async function mintSleeve(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  paymentChain: string,
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

  await storeMetadata('sleeve', tokenId, {
    name:         `Sealer Sleeve #${tokenId}`,
    description:  `Onchain content wrapper. Attested via The Sealer Protocol.`,
    image:        svgUrl,
    external_url: `${BASE_URL}/c/${tokenId}`,
    attributes: [
      { trait_type: 'Product',       value: 'Sleeve' },
      { trait_type: 'Payment Chain', value: paymentChain },
      { trait_type: 'Protocol',      value: 'EAS' },
      { trait_type: 'Soulbound',     value: 'true' },
    ],
  });

  console.log(`[NFT] Sleeve minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

export async function mintMirror(
  recipient: `0x${string}`,
  svgUrl: string,
  attestationTx: string,
  paymentChain: string,
  originalChain: string,
  originalContract: string,
  originalTokenId: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Mirror for ${recipient}`);

  const hash = await walletClient.writeContract({
    address:      MIRROR_ADDRESS,
    abi:          MIRROR_ABI,
    functionName: 'mintMirror',
    args: [{
      recipient,
      tokenURI:          `${BASE_URL}/api/metadata/mirror/pending`,
      originalChain,
      originalContract,
      originalTokenId,
      attestationTxHash: attestationTx,
      paymentChain,
    }],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  // Reverse lookup so the Alchemy webhook can find this mirror if the original NFT moves
  await redis.set(
    `mirror:source:${originalContract.toLowerCase()}:${originalTokenId}`,
    tokenId.toString(),
  );

  await storeMetadata('mirror', tokenId, {
    name:         `Sealer Mirror #${tokenId}`,
    description:  `Mirror of ${originalChain} NFT ${originalContract} #${originalTokenId}. Attested via The Sealer Protocol.`,
    image:        svgUrl,
    external_url: `${BASE_URL}/c/${tokenId}`,
    attributes: [
      { trait_type: 'Product',           value: 'Mirror' },
      { trait_type: 'Original Chain',    value: originalChain },
      { trait_type: 'Original Contract', value: originalContract },
      { trait_type: 'Original Token ID', value: originalTokenId },
      { trait_type: 'Payment Chain',     value: paymentChain },
      { trait_type: 'Protocol',          value: 'EAS' },
    ],
  });

  console.log(`[NFT] Mirror minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

export async function invalidateMirror(tokenId: bigint): Promise<string> {
  console.log(`[NFT] Invalidating Mirror ${tokenId}`);

  const hash = await walletClient.writeContract({
    address:      MIRROR_ADDRESS,
    abi:          MIRROR_ABI,
    functionName: 'invalidate',
    args:         [tokenId],
  });

  await sendAndWait(hash);
  console.log(`[NFT] Mirror invalidated — tx: ${hash}`);
  return hash;
}

// ── New functions ─────────────────────────────────────────────────────────────

/**
 * Mint a Commitment NFT.
 * Called by attest-commitment/route.ts after EAS commitment attestation.
 */
export async function mintCommitment(
  recipient: `0x${string}`,
  attestationTx: string,  // EAS commitment attestation TX
  claimType: string,
  deadline: number,       // unix seconds
  commitmentUid: string,  // EAS attestation UID — used to build permalink
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Commitment for ${recipient}`);

  const tokenUri = `${BASE_URL}/api/commitment?uid=${commitmentUid}`;

  const hash = await walletClient.writeContract({
    address:      COMMITMENT_ADDRESS,
    abi:          COMMITMENT_ABI,
    functionName: 'mint',
    args:         [recipient, tokenUri, claimType, attestationTx, BigInt(deadline)],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  await storeMetadata('commitment', tokenId, {
    name:         `Sealer Commitment #${tokenId}`,
    description:  `Onchain commitment to a verifiable goal. claimType: ${claimType}.`,
    image:        tokenUri,
    external_url: `${BASE_URL}/c/${tokenId}`,
    attributes: [
      { trait_type: 'Product',    value: 'Commitment' },
      { trait_type: 'Claim Type', value: claimType },
      { trait_type: 'Deadline',   value: deadline.toString() },
      { trait_type: 'Status',     value: 'Pending' },
      { trait_type: 'Protocol',   value: 'EAS' },
      { trait_type: 'Soulbound',  value: 'true' },
    ],
  });

  console.log(`[NFT] Commitment minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

/**
 * Mint a Certificate NFT.
 * Called by attest-achievement.ts after EAS achievement attestation.
 */
export async function mintCertificate(params: {
  recipient:      `0x${string}`;
  achievementTx:  string;   // EAS achievement attestation TX
  commitmentTx:   string;   // EAS commitment attestation TX
  achievementUid: string;   // EAS achievement attestation UID — used to build permalink
  claimType:      string;
  outcome:        0 | 1 | 2;  // 0=Failed 1=Partial 2=Full
  difficulty:     number;     // 0–100
  proofPoints:    number;
  metricsMet:     number;
  metricsTotal:   number;
  onTime:         boolean;
  daysEarly:      number;     // negative if late
  deadline:       number;     // unix seconds
}): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Certificate for ${params.recipient}`);

  const outcomeLabel = ['Failed', 'Partial', 'Full'][params.outcome];
  const tokenUri     = `${BASE_URL}/api/certificate?uid=${params.achievementUid}`;

  const hash = await walletClient.writeContract({
    address:      CERTIFICATE_ADDRESS,
    abi:          CERTIFICATE_ABI,
    functionName: 'mint',
    args: [
      params.recipient,
      tokenUri,
      params.claimType,
      params.outcome,
      params.difficulty,
      params.proofPoints,
      params.metricsMet,
      params.metricsTotal,
      params.onTime,
      params.daysEarly,
      BigInt(params.deadline),
      params.commitmentTx,
      params.achievementTx,
    ],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = extractTokenId(receipt);

  await storeMetadata('certificate', tokenId, {
    name:         `Sealer Certificate #${tokenId}`,
    description:  `${outcomeLabel} achievement — ${params.claimType}. Proof Points: ${params.proofPoints}.`,
    image:        tokenUri,
    external_url: tokenUri,
    attributes: [
      { trait_type: 'Product',       value: 'Certificate' },
      { trait_type: 'Claim Type',    value: params.claimType },
      { trait_type: 'Outcome',       value: outcomeLabel },
      { trait_type: 'Difficulty',    value: params.difficulty.toString() },
      { trait_type: 'Proof Points',  value: params.proofPoints.toString() },
      { trait_type: 'Metrics Met',   value: `${params.metricsMet}/${params.metricsTotal}` },
      { trait_type: 'On Time',       value: params.onTime.toString() },
      { trait_type: 'Days Early',    value: params.daysEarly.toString() },
      { trait_type: 'Protocol',      value: 'EAS' },
      { trait_type: 'Soulbound',     value: 'true' },
    ],
  });

  console.log(`[NFT] Certificate minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}