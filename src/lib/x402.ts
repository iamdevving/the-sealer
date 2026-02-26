// src/lib/x402.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, createWalletClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

const rpcUrl = process.env.ALCHEMY_RPC_URL!;
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

if (!rpcUrl) console.error('[Seal] ❌ Missing ALCHEMY_RPC_URL');
if (!rawPrivateKey) console.error('[Seal] ❌ Missing TEST_PRIVATE_KEY');

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const PAYMENT_CONFIG = {
  chain:       'base-sepolia',
  token:       'USDC',
  amount:      '0.01',
  description: 'Seal Protocol attestation',
  recipient:   '0x9B35682F33264057E8fB2D4FebA7c76E74816A52',
};

const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
const SCHEMA_UID  = '0xf4b3daae205c3fc3c3b8a7d3fb31bcd497911895677ab1db5f431b68a29bb286';
const eas = new EAS(EAS_ADDRESS);

export async function issueSealAttestation(achievement: string) {
  console.log(`[Seal] Issuing attestation for: "${achievement}"`);

  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain:     baseSepolia,
    transport: http(rpcUrl),
  });

  (eas as any).connect(walletClient);

  const schemaEncoder = new SchemaEncoder('string achievement');
  const encodedData   = schemaEncoder.encodeData([
    { name: 'achievement', value: achievement, type: 'string' },
  ]);

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

  const preparedTx = (txResponse as any).data;
  const txHash     = await walletClient.sendTransaction(preparedTx);

  const receipt = await client.waitForTransactionReceipt({
    hash:            txHash,
    pollingInterval: 1000,
    timeout:         90000,
  });

  console.log('[Seal] ✅ Attestation mined! TX:', receipt.transactionHash);
  return receipt;
}

export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const proof =
    req.headers.get('PAYMENT-SIGNATURE') ||
    req.headers.get('X-PAYMENT')         ||
    req.headers.get('x-payment-proof')   ||
    req.headers.get('authorization');

  const isTestMode = req.headers.get('X-TEST-PAYMENT') === 'true';

  if (!proof && !isTestMode) {
    return new NextResponse(
      'Payment Required\nPay 0.01 USDC on Base Sepolia via x402.',
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
    console.log(`[Seal] Connected to Base Sepolia (chainId ${chainId})`);
    return await handler();
  } catch (error: any) {
    console.error('[Seal] Error:', error);
    return NextResponse.json(
      { error: 'Internal error', details: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
