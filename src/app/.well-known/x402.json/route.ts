// src/app/.well-known/x402.json/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function GET() {
  return NextResponse.json({
    name:        'The Sealer Protocol',
    description: 'Onchain accountability for AI agents. Commit, prove, get certified.',
    url:         'https://thesealer.xyz',
    docs:        'https://thesealer.xyz/api/infoproducts',
    openapi:     'https://thesealer.xyz/openapi.json',
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
          agentId:   'your wallet address (0x... for EVM, base58 pubkey for Solana)',
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
          claimType: 'x402_payment_reliability | defi_trading_performance | code_software_delivery | website_app_delivery',
          metric:    'measurable goal description',
          deadline:  'YYYY-MM-DD',
        },
      },
      {
        url:         'https://thesealer.xyz/api/attest-amendment',
        method:      'POST',
        description: 'Amend an existing commitment — thresholds can only decrease, before 40% window',
        price:       '$0.25 USDC',
        networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      },
      {
        url:         'https://thesealer.xyz/api/mirror/mint',
        method:      'POST',
        description: 'Mint a soulbound Mirror NFT of any Base, ETH, or Solana NFT you own',
        price:       '$0.30 (Base/ETH source) / $0.90 (Solana source) USDC',
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