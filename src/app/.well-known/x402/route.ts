import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const BASE_URL   = 'https://thesealer.xyz';
const LAST_UPDATED = '2026-03-28T00:00:00.000Z';

const EVM_ASSET  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_ASSET  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const EVM_PAY_TO = '0x4386606286eEA12150386f0CFc55959F30de00D1';
const SOL_PAY_TO = '6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj';
const EVM_NETWORK = 'eip155:8453';
const SOL_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

function toAtomic(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}

function makeAccepts(url: string, priceUsd: number) {
  return [
    {
      scheme: 'exact',
      network: EVM_NETWORK,
      maxAmountRequired: toAtomic(priceUsd),
      asset: EVM_ASSET,
      payTo: EVM_PAY_TO,
      resource: url,
      description: 'The Sealer Protocol',
      mimeType: 'application/json',
      outputSchema: null,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    },
    {
      scheme: 'exact',
      network: SOL_NETWORK,
      amount: toAtomic(priceUsd),
      asset: SOL_ASSET,
      payTo: SOL_PAY_TO,
      resource: url,
      description: 'The Sealer Protocol',
      mimeType: 'application/json',
      outputSchema: null,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    },
  ];
}

// Upload intentionally omitted — image attachment is handled inline within
// each product endpoint (card, sleeve, sid) at no extra cost. Agents should
// pass a "file" field directly to the product endpoint or use imageUrl.
const items = [
  {
    resource: `${BASE_URL}/api/attest`,
    type: 'http',
    x402Version: 2,
    accepts: makeAccepts(`${BASE_URL}/api/attest`, 0.10),
    lastUpdated: LAST_UPDATED,
    metadata: {
      description: 'Issue onchain attestations — statements, credentials, Sealer IDs',
      method: 'POST',
      formats: ['statement ($0.10)', 'card ($0.15)', 'sleeve ($0.15)', 'sid ($0.20)'],
      docs: `${BASE_URL}/api/infoproducts`,
    },
  },
  {
    resource: `${BASE_URL}/api/attest-commitment`,
    type: 'http',
    x402Version: 2,
    accepts: makeAccepts(`${BASE_URL}/api/attest-commitment`, 0.50),
    lastUpdated: LAST_UPDATED,
    metadata: {
      description: 'Post a verifiable onchain commitment with SMART metrics and deadline',
      method: 'POST',
      docs: `${BASE_URL}/api/infoproducts`,
    },
  },
  {
    resource: `${BASE_URL}/api/attest-amendment`,
    type: 'http',
    x402Version: 2,
    accepts: makeAccepts(`${BASE_URL}/api/attest-amendment`, 0.25),
    lastUpdated: LAST_UPDATED,
    metadata: {
      description: 'Amend an existing commitment — thresholds only, before 40% of window elapsed',
      method: 'POST',
      docs: `${BASE_URL}/api/infoproducts`,
    },
  },
  {
    resource: `${BASE_URL}/api/mirror/mint`,
    type: 'http',
    x402Version: 2,
    accepts: makeAccepts(`${BASE_URL}/api/mirror/mint`, 0.30),
    lastUpdated: LAST_UPDATED,
    metadata: {
      description: 'Mint a soulbound mirror of any Base, ETH, or Solana NFT',
      method: 'POST',
      pricing: 'Base mirror $0.30 · Solana mirror $0.90',
      docs: `${BASE_URL}/api/infoproducts`,
    },
  },
];

export async function GET() {
  return NextResponse.json(
    { x402Version: 2, items },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}