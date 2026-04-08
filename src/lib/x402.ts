// src/lib/x402.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, createWalletClient, type Hash, verifyTypedData } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import type { ClaimType } from '@/lib/verify/types';

const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const solanaRpcUrl  = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

// ── SECURITY: X-TEST-PAYMENT is only allowed in non-production environments ──
// In production, this header is ALWAYS rejected regardless of value.
function isTestPaymentAllowed(req: NextRequest): boolean {
  const isProduction = process.env.NODE_ENV === 'production' ||
                       process.env.VERCEL_ENV === 'production';
  if (isProduction) return false;
  // Only allow in dev/preview with explicit env opt-in
  return process.env.ALLOW_TEST_PAYMENT === 'true';
}

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

// USDC on Base — EIP-3009 domain
const USDC_BASE = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  name:    'USD Coin',  // ← was 'USDC'
  version: '2',
  chainId: 8453,
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
  const uid = attestedLog?.data ? `0x${attestedLog.data.slice(2, 66)}` : txHash;
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
  const uid = attestedLog?.data ? `0x${attestedLog.data.slice(2, 66)}` : txHash;
  console.log(`[The Sealer] Attestation (with ref) mined — tx: ${txHash}, uid: ${uid}`);
  return { transactionHash: txHash, uid };
}

// ── Payment verification ──────────────────────────────────────────────────────
// Supports three formats:
//   1. Raw EVM tx hash (0x + 64 chars) — direct on-chain check
//   2. Solana signature (base58, 85-90 chars) — direct on-chain check
//   3. Base64-encoded JSON (standard x402 clients) — local EIP-3009 verification

function isSolanaSignature(str: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(str.trim());
}

function isBase64Json(str: string): boolean {
  return /^[A-Za-z0-9+/=]{20,}$/.test(str.trim()) &&
    !str.startsWith('0x') &&
    !isSolanaSignature(str.trim());
}

// ── Local EIP-3009 TransferWithAuthorization verification ─────────────────────
// Verifies the EIP-712 signature directly using viem — no external facilitator needed.

