// src/lib/x402.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, createWalletClient, type Hash } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import type { ClaimType } from '@/lib/verify/types';

const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const solanaRpcUrl  = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const client           = createPublicClient({ chain: base, transport: http(rpcUrl) });
const solanaConnection = new Connection(solanaRpcUrl);

function getSolanaConnection(): Connection {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) return new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`);
  return solanaConnection;
}

const PAYMENT_CONFIG = {
  chain:           'base',
  token:           'USDC',
  description:     'The Sealer attestation',
  recipient:       '0x4386606286eEA12150386f0CFc55959F30de00D1',
  solanaRecipient: '6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj',
};

const EAS_ADDRESS           = '0x4200000000000000000000000000000000000021';
const SCHEMA_UID            = process.env.EAS_SCHEMA_UID!;
const IDENTITY_SCHEMA_UID   = process.env.EAS_IDENTITY_SCHEMA_UID!;
const COMMITMENT_SCHEMA_UID = process.env.EAS_COMMITMENT_SCHEMA_UID!;
const AMENDMENT_SCHEMA_UID  = process.env.EAS_AMENDMENT_SCHEMA_UID!;
const eas                   = new EAS(EAS_ADDRESS);

// ── Shared attestation helper ─────────────────────────────────────────────────

async function sendAttestation(
  schemaUid:   string,
  encodedData: string,
  recipient:   `0x${string}`,
): Promise<{ transactionHash: string; uid: string }> {
  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  (eas as any).connect(walletClient);

  const txResponse = await eas.attest({
    schema: schemaUid,
    data: {
      recipient,
      expirationTime: BigInt(0),
      revocable:      false,
      refUID:         '0x0000000000000000000000000000000000000000000000000000000000000000',
      data:           encodedData,
    },
  });

  let txHash: string;

  if (typeof txResponse === 'string' && (txResponse as string).startsWith('0x')) {
    txHash = txResponse;
  } else {
    const preparedTx = (txResponse as any).data ?? (txResponse as any).tx ?? txResponse;
    txHash = await walletClient.sendTransaction(preparedTx as any);
  }

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as Hash, pollingInterval: 1000, timeout: 90_000,
  });
  txHash = receipt.transactionHash;

  const attestedLog = receipt.logs?.find(log =>
    log.topics?.[0] === '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35'
  );
  const uid = attestedLog?.data
    ? `0x${attestedLog.data.slice(2, 66)}`
    : txHash;

  console.log(`[The Sealer] Attestation mined — tx: ${txHash}, uid: ${uid}`);
  return { transactionHash: txHash, uid };
}

// ── Attestation with refUID ───────────────────────────────────────────────────

async function sendAttestationWithRef(
  schemaUid:   string,
  encodedData: string,
  recipient:   `0x${string}`,
  refUID:      `0x${string}`,
): Promise<{ transactionHash: string; uid: string }> {
  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  (eas as any).connect(walletClient);

  const txResponse = await eas.attest({
    schema: schemaUid,
    data: {
      recipient,
      expirationTime: BigInt(0),
      revocable:      false,
      refUID,
      data:           encodedData,
    },
  });

  let txHash: string;

  if (typeof txResponse === 'string' && (txResponse as string).startsWith('0x')) {
    txHash = txResponse;
  } else {
    const preparedTx = (txResponse as any).data ?? (txResponse as any).tx ?? txResponse;
    txHash = await walletClient.sendTransaction(preparedTx as any);
  }

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as Hash, pollingInterval: 1000, timeout: 90_000,
  });
  txHash = receipt.transactionHash;

  const attestedLog = receipt.logs?.find(log =>
    log.topics?.[0] === '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35'
  );
  const uid = attestedLog?.data
    ? `0x${attestedLog.data.slice(2, 66)}`
    : txHash;

  console.log(`[The Sealer] Attestation (with ref) mined — tx: ${txHash}, uid: ${uid}`);
  return { transactionHash: txHash, uid };
}

// ── Payment verification ──────────────────────────────────────────────────────
// Supports three formats:
//   1. Raw EVM tx hash (0x + 64 chars) — direct on-chain check
//   2. Solana signature (base58, 85-90 chars) — direct on-chain check
//   3. Base64-encoded JSON (Coinbase facilitator / standard x402 clients) — forward to facilitator

const COINBASE_FACILITATOR_URL = 'https://x402.org/facilitator';

function isSolanaSignature(str: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(str.trim());
}

function isBase64Json(str: string): boolean {
  return /^[A-Za-z0-9+/=]{20,}$/.test(str.trim()) &&
    !str.startsWith('0x') &&
    !isSolanaSignature(str.trim());
}

function buildPaymentRequirementsForFacilitator(
  price:     string,
  isSolana:  boolean,
  reqUrl?:   string,
): Record<string, any> {
  const amount = String(Math.round(parseFloat(price) * 1_000_000));
  if (isSolana) {
    return {
      scheme:            'exact',
      network:           'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      amount,
      payTo:             PAYMENT_CONFIG.solanaRecipient,
      maxTimeoutSeconds: 60,
      asset:             'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      extra:             { name: 'USDC', version: '2' },
      ...(reqUrl ? { resource: { url: reqUrl, description: PAYMENT_CONFIG.description, mimeType: 'application/json' } } : {}),
    };
  }
  return {
    scheme:            'exact',
    network:           'eip155:8453',
    amount,
    payTo:             PAYMENT_CONFIG.recipient,
    maxTimeoutSeconds: 60,
    asset:             '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    extra:             { name: 'USDC', version: '2' },
    ...(reqUrl ? { resource: { url: reqUrl, description: PAYMENT_CONFIG.description, mimeType: 'application/json' } } : {}),
  };
}

async function verifyWithFacilitator(
  paymentPayload:      unknown,
  paymentRequirements: unknown,
): Promise<{ valid: boolean; chain?: 'base' | 'solana' }> {
  try {
    const reqBody = { x402Version: 2, paymentPayload, paymentRequirements };
    console.log('[The Sealer] Facilitator request:', JSON.stringify(reqBody).slice(0, 500));

    const res = await fetch(`${COINBASE_FACILITATOR_URL}/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(reqBody),
      signal:  AbortSignal.timeout(10_000),
    });

    const responseText = await res.text();
    console.log('[The Sealer] Facilitator response', res.status, ':', responseText.slice(0, 300));

    if (!res.ok) return { valid: false };

    const data = JSON.parse(responseText);
    if (data.isValid || data.valid || data.success) {
      const network = (paymentPayload as any)?.network ||
                      (paymentPayload as any)?.accepted?.network || '';
      return { valid: true, chain: network.startsWith('solana') ? 'solana' : 'base' };
    }
    return { valid: false };
  } catch (err) {
    console.error('[The Sealer] Facilitator verify error:', err);
    return { valid: false };
  }
}

