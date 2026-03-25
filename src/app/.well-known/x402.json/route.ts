// src/app/.well-known/x402.json/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    name:        'The Sealer Protocol',
    description: 'Onchain accountability for AI agents. Commit, prove, get certified.',
    url:         'https://thesealer.xyz',
    docs:        'https://thesealer.xyz/api/infoproducts',
    openapi:     'https://thesealer.xyz/api/openapi.json',
    x402Version: 2,
    endpoints: [
      {
        url:         'https://thesealer.xyz/api/attest',
        method:      'POST',
        description: 'Issue onchain attestations — statements, credentials, Sealer IDs',
        price:       '$0.10–$0.20 USDC',
        networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
        params: {
          format:    'statement | card | sleeve | sid',
          agentId:   'your wallet address (0x... for EVM)',
          statement: 'your statement text',
        },
      },
      {
        url:         'https://thesealer.xyz/api/attest-commitment',
        method:      'POST',
        description: 'Commit to a measurable goal onchain — get certified when achieved',
        price:       '$0.50 USDC',
        networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
        params: {
          agentId:   'your wallet address',
          claimType: 'github | defi_base | defi_solana | website | x402',
          metric:    'measurable goal description',
          deadline:  'unix timestamp',
        },
      },
      {
        url:         'https://thesealer.xyz/api/mirror/mint',
        method:      'POST',
        description: 'Mint a soulbound Mirror NFT of any Base or Solana NFT you own',
        price:       '$0.30 (Base NFT) / $0.90 (Solana NFT) USDC',
        networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      },
      {
        url:         'https://thesealer.xyz/api/upload',
        method:      'POST',
        description: 'Upload an image for use in attestation credentials',
        price:       '$0.01 USDC',
        networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      },
      {
        url:         'https://thesealer.xyz/api/attest-amendment',
        method:      'POST',
        description: 'Amend an existing commitment with updated parameters',
        price:       '$0.10 USDC',
        networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      },
    ],
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}