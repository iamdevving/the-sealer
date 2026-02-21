import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { SignJWT } from 'jose';  // new import

const rpcUrl = process.env.ALCHEMY_RPC_URL;
const cdpKeyId = process.env.CDP_API_KEY_ID;
const cdpSecret = process.env.CDP_API_KEY_SECRET;

if (!rpcUrl) console.error('[Seal] Missing ALCHEMY_RPC_URL');
if (!cdpKeyId || !cdpSecret) console.error('[Seal] Missing CDP_API_KEY_ID and/or CDP_API_KEY_SECRET - verification will fail');

const client = rpcUrl ? createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) }) : null;

// Payment config – CHANGE recipient to YOUR test wallet address!
const PAYMENT_CONFIG = {
  chain: 'base-sepolia',
  token: 'USDC',
  amount: '0.01', // 0.01 USDC (adjust decimals in real use)
  description: 'Seal attestation request',
  recipient: '0xYourTestWalletAddressHere', // ← MUST CHANGE THIS (your Sepolia wallet)
};

async function generateCdpJwt() {
  if (!cdpKeyId || !cdpSecret) throw new Error('CDP keys missing');

  const secretKey = new TextEncoder().encode(cdpSecret);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256' })  // ECDSA as required
    .setIssuedAt()
    .setExpirationTime('5m')  // short-lived
    .setIssuer(cdpKeyId)      // key ID as issuer
    .sign(secretKey);

  return jwt;
}

export async function withX402Payment(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const proofHeader =
    req.headers.get('x-payment-proof') ||
    req.headers.get('authorization') ||
    req.headers.get('payment-signature') ||
    req.headers.get('x402-payment') ||
    req.headers.get('x-payment') ||
    req.headers.get('PAYMENT-SIGNATURE');  // added common uppercase variant

  if (!proofHeader || proofHeader.trim() === '') {
    return new NextResponse(
      'Payment Required\nPay USDC on Base Sepolia via x402.',
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
    if (client) {
      const chainId = await client.getChainId();
      console.log(`[Seal] Connected to Base Sepolia (chainId ${chainId})`);
    }

    // Generate fresh JWT for this request
    const bearerToken = await generateCdpJwt();

    console.log('[Seal] Verifying proof via CDP Facilitator...');

    const verifyResponse = await fetch('https://api.cdp.coinbase.com/platform/v2/x402/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: proofHeader,  // usually base64-encoded payload
        paymentRequirements: {
          chain: PAYMENT_CONFIG.chain,
          token: PAYMENT_CONFIG.token,
          amount: PAYMENT_CONFIG.amount,
          recipient: PAYMENT_CONFIG.recipient,
        },
      }),
    });

    const verifyData = await verifyResponse.json();

    if (!verifyResponse.ok || !verifyData.valid) {
      console.error('[Seal] Facilitator reject:', verifyData);
      return NextResponse.json({ error: 'Invalid payment proof' }, { status: 402 });
    }

    console.log('[Seal] Payment verified successfully');

    return await handler();
  } catch (error) {
    console.error('[Seal] Verification error:', error);
    return NextResponse.json({ error: 'Payment verification failed - internal' }, { status: 500 });
  }
}