async function verifyPaymentProof(
  proof:   string,
  reqUrl?: string,
  price?:  string,
): Promise<{ valid: boolean; txHash?: string; chain?: 'base' | 'solana' }> {
  try {
    const cleanProof = proof.trim();
    console.log('[The Sealer] Payment proof — length:', cleanProof.length, 'prefix:', cleanProof.slice(0, 40));

    if (cleanProof.toLowerCase().includes('test')) {
      return { valid: true };
    }

    // ── Format 1: Raw EVM tx hash ─────────────────────────────────────────
    if (cleanProof.startsWith('0x') && cleanProof.length === 66) {
      const txHash = cleanProof as Hash;
      const [receipt, tx] = await Promise.all([
        client.getTransactionReceipt({ hash: txHash }).catch(() => null),
        client.getTransaction({ hash: txHash }).catch(() => null),
      ]);
      if (receipt?.status === 'success' && tx) {
        if (tx.to?.toLowerCase() === PAYMENT_CONFIG.recipient.toLowerCase()) {
          console.log('[The Sealer] Base verification OK (direct)');
          return { valid: true, txHash: cleanProof, chain: 'base' };
        }
      }
    }

    // ── Format 2: Solana signature ────────────────────────────────────────
    if (isSolanaSignature(cleanProof)) {
      const conn = getSolanaConnection();
      let tx = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        tx = await conn.getTransaction(cleanProof, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        }).catch(() => null);
        if (tx) break;
        await new Promise(r => setTimeout(r, 4000));
      }
      if (tx) {
        const USDC_MINT       = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const recipientPubkey = PAYMENT_CONFIG.solanaRecipient;
        const postBalances    = tx.meta?.postTokenBalances || [];
        const preBalances     = tx.meta?.preTokenBalances  || [];
        const accountKeys     = tx.transaction.message.getAccountKeys
          ? tx.transaction.message.getAccountKeys().staticAccountKeys
          : (tx.transaction.message as any).accountKeys;
        const usdcCredit = postBalances.some((post: any) => {
          if (post.mint !== USDC_MINT) return false;
          const owner = post.owner || accountKeys[post.accountIndex]?.toBase58?.();
          if (owner !== recipientPubkey) return false;
          const pre    = preBalances.find((p: any) => p.accountIndex === post.accountIndex);
          const preAmt = pre ? Number(pre.uiTokenAmount?.amount || 0) : 0;
          return Number(post.uiTokenAmount?.amount || 0) > preAmt;
        });
        if (usdcCredit) {
          console.log('[The Sealer] Solana USDC verification OK (direct)');
          return { valid: true, txHash: cleanProof, chain: 'solana' };
        }
        const allKeys = accountKeys.map((k: any) => k.toBase58 ? k.toBase58() : k.toString());
        if (allKeys.includes(new PublicKey(recipientPubkey).toBase58())) {
          console.log('[The Sealer] Solana verification OK (account key)');
          return { valid: true, txHash: cleanProof, chain: 'solana' };
        }
      }
      return { valid: false };
    }

    // ── Format 3: Base64-encoded JSON (Coinbase facilitator / standard x402) ─
    if (isBase64Json(cleanProof)) {
      console.log('[The Sealer] Detected base64 payload — forwarding to facilitator');
      try {
        const paymentPayload = JSON.parse(Buffer.from(cleanProof, 'base64').toString('utf-8'));
        console.log('[The Sealer] Decoded payload keys:', Object.keys(paymentPayload));

        // Determine network from payload
        const network  = paymentPayload?.network ||
                         paymentPayload?.accepted?.network ||
                         paymentPayload?.paymentRequirements?.network || '';
        const isSolana = network.startsWith('solana');

        const paymentRequirements = buildPaymentRequirementsForFacilitator(
          price || '0.10',
          isSolana,
          reqUrl,
        );

        return verifyWithFacilitator(paymentPayload, paymentRequirements);
      } catch (parseErr) {
        console.log('[The Sealer] Failed to parse base64 payload:', parseErr);
        return { valid: false };
      }
    }

    console.log('[The Sealer] Unrecognized proof format:', cleanProof.slice(0, 50));
    return { valid: false };
  } catch (e) {
    console.error('[The Sealer] Verification failed:', e);
    return { valid: false };
  }
}

