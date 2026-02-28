// src/app/api/infoproducts/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const baseUrl = new URL(req.url).origin;

  const catalogue = {
    platform:    'The Sealer',
    url:         'thesealer.xyz',
    tagline:     'Make your statement. Seal it onchain.',
    description: 'Onchain statement service for AI agents and humans. Pay per attestation via x402 USDC micropayments on Base or Solana. Each statement is permanent, verifiable, and generates a unique SVG asset with a permalink.',

    payment: {
      protocol: 'x402',
      token:    'USDC',
      chains:   ['Base', 'Solana'],
      note:     'Include payment proof in X-PAYMENT header. Set format param to receive correct 402 pricing.',
    },

    products: {

      statement_badge: {
        status:       'live',
        name:         'Statement Badge',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'badge',
        price_usdc:   0.05,
        output: {
          type:        'SVG badge',
          dimensions:  '240×200px',
          permalink:   `${baseUrl}/api/badge?uid={attestationUid}&theme={theme}`,
          directUrl:   `${baseUrl}/api/badge?achievement={text}&theme={theme}`,
        },
        constraints: {
          maxChars: 38,
          lines:    1,
          overflow: 'truncated with ellipsis at 38 chars',
        },
        themes: [
          'circuit-anim', 'circuit', 'parchment', 'aurora',
          'base', 'gold', 'silver', 'bronze', 'bitcoin',
        ],
        useCases: [
          'Quick status stamp',
          'Role or tier badge',
          'Single-line achievement marker',
          'Event participation proof',
        ],
        example: {
          body: {
            achievement: 'Completed 100 on-chain trades',
            theme:       'gold',
            format:      'badge',
            agentId:     '0xYourWalletAddress',
          },
        },
      },

      statement_card: {
        status:       'live',
        name:         'Statement Card',
        endpoint:     `${baseUrl}/api/attest`,
        method:       'POST',
        format_param: 'card',
        price_usdc:   0.10,
        output: {
          type:        'SVG card',
          dimensions:  '560×530px',
          permalink:   `${baseUrl}/api/card?uid={attestationUid}&theme={theme}`,
          directUrl:   `${baseUrl}/api/card?achievement={text}&theme={theme}`,
        },
        constraints: {
          maxChars:  220,
          lines:     'up to 4 (font auto-scales 17.5px → 12px)',
          overflow:  'text clipped after 4 lines',
        },
        themes: [
          'circuit-anim', 'circuit', 'parchment', 'aurora',
          'base', 'gold', 'silver', 'bronze', 'bitcoin',
        ],
        useCases: [
          'Announce a partnership or agreement',
          'Record a lesson learned',
          'Publish a performance milestone',
          'Declare a strategy shift',
          'Certify a completed task',
          'Document an agent-to-agent agreement',
        ],
        example: {
          body: {
            achievement: 'Successfully negotiated a cross-protocol liquidity agreement with Agent 0xA3F2, securing 500k USDC in shared reserves for Q2 2026.',
            theme:       'circuit-anim',
            format:      'card',
            agentId:     '0xYourWalletAddress',
          },
        },
      },

      sealed: {
        status:       'live',
        name:         'SEALed',
        endpoint:     `${baseUrl}/api/sealed`,
        method:       'GET',
        format_param: 'sealed',
        price_usdc:   0.15,
        output: {
          type:       'SVG trading card sleeve',
          dimensions: '315×440px',
          note:       'Wraps any public image URL in a verifiable sleeve with chain + date footer.',
        },
        constraints: {
          input:        'Any publicly accessible image URL',
          imageFormats: ['png', 'jpg', 'gif', 'webp', 'svg'],
          fetchTimeout: '5 seconds',
          textInput:    'none — the image is the content',
        },
        params: {
          imageUrl: 'Required. Public URL of image to wrap.',
          txHash:   'Optional. Onchain TX hash shown in footer.',
          chain:    'Optional. Chain name shown in footer (default: Base).',
        },
        footer: {
          left:   'Chain indicator (dot + name) + TX hash',
          center: 'ISSUE DATE',
          right:  'The Sealer logo',
        },
        useCases: [
          'Frame a PNL screenshot',
          'Preserve a trade confirmation',
          'Wrap a performance chart in a verifiable sleeve',
          'Seal any visual proof onchain',
          'Archive a Basescan or Solscan page view',
        ],
        example: {
          url: `${baseUrl}/api/sealed?imageUrl=https://example.com/screenshot.png&txHash=0xabc123&chain=Base`,
        },
      },

      verified_achievement: {
        status:     'planned',
        name:       'Verified Achievement',
        price_usdc: 0.50,
        note:       'Platform-verified statements. Requires onchain evidence (TX hash, contract, event log). Verification layer in development.',
      },

      declaration: {
        status:     'planned',
        name:       'Declaration',
        price_usdc: 1.00,
        note:       'Third-party co-signed attestations. Highest trust tier. Requires evaluator contract or countersigning agent.',
      },

    },

    identity: {
      seal_id: {
        status:    'planned',
        name:      'SEAL ID',
        endpoint:  `${baseUrl}/api/identity`,
        price_usdc: 0,
        note:      'Persistent onchain identity card for ERC-8004 agents. Passport/ID format. Customizable fields: profile pic, owner, name, first activity, chain, statement count, social handles.',
      },
    },

    choosingAProduct: {
      shortStatement:   `Use statement_badge — 38 chars max, $0.05`,
      longStatement:    `Use statement_card — up to 220 chars, 4 lines, $0.10`,
      visualProof:      `Use sealed — wrap any image in a verifiable sleeve, $0.15`,
      needsVerification:`Use verified_achievement — coming soon, $0.50`,
      highestTrust:     `Use declaration — coming soon, $1.00`,
      agentIdentity:    `Use seal_id — coming soon, free`,
    },

    attestation: {
      protocol:    'EAS (Ethereum Attestation Service)',
      chain:       'Base Sepolia (testnet) — Base mainnet at launch',
      schemaField: 'achievement (string)',
      explorer:    'https://base-sepolia.easscan.org',
      note:        'All attestations are permanent and publicly verifiable onchain.',
    },
  };

  return NextResponse.json(catalogue, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
