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

const PAYMENT_CONFIG = {
  chain:           'base',
  token:           'USDC',
  description:     'The Sealer attestation',
  recipient:       '0x4386606286eEA12150386f0CFc55959F30de00D1',
  solanaRecipient: '6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj',
};

const EAS_ADDRESS             = '0x4200000000000000000000000000000000000021';
const SCHEMA_UID              = process.env.EAS_SCHEMA_UID!;
const IDENTITY_SCHEMA_UID     = process.env.EAS_IDENTITY_SCHEMA_UID!;
const COMMITMENT_SCHEMA_UID   = process.env.EAS_COMMITMENT_SCHEMA_UID!;
const eas                     = new EAS(EAS_ADDRESS);

// ── Shared attestation helper ─────────────────────────────────────────────────
// Returns { transactionHash, uid } — uid is the EAS attestation UID
async function sendAttestation(
  schemaUid:    string,
  encodedData:  string,
  recipient:    `0x${string}`,
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

  // EAS SDK v2 returns the UID directly; v1 returns a tx object
  let uid: string;
  let txHash: string;

  if (typeof txResponse === 'object' && 'wait' in txResponse) {
    // SDK v2 — wait() resolves to the UID
    uid    = await (txResponse as any).wait();
    txHash = (txResponse as any).tx?.hash ?? '';
  } else {
    // SDK v1-style — send raw tx
    const preparedTx = (txResponse as any).data || txResponse;
    txHash           = await walletClient.sendTransaction(preparedTx as any);
    const receipt    = await client.waitForTransactionReceipt({
      hash: txHash as Hash, pollingInterval: 1000, timeout: 90000,
    });
    txHash = receipt.transactionHash;
    uid    = txHash; // fallback — real UID requires log parsing
  }

  console.log(`[The Sealer] ✅ Attestation mined — tx: ${txHash}, uid: ${uid}`);
  return { transactionHash: txHash, uid };
}

// ── Payment verification ──────────────────────────────────────────────────────

function isSolanaSignature(str: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(str.trim());
}

