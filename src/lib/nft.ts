// src/lib/nft.ts
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rpcUrl      = process.env.ALCHEMY_RPC_URL!;
const rawKey      = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey  = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;

const account     = privateKeyToAccount(privateKey as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

// Contract addresses
const STATEMENT_ADDRESS = process.env.STATEMENT_CONTRACT_ADDRESS as `0x${string}`;
const SID_ADDRESS       = process.env.SEALER_ID_CONTRACT_ADDRESS as `0x${string}`;
const SEALED_ADDRESS    = process.env.SEALED_CONTRACT_ADDRESS as `0x${string}`;

// ABIs — minimal, only what we need
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

/**
 * Mint a Badge NFT (productType = 0)
 */
export async function mintBadge(
  recipient: `0x${string}`,
  tokenURI: string,
  attestationTx: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Badge for ${recipient}`);

  const hash = await walletClient.writeContract({
    address: STATEMENT_ADDRESS,
    abi: STATEMENT_ABI,
    functionName: 'mint',
    args: [recipient, tokenURI, 0, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  // Token ID is in the logs — parse Transfer event (topic[3] is tokenId)
  const tokenId = BigInt(receipt.logs[0]?.topics[3] ?? '0x0');
  console.log(`[NFT] Badge minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

/**
 * Mint a Card NFT (productType = 1)
 */
export async function mintCard(
  recipient: `0x${string}`,
  tokenURI: string,
  attestationTx: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting Card for ${recipient}`);

  const hash = await walletClient.writeContract({
    address: STATEMENT_ADDRESS,
    abi: STATEMENT_ABI,
    functionName: 'mint',
    args: [recipient, tokenURI, 1, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = BigInt(receipt.logs[0]?.topics[3] ?? '0x0');
  console.log(`[NFT] Card minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}

/**
 * Mint or renew a Sealer ID NFT.
 * If wallet already has a SID, renews it (updates tokenURI + attestation in place).
 */
export async function mintOrRenewSealerID(
  recipient: `0x${string}`,
  tokenURI: string,
  attestationTx: string,
): Promise<{ tokenId: bigint | null; txHash: string; renewed: boolean }> {
  // Check if wallet already has a SID
  const hasSID = await publicClient.readContract({
    address: SID_ADDRESS,
    abi: SID_ABI,
    functionName: 'hasSID',
    args: [recipient],
  });

  if (hasSID) {
    console.log(`[NFT] Renewing SealerID for ${recipient}`);
    const hash = await walletClient.writeContract({
      address: SID_ADDRESS,
      abi: SID_ABI,
      functionName: 'renew',
      args: [recipient, tokenURI, attestationTx],
    });
    await sendAndWait(hash);
    console.log(`[NFT] SealerID renewed — tx: ${hash}`);
    return { tokenId: null, txHash: hash, renewed: true };
  }

  console.log(`[NFT] Minting SealerID for ${recipient}`);
  const hash = await walletClient.writeContract({
    address: SID_ADDRESS,
    abi: SID_ABI,
    functionName: 'mint',
    args: [recipient, tokenURI, attestationTx],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = BigInt(receipt.logs[0]?.topics[3] ?? '0x0');
  console.log(`[NFT] SealerID minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash, renewed: false };
}

/**
 * Mint a SEALed NFT (transferable)
 */
export async function mintSealed(
  recipient: `0x${string}`,
  tokenURI: string,
  attestationTx: string,
  paymentChain: string,
): Promise<{ tokenId: bigint; txHash: string }> {
  console.log(`[NFT] Minting SEALed for ${recipient}`);

  const hash = await walletClient.writeContract({
    address: SEALED_ADDRESS,
    abi: SEALED_ABI,
    functionName: 'mint',
    args: [recipient, tokenURI, attestationTx, paymentChain],
  });

  const receipt = await sendAndWait(hash);
  const tokenId = BigInt(receipt.logs[0]?.topics[3] ?? '0x0');
  console.log(`[NFT] SEALed minted — tokenId: ${tokenId}, tx: ${hash}`);
  return { tokenId, txHash: hash };
}
