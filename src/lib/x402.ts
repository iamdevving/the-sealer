import { NextRequest, NextResponse } from 'next/server';

// Config (testnet for free testing)
const PAYMENT_CONFIG = {
  chain: 'base-sepolia',
  token: 'USDC',
  amount: '0.01', // ~$0.01
  description: 'Test ping / attestation request',
};

export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  // x402 clients send proof in headers like 'x-payment-proof' or 'authorization'
  // Standard is often 'PAYMENT-SIGNATURE' or custom
  const proof = req.headers.get('x-payment-proof') ||
                req.headers.get('authorization') ||
                req.headers.get('payment-signature');

  if (!proof || proof.trim() === '') {
    // Demand payment
    return new NextResponse(
      'Payment Required\nUse x402 to pay USDC on Base Sepolia.',
      {
        status: 402,
        headers: {
          'WWW-Authenticate': `x402 payment="${PAYMENT_CONFIG.token}" chain="${PAYMENT_CONFIG.chain}" amount="${PAYMENT_CONFIG.amount}" description="${PAYMENT_CONFIG.description}"`,
          'Content-Type': 'text/plain',
        },
      }
    );
  }

  // Placeholder verification (MVP: accept any non-empty proof)
  // Later: use viem to check sig/tx on-chain or call facilitator /verify
  console.log('Received x402 proof:', proof.substring(0, 50) + '...'); // log partial for debug

  // For now: fake success if header present
  return await handler();
}