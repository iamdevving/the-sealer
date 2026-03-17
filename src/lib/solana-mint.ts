// src/lib/solana-mint.ts
// Metaplex Core + Umi — soulbound NFT minting on Solana
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey as umiPublicKey,
} from '@metaplex-foundation/umi';
import {
  create,
  fetchAsset,
  ruleSet,
} from '@metaplex-foundation/mpl-core';

// Use Helius for minting — supports signatureSubscribe unlike Alchemy
function getMintRpc(): string {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  return process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

export interface SolanaMintParams {
  recipientAddress: string;
  name:             string;
  uri:              string;
  mirrorTokenId:    string;
}

export interface SolanaMintResult {
  mintAddress: string;
  txSignature: string;
}

function getOperatorKeypair(): Uint8Array {
  const OPERATOR_KEY = process.env.SOLANA_OPERATOR_PRIVATE_KEY || '';
  if (!OPERATOR_KEY) throw new Error('SOLANA_OPERATOR_PRIVATE_KEY not set');

  const raw = OPERATOR_KEY.trim();

  // Try base64 — take last 64 bytes if longer
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 64) return new Uint8Array(buf);
    if (buf.length > 64)   return new Uint8Array(buf.slice(buf.length - 64));
  } catch {}

  // Try bs58
  try {
    const bs58mod = require('bs58');
    const bs58    = bs58mod.default ?? bs58mod;
    const buf     = Buffer.from(bs58.decode(raw));
    if (buf.length === 64) return new Uint8Array(buf);
    if (buf.length > 64)   return new Uint8Array(buf.slice(buf.length - 64));
  } catch {}

  // Try JSON byte array
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === 64) return new Uint8Array(arr);
  } catch {}

  // Try hex
  try {
    if (raw.length === 128) {
      const buf = Buffer.from(raw, 'hex');
      if (buf.length === 64) return new Uint8Array(buf);
    }
  } catch {}

  throw new Error(`Invalid Solana operator key — could not decode. Got ${raw.length} chars, base64 gives ${Buffer.from(raw, 'base64').length} bytes.`);
}

export async function mintSolanaMirror(params: SolanaMintParams): Promise<SolanaMintResult> {
  const { recipientAddress, name, uri } = params;

  const umi = createUmi(getMintRpc());

  const secretKey = getOperatorKeypair();
  const keypair   = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secretKey));
  const operator  = createSignerFromKeypair(umi, keypair);
  umi.use(keypairIdentity(operator));

  const asset     = generateSigner(umi);
  const recipient = umiPublicKey(recipientAddress);

  const tx = await create(umi, {
    asset,
    name,
    uri,
    owner: recipient,
    plugins: [
      {
        type: 'PermanentFreezeDelegate',
        frozen: true,  // soulbound — non-transferable on Solana
        authority: { type: 'UpdateAuthority' },
      },
      {
        type: 'Royalties',
        basisPoints: 0,
        creators: [{ address: operator.publicKey, percentage: 100 }],
        ruleSet: ruleSet('None'),
      },
    ],
  }).sendAndConfirm(umi);

  const signature = Buffer.from(tx.signature).toString('base64');

  return {
    mintAddress: asset.publicKey.toString(),
    txSignature: signature,
  };
}

export async function verifySolanaMintOwnership(
  mintAddress: string,
  walletAddress: string
): Promise<boolean> {
  try {
    const umi   = createUmi(getMintRpc());
    const asset = await fetchAsset(umi, umiPublicKey(mintAddress));
    return asset.owner.toString() === walletAddress;
  } catch { return false; }
}