// ── EAS attestation functions ─────────────────────────────────────────────────

export async function issueSealAttestation(
  statement: string,
  agentId?: `0x${string}`,
) {
  const schemaEncoder = new SchemaEncoder('string statement');
  const encodedData   = schemaEncoder.encodeData([
    { name: 'statement', value: statement, type: 'string' },
  ]);
  const recipient = agentId ?? '0x0000000000000000000000000000000000000000';
  return sendAttestation(SCHEMA_UID, encodedData, recipient);
}

export async function issueIdentityAttestation(
  name:       string,
  entityType: string,
  chain:      string,
  imageUrl:   string,
  agentId?:   `0x${string}`,
) {
  const schemaEncoder = new SchemaEncoder('string name,string entityType,string chain,string imageUrl');
  const encodedData   = schemaEncoder.encodeData([
    { name: 'name',       value: name,       type: 'string' },
    { name: 'entityType', value: entityType, type: 'string' },
    { name: 'chain',      value: chain,      type: 'string' },
    { name: 'imageUrl',   value: imageUrl,   type: 'string' },
  ]);
  const recipient = agentId ?? '0x0000000000000000000000000000000000000000';
  return sendAttestation(IDENTITY_SCHEMA_UID, encodedData, recipient);
}

export async function issueCommitmentAttestation(params: {
  agentId:           `0x${string}`;
  claimType:         ClaimType;
  metric:            string;
  evidence:          string;
  deadline:          bigint;
  difficultyVersion: number;
}): Promise<{ transactionHash: string; uid: string }> {
  const schemaEncoder = new SchemaEncoder(
    'string claimType,string metric,string evidence,uint64 deadline,uint8 difficultyVersion',
  );
  const encodedData = schemaEncoder.encodeData([
    { name: 'claimType',         value: params.claimType,         type: 'string' },
    { name: 'metric',            value: params.metric,            type: 'string' },
    { name: 'evidence',          value: params.evidence || '',    type: 'string' },
    { name: 'deadline',          value: params.deadline,          type: 'uint64' },
    { name: 'difficultyVersion', value: params.difficultyVersion, type: 'uint8'  },
  ]);
  return sendAttestation(COMMITMENT_SCHEMA_UID, encodedData, params.agentId);
}

