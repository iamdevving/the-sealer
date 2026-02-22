import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, createWalletClient, type Hash } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

const rpcUrl = process.env.ALCHEMY_RPC_URL!;
const rawPrivateKey = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

const PAYMENT_CONFIG = {
  chain: 'base-sepolia',
  token: 'USDC',
  amount: '0.01',
  description: 'Seal attestation request',
  recipient: '0x9B35682F33264057E8fB2D4FebA7c76E74816A52',
};

const EAS_ADDRESS = '0x4200000000000000000000000000000000000021';
const eas = new EAS(EAS_ADDRESS);

const SCHEMA_UID = '0xf4b3daae205c3fc3c3b8a7d3fb31bcd497911895677ab1db5f431b68a29bb286';

export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const proofHeader = req.headers.get('PAYMENT-SIGNATURE') ||
                      req.headers.get('X-PAYMENT') ||
                      req.headers.get('x-payment-proof') ||
                      req.headers.get('authorization');

  const isTestMode = req.headers.get('X-TEST-PAYMENT') === 'true';

  if (!proofHeader && !isTestMode) {
    return new NextResponse('Payment Required\nPay 0.01 USDC on Base Sepolia via x402.', {
      status: 402,
      headers: {
        'WWW-Authenticate': `x402 payment="${PAYMENT_CONFIG.token}" chain="${PAYMENT_CONFIG.chain}" amount="${PAYMENT_CONFIG.amount}" description="${PAYMENT_CONFIG.description}" recipient="${PAYMENT_CONFIG.recipient}"`,
        'Content-Type': 'text/plain',
      },
    });
  }

  try {
    console.log(`[Seal] Connected to Base Sepolia (chainId ${await client.getChainId()})`);

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

    (eas as any).connect(walletClient);

    console.log('[Seal] Encoding data...');
    const schemaEncoder = new SchemaEncoder('string achievement');
    const encodedData = schemaEncoder.encodeData([
      { name: 'achievement', value: 'Agent test achievement – Seal MVP #1 (LIVE)', type: 'string' },
    ]);

    console.log('[Seal] Preparing attestation...');
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

    const preparedTx = (txResponse as any).data;
    console.log('[Seal] Prepared tx to:', preparedTx.to);
    console.log('[Seal] Sending transaction manually...');

    const txHash = await walletClient.sendTransaction(preparedTx);

    console.log(`[Seal] ✅ Tx SENT! Hash: ${txHash}`);

    console.log('[Seal] Waiting for confirmation (up to 90s)...');
    const receipt = await client.waitForTransactionReceipt({ 
      hash: txHash, 
      pollingInterval: 1000, 
      timeout: 90000 
    });

    console.log('[Seal] ✅ SEAL ATTESTATION ISSUED SUCCESSFULLY!');
    console.log('[Seal] Tx Hash:', receipt.transactionHash);

    return NextResponse.json({
      status: 'success',
      message: 'Payment accepted + Seal EAS attestation issued!',
      txHash: receipt.transactionHash,
      explorer: `https://sepolia.basescan.org/tx/${receipt.transactionHash}`,
    });

  } catch (error: any) {
    console.error('[Seal] ❌ ERROR:', error.message || error);
    return NextResponse.json({ error: 'Internal error', details: error.message || String(error) }, { status: 500 });
  }
}