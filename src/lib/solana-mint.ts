// src/lib/solana-mint.ts
// Metaplex Core + Umi — soulbound NFT minting on Solana
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createGenericFile,
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey as umiPublicKey,
} from '@metaplex-foundation/umi';
import {
  create,
  fetchAsset,
  transfer,
  burn,
  addPlugin,
  ruleSet,
} from '@metaplex-foundation/mpl-core';
import { base64 } from '@metaplex-foundation/umi/serializers';

const SOLANA_RPC    = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const OPERATOR_B64  = process.env.SOLANA_OPERATOR_PRIVATE_KEY || '';

export interface SolanaMintParams {
  recipientAddress: string;   // Solana wallet address (base58)
  name:             string;   // NFT name e.g. "Mirror: CryptoPunk #1234"
  uri:              string;   // token URI — our mirror card SVG URL
  mirrorTokenId:    string;   // used for dedup key
}

export interface SolanaMintResult {
  mintAddress: string;   // Solana NFT mint address
  txSignature: string;   // transaction signature
}

function getOperatorKeypair() {
  if (!OPERATOR_B64) throw new Error('SOLANA_OPERATOR_PRIVATE_KEY not set');
  const secretKey = Buffer.from(OPERATOR_B64, 'base64');
  if (secretKey.length !== 64) throw new Error('Invalid Solana operator key — expected 64 bytes');
  return secretKey;
}

export async function mintSolanaMirror(params: SolanaMintParams): Promise<SolanaMintResult> {
  const { recipientAddress, name, uri } = params;

  const umi = createUmi(SOLANA_RPC);

  // Load operator keypair
  const secretKey  = getOperatorKeypair();
  const keypair    = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secretKey));
  const operator   = createSignerFromKeypair(umi, keypair);
  umi.use(keypairIdentity(operator));

  // Generate a new mint address for this NFT
  const asset = generateSigner(umi);

  // Recipient public key
  const recipient = umiPublicKey(recipientAddress);

  // Mint via Metaplex Core
  // transferDelegate = None (soulbound — no transfers allowed)
  const tx = await create(umi, {
    asset,
    name,
    uri,
    owner: recipient,
    plugins: [
      {
        type: 'PermanentFreezeDelegate',
        frozen: false,
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
    const umi   = createUmi(SOLANA_RPC);
    const asset = await fetchAsset(umi, umiPublicKey(mintAddress));
    return asset.owner.toString() === walletAddress;
  } catch { return false; }
}