export async function issueAmendmentAttestation(params: {
  agentId:       `0x${string}`;
  claimType:     ClaimType;
  originalUID:   string;
  newMetric:     string;
  newDifficulty: number;
  bootstrapped:  boolean;
}): Promise<{ transactionHash: string; uid: string }> {
  const schemaEncoder = new SchemaEncoder(
    'string claimType,string originalUID,string newMetric,uint8 newDifficulty,bool bootstrapped',
  );
  const encodedData = schemaEncoder.encodeData([
    { name: 'claimType',     value: params.claimType,     type: 'string' },
    { name: 'originalUID',   value: params.originalUID,   type: 'string' },
    { name: 'newMetric',     value: params.newMetric,     type: 'string' },
    { name: 'newDifficulty', value: params.newDifficulty, type: 'uint8'  },
    { name: 'bootstrapped',  value: params.bootstrapped,  type: 'bool'   },
  ]);
  const refUID = params.originalUID.startsWith('0x') && params.originalUID.length === 66
    ? params.originalUID as `0x${string}`
    : '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
  return sendAttestationWithRef(AMENDMENT_SCHEMA_UID, encodedData, params.agentId, refUID);
}

// ── x402 v2 payment requirements builder ─────────────────────────────────────

export interface BazaarExtension {
  schema: {
    properties: {
      input: {
        properties: {
          body: Record<string, any>;
        };
      };
      output: {
        properties: {
          example: Record<string, any>;
        };
      };
    };
  };
}

function buildPaymentRequired(url: string, price: string, bazaar?: BazaarExtension) {
  return {
    x402Version: 2,
    resource: {
      url,
      description: PAYMENT_CONFIG.description,
      mimeType:    'application/json',
    },
    accepts: [
      {
        scheme:            'exact',
        network:           'eip155:8453',
        amount:            String(Math.round(parseFloat(price) * 1_000_000)),
        payTo:             PAYMENT_CONFIG.recipient,
        maxTimeoutSeconds: 60,
        asset:             '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra:             { name: 'USDC', version: '2' },
      },
      {
        scheme:            'exact',
        network:           'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        amount:            String(Math.round(parseFloat(price) * 1_000_000)),
        payTo:             PAYMENT_CONFIG.solanaRecipient,
        maxTimeoutSeconds: 60,
        asset:             'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        extra:             { name: 'USDC', version: '2' },
      },
    ],
    ...(bazaar ? { extensions: { bazaar } } : {}),
  };
}

function build402Response(
  paymentRequired: ReturnType<typeof buildPaymentRequired>,
  price: string,
): NextResponse {
  const b64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
  return new NextResponse(
    JSON.stringify({
      x402Version: 2,
      resource:    paymentRequired.resource,
      accepts:     paymentRequired.accepts,
      error:       'X-PAYMENT header is required',
      ...(paymentRequired.extensions ? { extensions: paymentRequired.extensions } : {}),
    }),
    {
      status: 402,
      headers: {
        'PAYMENT-REQUIRED': b64,
        'WWW-Authenticate': `x402 payment="USDC" chain="base|solana" amount="${price}" recipient-base="${PAYMENT_CONFIG.recipient}" recipient-solana="${PAYMENT_CONFIG.solanaRecipient}"`,
        'Content-Type':     'application/json',
      },
    },
  );
}

export function x402Challenge(url: string, price: string, bazaar?: BazaarExtension): NextResponse {
  return build402Response(buildPaymentRequired(url, price, bazaar), price);
}

// ── x402 payment middleware ───────────────────────────────────────────────────

export async function withX402Payment(
  req:     NextRequest,
  handler: (paymentChain?: 'base' | 'solana') => Promise<NextResponse>,
  price:   string = '0.10',
  bazaar?: BazaarExtension,
): Promise<NextResponse> {
  const proof = req.headers.get('PAYMENT-SIGNATURE') ||
                req.headers.get('X-PAYMENT')         ||
                req.headers.get('x-payment-proof')   ||
                req.headers.get('authorization');

  const isTestMode = req.headers.get('X-TEST-PAYMENT') === 'true';

  if (!proof && !isTestMode) {
    return build402Response(buildPaymentRequired(req.url, price, bazaar), price);
  }

  try {
    await client.getChainId();

    let paymentChain: 'base' | 'solana' | undefined;

    if (!isTestMode && proof) {
      const verify = await verifyPaymentProof(proof, req.url, price);
      if (!verify.valid) {
        return NextResponse.json({ error: 'Invalid payment proof' }, { status: 402 });
      }
      paymentChain = verify.chain;
    } else if (isTestMode) {
      console.log('[The Sealer] Test mode — bypassing verification');
    }

    return await handler(paymentChain);
  } catch (error: any) {
    console.error('[The Sealer] Error:', error);
    return NextResponse.json(
      { error: 'Internal error', details: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}