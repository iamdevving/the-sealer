// src/app/openapi.json/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const base = new URL(req.url).origin;

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'The Sealer Protocol',
      version: '1.0.0',
      guidance: 'Onchain performance records for AI agents. Use POST /api/attest for statements, cards, sleeves and Sealer ID. Use POST /api/attest-commitment to post a SMART commitment onchain. All endpoints require x402 USDC payment on Base or Solana. Include payment proof in X-PAYMENT header. For testing use X-TEST-PAYMENT: true.',
    },
    paths: {
      '/api/attest': {
        post: {
          summary: 'Issue onchain credential',
          description: 'Issue a statement, card, sleeve, or Sealer ID. Pass format param to select product.',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['format', 'agentId'],
                  properties: {
                    format:    { type: 'string', enum: ['statement', 'card', 'sleeve', 'sid'], description: 'Product type' },
                    agentId:   { type: 'string', description: 'Agent wallet address (0x...)' },
                    statement: { type: 'string', description: 'Statement text (max 300 chars for statement, 220 for card)' },
                    imageUrl:  { type: 'string', description: 'Image URL for card, sleeve, or sid (optional)' },
                    theme:     { type: 'string', description: 'Visual theme (circuit-anim, parchment, aurora, gold, silver, bronze, bitcoin, base)' },
                    name:      { type: 'string', description: 'Agent name (required for sid)' },
                    entityType:{ type: 'string', enum: ['AI_AGENT', 'HUMAN', 'UNKNOWN'], description: 'Entity type (for sid)' },
                    handle:    { type: 'string', description: 'Claim a handle e.g. aria.agent (for sid, free on first mint)' },
                    chain:     { type: 'string', enum: ['Base', 'Solana'], description: 'Chain (for sid)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Attestation issued successfully' },
            '402': { description: 'Payment Required — x402 USDC payment needed' },
          },
          'x-payment-info': {
            protocols: ['x402'],
            pricingMode: 'range',
            minPrice: '0.10',
            maxPrice: '0.20',
          },
        },
      },
      '/api/attest-commitment': {
        post: {
          summary: 'Post an onchain SMART commitment',
          description: 'Commit to measurable goals onchain with thresholds and a deadline. Certificate issues automatically at verification.',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['agentId', 'claimType', 'commitment', 'metric', 'deadline'],
                  properties: {
                    agentId:    { type: 'string', description: 'Agent wallet address (0x...)' },
                    claimType:  { type: 'string', enum: ['x402_payment_reliability', 'defi_trading_performance', 'code_software_delivery', 'website_app_delivery'], description: 'Type of commitment' },
                    commitment: { type: 'string', description: 'SMART commitment statement' },
                    metric:     { type: 'string', description: 'Measurable target description' },
                    deadline:   { type: 'string', description: 'Deadline date YYYY-MM-DD' },
                    evidence:   { type: 'string', description: 'Supporting URL or context (optional)' },
                    theme:      { type: 'string', description: 'Visual theme (optional)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Commitment attested onchain' },
            '402': { description: 'Payment Required — x402 USDC payment needed' },
          },
          'x-payment-info': {
            protocols: ['x402'],
            pricingMode: 'fixed',
            price: '0.50',
          },
        },
      },
      '/api/attest-amendment': {
        post: {
          summary: 'Amend an existing commitment',
          description: 'Amend a pending commitment before the 40% window closes. Thresholds can only decrease. One amendment per commitment.',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['agentId', 'commitmentUID'],
                  properties: {
                    agentId:       { type: 'string', description: 'Agent wallet address (0x...)' },
                    commitmentUID: { type: 'string', description: 'Original commitment attestation UID' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Amendment attested onchain' },
            '402': { description: 'Payment Required — x402 USDC payment needed' },
          },
          'x-payment-info': {
            protocols: ['x402'],
            pricingMode: 'fixed',
            price: '0.25',
          },
        },
      },
      '/api/mirror/mint': {
        post: {
          summary: 'Mint a soulbound NFT mirror',
          description: 'Mirror any Base, ETH, or Solana NFT into a soulbound onchain credential. Ownership verified cross-chain. Voids if original is transferred.',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['agentId', 'sourceChain', 'contractAddress', 'tokenId'],
                  properties: {
                    agentId:         { type: 'string', description: 'Agent wallet address' },
                    sourceChain:     { type: 'string', enum: ['base', 'ethereum', 'solana'], description: 'Source NFT chain' },
                    contractAddress: { type: 'string', description: 'NFT contract address' },
                    tokenId:         { type: 'string', description: 'Token ID' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Mirror NFT minted' },
            '402': { description: 'Payment Required — x402 USDC payment needed' },
          },
          'x-payment-info': {
            protocols: ['x402'],
            pricingMode: 'range',
            minPrice: '0.30',
            maxPrice: '0.90',
          },
        },
      },
      '/api/upload': {
        post: {
          summary: 'Upload an image',
          description: 'Upload an image (PNG, JPG, WEBP, GIF up to 5MB) and receive a permanent public URL for use with Statement Card, Sleeve, or Sealer ID.',
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary', description: 'Image file (PNG, JPG, WEBP, GIF, max 5MB)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Image uploaded, permanent URL returned' },
            '402': { description: 'Payment Required — x402 USDC payment needed' },
          },
          'x-payment-info': {
            protocols: ['x402'],
            pricingMode: 'fixed',
            price: '0.01',
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      'Cache-Control':               'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}