async function verifyEIP3009Authorization(
  paymentPayload:       any,
  expectedAmountAtomic: bigint,
): Promise<{ valid: boolean; payer?: string }> {
  try {
    const auth      = paymentPayload?.payload?.authorization;
    const signature = paymentPayload?.payload?.signature;

    if (!auth || !signature) {
      console.log('[The Sealer] EIP-3009: missing authorization or signature');
      return { valid: false };
    }

    const { from, to, value, validAfter, validBefore, nonce } = auth;
    console.log('[The Sealer] EIP-3009 auth:', JSON.stringify({ from, to, value, validAfter, validBefore, nonce }));
    console.log('[The Sealer] EIP-3009 sig prefix:', (signature as string)?.slice(0, 20));

    // Check recipient
    if (to?.toLowerCase() !== PAYMENT_CONFIG.recipient.toLowerCase()) {
      console.log('[The Sealer] EIP-3009: wrong recipient', to);
      return { valid: false };
    }

    // Check amount — must be >= expected
    if (BigInt(value) < expectedAmountAtomic) {
      console.log('[The Sealer] EIP-3009: insufficient amount', value, '< expected', expectedAmountAtomic.toString());
      return { valid: false };
    }

    // Check time window
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < BigInt(validAfter)) {
      console.log('[The Sealer] EIP-3009: not yet valid');
      return { valid: false };
    }
    if (now > BigInt(validBefore)) {
      console.log('[The Sealer] EIP-3009: expired — validBefore:', validBefore, 'now:', now.toString());
      return { valid: false };
    }

    // Pad nonce to 32 bytes — agent sends short hex like "0xce1b"
    // but EIP-712 type is bytes32 requiring full 64 hex chars
    const paddedNonce = ('0x' + (nonce as string).replace('0x', '').padStart(64, '0')) as `0x${string}`;
    console.log('[The Sealer] EIP-3009: padded nonce:', paddedNonce.slice(0, 20));

    const domain = {
      name:              USDC_BASE.name,
      version:           USDC_BASE.version,
      chainId:           USDC_BASE.chainId,
      verifyingContract: USDC_BASE.address,
    };

    const types = {
      TransferWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32' },
      ],
    };

    const message = {
      from:        from as `0x${string}`,
      to:          to   as `0x${string}`,
      value:       BigInt(value),
      validAfter:  BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce:       paddedNonce,
    };

    const isValid = await verifyTypedData({
      address:     from      as `0x${string}`,
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
      signature:   signature as `0x${string}`,
    });

    if (isValid) {
      console.log('[The Sealer] EIP-3009 verification OK — payer:', from);
      return { valid: true, payer: from };
    }

    console.log('[The Sealer] EIP-3009: signature invalid after padding — trying unpadded nonce');

    // Fallback: try with nonce as-is (in case it's already full bytes32)
    const isValidRaw = await verifyTypedData({
      address:     from      as `0x${string}`,
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message:     { ...message, nonce: nonce as `0x${string}` },
      signature:   signature as `0x${string}`,
    });

    if (isValidRaw) {
      console.log('[The Sealer] EIP-3009 verification OK (raw nonce) — payer:', from);
      return { valid: true, payer: from };
    }

    console.log('[The Sealer] EIP-3009: both nonce formats failed');
    return { valid: false };
  } catch (err) {
    console.error('[The Sealer] EIP-3009 verification error:', err);
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

    // ── SECURITY: 'test' string in proof is NEVER accepted ───────────────
    // Previously allowed for convenience — removed entirely from production.

    // ── Format 1: Raw EVM tx hash ─────────────────────────────────────────
    if (cleanProof.startsWith('0x') && cleanProof.length === 66) {
      const txHash = cleanProof as Hash;
      const [receipt, tx] = await Promise.all([
        client.getTransactionReceipt({ hash: txHash }).catch(() => null),
        client.getTransaction({ hash: txHash }).catch(() => null),
      ]);
      if (receipt?.status === 'success' && tx) {
        if (tx.to?.toLowerCase() === PAYMENT_CONFIG.recipient.toLowerCase()) {
          console.log('[The Sealer] Base verification OK (direct tx)');
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

    // ── Format 3: Base64-encoded JSON (standard x402 clients — EIP-3009) ──
    if (isBase64Json(cleanProof)) {
      console.log('[The Sealer] Detected base64 payload — verifying EIP-3009 locally');
      try {
        const paymentPayload     = JSON.parse(Buffer.from(cleanProof, 'base64').toString('utf-8'));
        const expectedAmountAtomic = BigInt(Math.round(parseFloat(price || '0.10') * 1_000_000));
        const result             = await verifyEIP3009Authorization(paymentPayload, expectedAmountAtomic);
        if (!result.valid) return { valid: false };
        // ── Submit onchain settlement ─────────────────────────────────────
        // Signature is verified — now actually execute the transfer onchain
        // by calling transferWithAuthorization on the USDC contract.
        // Non-fatal: if settlement fails, log but still return valid so the
        // agent receives their service. TODO: add retry queue post-launch.
        try {
          const auth = paymentPayload?.payload?.authorization;
          const sig  = paymentPayload?.payload?.signature as `0x${string}`;
          const account = privateKeyToAccount(privateKey as `0x${string}`);
          const wc      = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

          // Use the nonce exactly as signed — already full bytes32 from runner
          const nonce32 = ('0x' + (auth.nonce as string).replace('0x', '').padStart(64, '0')) as `0x${string}`;

          // Split signature: viem compact format is r(32)+s(32)+v(1) = 65 bytes = 132 hex chars
          // sig is 0x + 130 hex chars
          const sigHex = sig.startsWith('0x') ? sig.slice(2) : sig;
          const r = ('0x' + sigHex.slice(0, 64))   as `0x${string}`;
          const s = ('0x' + sigHex.slice(64, 128))  as `0x${string}`;
          const v = parseInt(sigHex.slice(128, 130), 16); // 27 or 28

          const txHash = await wc.writeContract({
            address:      USDC_BASE.address,
            abi: [{
              name:    'transferWithAuthorization',
              type:    'function',
              inputs:  [
                { name: 'from',        type: 'address' },
                { name: 'to',          type: 'address' },
                { name: 'value',       type: 'uint256' },
                { name: 'validAfter',  type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce',       type: 'bytes32' },
                { name: 'v',           type: 'uint8'   },
                { name: 'r',           type: 'bytes32' },
                { name: 's',           type: 'bytes32' },
              ],
              outputs: [],
              stateMutability: 'nonpayable',
            }],
            functionName: 'transferWithAuthorization',
            args: [
              auth.from as `0x${string}`,
              auth.to   as `0x${string}`,
              BigInt(auth.value),
              BigInt(auth.validAfter),
              BigInt(auth.validBefore),
              nonce32,
              v,
              r,
              s,
            ],
          });
          console.log('[The Sealer] USDC settlement submitted:', txHash);
          return { valid: true, txHash, chain: 'base' };
        } catch (settlErr) {
          console.error('[The Sealer] Settlement failed (non-fatal):', settlErr);
          return { valid: true, chain: 'base' };
        }
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
      input:  { properties: { body: Record<string, any> } };
      output: { properties: { example: Record<string, any> } };
    };
  };
}

function buildPaymentRequired(url: string, price: string, bazaar?: BazaarExtension) {
  const amountAtomic = String(Math.round(parseFloat(price) * 1_000_000));

  return {
    x402Version: 2,
    accepts: [
      {
        scheme:            'exact',
        network:           'eip155:8453',
        maxAmountRequired: amountAtomic,   // EVM spec field
        asset:             '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo:             PAYMENT_CONFIG.recipient,
        resource:          url,
        description:       PAYMENT_CONFIG.description,
        mimeType:          'application/json',
        outputSchema:      null,
        maxTimeoutSeconds: 60,
        extra:             { name: 'USDC', version: '2' },
      },
      {
        scheme:            'exact',
        network:           'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        amount:            amountAtomic,   // SVM spec field (intentional asymmetry)
        asset:             'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo:             PAYMENT_CONFIG.solanaRecipient,
        resource:          url,
        description:       PAYMENT_CONFIG.description,
        mimeType:          'application/json',
        outputSchema:      null,
        maxTimeoutSeconds: 60,
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

  const body = {
    x402Version: 2,
    error:       'X-PAYMENT header is required',
    accepts:     paymentRequired.accepts,
  };

  return new NextResponse(JSON.stringify(body), {
    status: 402,
    headers: {
      'PAYMENT-REQUIRED':              b64,
      'Content-Type':                  'application/json',
      'Access-Control-Allow-Origin':   '*',
    },
  });
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

  const testPaymentHeader = req.headers.get('X-TEST-PAYMENT');
  const isTestMode        = testPaymentHeader === 'true' && isTestPaymentAllowed(req);

  // ── SECURITY: Block X-TEST-PAYMENT in production explicitly ──────────────
  if (testPaymentHeader === 'true' && !isTestPaymentAllowed(req)) {
    console.warn('[The Sealer] SECURITY: X-TEST-PAYMENT rejected in production from IP:',
      req.headers.get('x-forwarded-for') || 'unknown');
    return NextResponse.json(
      { error: 'Payment required', message: 'Test payment bypass is not available.' },
      { status: 402 }
    );
  }

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
      console.log('[The Sealer] Test mode — bypassing verification (non-production only)');
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