async function verifyPaymentProof(
  proof: string,
): Promise<{ valid: boolean; txHash?: string; chain?: 'base' | 'solana' }> {
  try {
    const cleanProof = proof.trim();

    if (cleanProof.toLowerCase().includes('test')) {
      console.log('[The Sealer] 🧪 Test mode — bypassing verification');
      return { valid: true };
    }

    // ── Base EVM tx hash ──────────────────────────────────────────────────
    if (cleanProof.startsWith('0x') && cleanProof.length === 66) {
      const txHash = cleanProof as Hash;
      const [receipt, tx] = await Promise.all([
        client.getTransactionReceipt({ hash: txHash }).catch(() => null),
        client.getTransaction({ hash: txHash }).catch(() => null),
      ]);

      if (receipt?.status === 'success' && tx) {
        const isCorrectRecipient = tx.to?.toLowerCase() === PAYMENT_CONFIG.recipient.toLowerCase();
        if (isCorrectRecipient) {
          console.log('[The Sealer] ✅ Base verification OK');
          return { valid: true, txHash: cleanProof, chain: 'base' };
        }
        console.log('[The Sealer] ❌ Base TX recipient mismatch');
        return { valid: false };
      }
    }

    // ── Solana tx signature ───────────────────────────────────────────────
    if (isSolanaSignature(cleanProof)) {
      const tx = await solanaConnection.getTransaction(cleanProof, {
        maxSupportedTransactionVersion: 0,
      }).catch(() => null);

      if (tx) {
        const recipientKey = new PublicKey(PAYMENT_CONFIG.solanaRecipient);
        const accountKeys  = tx.transaction.message.getAccountKeys
          ? tx.transaction.message.getAccountKeys().staticAccountKeys
          : (tx.transaction.message as any).accountKeys;

        const recipientFound = accountKeys.some(
          (key: PublicKey) => key.toBase58() === recipientKey.toBase58(),
        );

        if (recipientFound) {
          console.log('[The Sealer] ✅ Solana verification OK — recipient confirmed');
          return { valid: true, txHash: cleanProof, chain: 'solana' };
        }
        console.log('[The Sealer] ❌ Solana TX recipient mismatch');
        return { valid: false };
      }
    }

    console.log('[The Sealer] ❌ Unrecognized proof format — rejecting');
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
  console.log(`[The Sealer] Issuing statement attestation: "${statement}"`);

  const schemaEncoder = new SchemaEncoder('string statement');
  const encodedData   = schemaEncoder.encodeData([
    { name: 'statement', value: statement, type: 'string' },
  ]);

  // recipient = agent wallet (the entity being attested), not payment wallet
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
  console.log(`[The Sealer] Issuing identity attestation for: "${name}"`);

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
  deadline:          bigint;         // unix timestamp
  difficultyVersion: number;
}): Promise<{ transactionHash: string; uid: string }> {
  console.log(`[The Sealer] Issuing commitment attestation — claimType: ${params.claimType}`);

  // Schema: string claimType,string metric,string evidence,uint64 deadline,uint8 difficultyVersion
  const schemaEncoder = new SchemaEncoder(
    'string claimType,string metric,string evidence,uint64 deadline,uint8 difficultyVersion',
  );
  const encodedData = schemaEncoder.encodeData([
    { name: 'claimType',         value: params.claimType,                      type: 'string' },
    { name: 'metric',            value: params.metric,                          type: 'string' },
    { name: 'evidence',          value: params.evidence || '',                  type: 'string' },
    { name: 'deadline',          value: params.deadline,                        type: 'uint64' },
    { name: 'difficultyVersion', value: params.difficultyVersion,               type: 'uint8'  },
  ]);

  // recipient = the agent making the commitment
  return sendAttestation(COMMITMENT_SCHEMA_UID, encodedData, params.agentId);
}

// ── x402 payment middleware ───────────────────────────────────────────────────

export async function withX402Payment(
  req:     NextRequest,
  handler: (paymentChain?: 'base' | 'solana') => Promise<NextResponse>,
  price:   string = '0.10',
): Promise<NextResponse> {
  const proof = req.headers.get('PAYMENT-SIGNATURE') ||
                req.headers.get('X-PAYMENT')         ||
                req.headers.get('x-payment-proof')   ||
                req.headers.get('authorization');

  const isTestMode = req.headers.get('X-TEST-PAYMENT') === 'true';

  if (!proof && !isTestMode) {
    return new NextResponse(
      JSON.stringify({
        error:       'Payment required',
        amount:      price,
        currency:    'USDC',
        description: PAYMENT_CONFIG.description,
        paymentOptions: [
          { chain: 'base',   token: 'USDC', recipient: PAYMENT_CONFIG.recipient,       amount: price },
          { chain: 'solana', token: 'USDC', recipient: PAYMENT_CONFIG.solanaRecipient, amount: price },
        ],
        x402: { version: 1, schemes: ['exact'], network: ['base', 'solana'] },
      }),
      {
        status:  402,
        headers: {
          'WWW-Authenticate': `x402 payment="USDC" chain="base|solana" amount="${price}" recipient-base="${PAYMENT_CONFIG.recipient}" recipient-solana="${PAYMENT_CONFIG.solanaRecipient}"`,
          'Content-Type':     'application/json',
        },
      },
    );
  }

  try {
    await client.getChainId();

    let paymentChain: 'base' | 'solana' | undefined;

    if (!isTestMode && proof) {
      const verify = await verifyPaymentProof(proof);
      if (!verify.valid) {
        return new NextResponse('Invalid payment proof', { status: 402 });
      }
      paymentChain = verify.chain;
    } else if (isTestMode) {
      console.log('[The Sealer] 🧪 Test mode — bypassing verification');
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