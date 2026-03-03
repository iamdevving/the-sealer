// src/lib/x402.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, createWalletClient, type Hash } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { Connection, PublicKey } from '@solana/web3.js';

const rpcUrl        = process.env.ALCHEMY_RPC_URL!;
const solanaRpcUrl  = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey    = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const client           = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const solanaConnection = new Connection(solanaRpcUrl);

const PAYMENT_CONFIG = {
  chain:            'base-sepolia',
  token:            'USDC',
  description:      'The Sealer attestation',
  recipient:        '0x9B35682F33264057E8fB2D4FebA7c76E74816A52', // Base wallet
  solanaRecipient:  '6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj', // Solana wallet
};

const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
const SCHEMA_UID  = '0xf4b3daae205c3fc3c3b8a7d3fb31bcd497911895677ab1db5f431b68a29bb286';
const eas         = new EAS(EAS_ADDRESS);

function isSolanaSignature(str: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(str.trim());
}

async function verifyPaymentProof(proof: string): Promise<{ valid: boolean; txHash?: string; chain?: 'base' | 'solana' }> {
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
          return { valid: true, txHash, chain: 'base' };
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
        // Verify one of the account keys is our Solana recipient
        const recipientKey = new PublicKey(PAYMENT_CONFIG.solanaRecipient);
        const accountKeys  = tx.transaction.message.getAccountKeys
          ? tx.transaction.message.getAccountKeys().staticAccountKeys
          : (tx.transaction.message as any).accountKeys;

        const recipientFound = accountKeys.some(
          (key: PublicKey) => key.toBase58() === recipientKey.toBase58()
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

export async function issueSealAttestation(achievement: string) {
  console.log(`[The Sealer] Issuing attestation for: "${achievement}"`);

  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

  (eas as any).connect(walletClient);

  const schemaEncoder = new SchemaEncoder('string achievement');
  const encodedData   = schemaEncoder.encodeData([{ name: 'achievement', value: achievement, type: 'string' }]);

  const txResponse = await eas.attest({
    schema: SCHEMA_UID,
    data: {
      recipient:      PAYMENT_CONFIG.recipient,
      expirationTime: BigInt(0),
      revocable:      true,
      refUID:         '0x0000000000000000000000000000000000000000000000000000000000000000',
      data:           encodedData,
    },
  });

  const preparedTx = (txResponse as any).data || txResponse;
  const txHash     = await walletClient.sendTransaction(preparedTx as any);

  const receipt = await client.waitForTransactionReceipt({
    hash:            txHash as Hash,
    pollingInterval: 1000,
    timeout:         90000,
  });

  console.log('[The Sealer] ✅ Attestation mined! TX:', receipt.transactionHash);
  return receipt;
}

export async function withX402Payment(
  req:     NextRequest,
  handler: (paymentChain?: 'base' | 'solana') => Promise<NextResponse>,
  price:   string = '0.10'
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
          {
            chain:     'base-sepolia',
            token:     'USDC',
            recipient: PAYMENT_CONFIG.recipient,
            amount:    price,
          },
          {
            chain:     'solana-devnet',
            token:     'USDC',
            recipient: PAYMENT_CONFIG.solanaRecipient,
            amount:    price,
          },
        ],
        x402: {
          version: 1,
          schemes: ['exact'],
          network: ['base-sepolia', 'solana-devnet'],
        },
      }),
      {
        status:  402,
        headers: {
          'WWW-Authenticate': `x402 payment="USDC" chain="base-sepolia|solana-devnet" amount="${price}" recipient-base="${PAYMENT_CONFIG.recipient}" recipient-solana="${PAYMENT_CONFIG.solanaRecipient}"`,
          'Content-Type':     'application/json',
        },
      }
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

    // Pass paymentChain to handler so SVGs can reflect the correct chain
    return await handler(paymentChain);
  } catch (error: any) {
    console.error('[The Sealer] Error:', error);
    return NextResponse.json({ error: 'Internal error', details: error?.message ?? String(error) }, { status: 500 });
  }
}