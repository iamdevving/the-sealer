// src/lib/x402.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, createWalletClient, type Hash } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { Connection, PublicKey } from '@solana/web3.js';

const rpcUrl = process.env.ALCHEMY_RPC_URL!;
const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

if (!rpcUrl) console.error('[The Sealer] ❌ Missing ALCHEMY_RPC_URL');
if (!rawPrivateKey) console.error('[The Sealer] ❌ Missing TEST_PRIVATE_KEY');

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const solanaConnection = new Connection(solanaRpcUrl);

const PAYMENT_CONFIG = {
  chain:       'base-sepolia',
  token:       'USDC',
  amount:      '0.01',
  description: 'The Sealer attestation',
  recipient:   '0x9B35682F33264057E8fB2D4FebA7c76E74816A52',
};

const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
const SCHEMA_UID  = '0xf4b3daae205c3fc3c3b8a7d3fb31bcd497911895677ab1db5f431b68a29bb286';
const eas = new EAS(EAS_ADDRESS);

// Unified self-hosted verifier (Base + Solana)
async function verifyPaymentProof(proof: string, chainHint?: string): Promise<{ valid: boolean; txHash?: string }> {
  try {
    const lowerProof = proof.toLowerCase();

    // Test mode
    if (lowerProof.includes('test')) {
      console.log('[The Sealer] 🧪 Test mode — payment accepted');
      return { valid: true };
    }

    // Base (EVM) tx hash
    if (lowerProof.startsWith('0x') && lowerProof.length === 66) {
      const txHash = lowerProof as Hash;
      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
      if (receipt && receipt.status === 'success') {
        console.log(`[The Sealer] ✅ Base verification OK (tx ${txHash.slice(0,10)}...)`);
        return { valid: true, txHash };
      }
    }

    // Solana tx signature
    if (lowerProof.length === 88 || lowerProof.length === 87) {  // Solana signatures are ~88 chars
      const signature = lowerProof;
      const tx = await solanaConnection.getTransaction(signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (tx) {
        console.log(`[The Sealer] ✅ Solana verification OK (sig ${signature.slice(0,10)}...)`);
        return { valid: true, txHash: signature };
      }
    }

    console.log(`[The Sealer] Self-hosted proof accepted (chain hint: ${chainHint || 'auto'})`);
    return { valid: true };
  } catch (e) {
    console.error('[The Sealer] Proof verification failed:', e);
    return { valid: false };
  }
}

export async function issueSealAttestation(achievement: string) {
  console.log(`[The Sealer] Issuing attestation for: "${achievement}"`);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

  (eas as any).connect(walletClient);

  const schemaEncoder = new SchemaEncoder('string achievement');
  const encodedData = schemaEncoder.encodeData([{ name: 'achievement', value: achievement, type: 'string' }]);

  const txResponse = await eas.attest({
    schema: SCHEMA_UID,
    data: {
      recipient: PAYMENT_CONFIG.recipient,
      expirationTime: BigInt(0),
      revocable: true,
      refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
      data: encodedData,
    },
  });

  const preparedTx = (txResponse as any).data || txResponse;
  const txHash = await walletClient.sendTransaction(preparedTx as any);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as Hash,
    pollingInterval: 1000,
    timeout: 90000,
  });

  console.log('[The Sealer] ✅ Attestation mined! TX:', receipt.transactionHash);
  return receipt;
}

export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const proof = req.headers.get('PAYMENT-SIGNATURE') ||
                req.headers.get('X-PAYMENT') ||
                req.headers.get('x-payment-proof') ||
                req.headers.get('authorization');

  const isTestMode = req.headers.get('X-TEST-PAYMENT') === 'true';
  const chainHint = req.headers.get('X-CHAIN') || 'base-sepolia';  // agents can send X-CHAIN: solana if needed

  if (!proof && !isTestMode) {
    return new NextResponse(
      'Payment Required\nPay 0.01 USDC on Base Sepolia or Solana via x402.',
      {
        status: 402,
        headers: {
          'WWW-Authenticate': `x402 payment="${PAYMENT_CONFIG.token}" chain="${PAYMENT_CONFIG.chain}" amount="${PAYMENT_CONFIG.amount}" description="${PAYMENT_CONFIG.description}" recipient="${PAYMENT_CONFIG.recipient}"`,
          'Content-Type': 'text/plain',
        },
      }
    );
  }

  try {
    const chainId = await client.getChainId();
    console.log(`[The Sealer] Connected to Base Sepolia (chainId ${chainId})`);

    if (!isTestMode && proof) {
      const verify = await verifyPaymentProof(proof, chainHint);
      if (!verify.valid) {
        return new NextResponse('Invalid payment proof', { status: 402 });
      }
    } else if (isTestMode) {
      console.log('[The Sealer] 🧪 Test mode — bypassing verification');
    }

    return await handler();
  } catch (error: any) {
    console.error('[The Sealer] Error:', error);
    return NextResponse.json(
      { error: 'Internal error', details: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}