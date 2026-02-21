import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

// Load from .env.local (Next.js auto-loads it in dev)
const rpcUrl = process.env.ALCHEMY_RPC_URL;

if (!rpcUrl) {
  console.error('Missing ALCHEMY_RPC_URL in .env.local');
}

// Create viem client once (for RPC connection testing / future verification)
const client = rpcUrl
  ? createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    })
  : null;

// Payment config (testnet values - adjust later)
const PAYMENT_CONFIG = {
  chain: 'base-sepolia',
  token: 'USDC',
  amount: '0.01', // small test amount
  description: 'Seal attestation request',
};

export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  // Extract payment proof from common x402 header locations
  const proof =
    req.headers.get('x-payment-proof') ||
    req.headers.get('authorization') ||
    req.headers.get('payment-signature') ||
    req.headers.get('x402-payment');

  if (!proof || proof.trim() === '') {
    // No proof → send 402 challenge
    return new NextResponse(
      'Payment Required\nPay USDC on Base Sepolia via x402.',
      {
        status: 402,
        headers: {
          'WWW-Authenticate': `x402 payment="${PAYMENT_CONFIG.token}" chain="${PAYMENT_CONFIG.chain}" amount="${PAYMENT_CONFIG.amount}" description="${PAYMENT_CONFIG.description}"`,
          'Content-Type': 'text/plain',
        },
      }
    );
  }

  try {
    // Optional: Test RPC connection (logs on first paid request)
    if (client) {
      const chainId = await client.getChainId();
      console.log(`[Seal] Connected to chain ID: ${chainId} (Base Sepolia)`);
    } else {
      console.warn('[Seal] No RPC configured - skipping chain check');
    }

    // MVP verification: accept if proof header exists (placeholder)
    // TODO: Replace with real verification (facilitator call or viem sig/tx check)
    console.log('[Seal] Received proof (partial):', proof.substring(0, 50) + (proof.length > 50 ? '...' : ''));

    // Payment "accepted" → execute the handler (will return success JSON)
    return await handler();
  } catch (error) {
    console.error('[Seal] Verification / RPC error:', error);
    return NextResponse.json(
      { error: 'Payment verification failed - internal error' },
      { status: 500 }
    );
  }
}