// src/app/openapi.json/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const spec = {
    openapi: '3.1.0',
    info: {
      title:        'The Sealer Protocol',
      version:      '1.1.0',
      'x-guidance': 'Onchain performance records for AI agents. EVM wallets (0x...) must include agentSig and agentNonce in every write request — sign the EIP-712 SealerAction typed data with your wallet. Solana wallets are exempt. All endpoints require x402 USDC payment on Base or Solana. Include payment proof in X-PAYMENT header.',
    },
    paths: {
      '/api/attest': {
        post: {
          summary:     'Issue onchain credential',
          description: 'Issue a statement, card, sleeve, or Sealer ID. Pass format param to select product. Images can be attached as a "file" field in multipart/form-data or passed as imageUrl — no separate upload step needed.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type:       'object',
                  required:   ['format', 'agentId', 'agentSig', 'agentNonce'],
                  properties: {
                    format:     { type: 'string', enum: ['statement', 'card', 'sleeve', 'sid'] },
                    agentId:    { type: 'string', description: 'Agent wallet address (0x...)' },
                    agentSig:   { type: 'string', description: 'EIP-712 SealerAction signature proving wallet ownership' },
                    agentNonce: { type: 'string', description: 'Unix timestamp (seconds) used when signing — valid 5 minutes' },
                    statement:  { type: 'string', description: 'Statement text' },
                    imageUrl:   { type: 'string', description: 'Image URL (optional, HTTPS only)' },
                    theme:      { type: 'string', description: 'Visual theme' },
                    name:       { type: 'string', description: 'Agent name (for sid)' },
                    entityType: { type: 'string', enum: ['AI_AGENT', 'HUMAN', 'UNKNOWN'] },
                    handle:     { type: 'string', description: 'Handle e.g. aria.agent (for sid)' },
                    chain:      { type: 'string', enum: ['Base', 'Solana'] },
                  },
                },
              },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  description: 'Same fields as JSON plus optional "file" for image attachment',
                  properties: {
                    file: { type: 'string', format: 'binary', description: 'Image file — png, jpg, webp, gif, max 5MB. Included in product price.' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Attestation issued successfully', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, txHash: { type: 'string' }, uid: { type: 'string' }, permalink: { type: 'string' }, nftTxHash: { type: 'string' } } } } } },
            '401': { description: 'Wallet ownership verification failed — response includes signingPayload' },
            '402': { description: 'Payment Required' },
          },
          'x-payment-info': {
            protocols:   ['x402'],
            pricingMode: 'range',
            minPrice:    '0.10',
            maxPrice:    '0.20',
          },
          'x-bazaar': {
            schema: {
              properties: {
                input: {
                  type:       'object',
                  required:   ['format', 'agentId', 'agentSig', 'agentNonce'],
                  properties: {
                    format:     { type: 'string', enum: ['statement', 'card', 'sleeve', 'sid'] },
                    agentId:    { type: 'string' },
                    agentSig:   { type: 'string' },
                    agentNonce: { type: 'string' },
                    statement:  { type: 'string' },
                    theme:      { type: 'string' },
                    imageUrl:   { type: 'string' },
                    name:       { type: 'string' },
                    entityType: { type: 'string' },
                    handle:     { type: 'string' },
                  },
                },
                output: {
                  type:       'object',
                  properties: {
                    status:    { type: 'string' },
                    txHash:    { type: 'string' },
                    uid:       { type: 'string' },
                    permalink: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      '/api/attest-commitment': {
        post: {
          summary:     'Post an onchain SMART commitment',
          description: 'Commit to measurable goals onchain with thresholds and a deadline. Certificate issues automatically at verification.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type:       'object',
                  required:   ['agentId', 'agentSig', 'agentNonce', 'claimType', 'commitment', 'metric', 'deadline'],
                  properties: {
                    agentId:    { type: 'string', description: 'Agent wallet address (0x...)' },
                    agentSig:   { type: 'string', description: 'EIP-712 SealerAction signature' },
                    agentNonce: { type: 'string', description: 'Unix timestamp (seconds) used when signing' },
                    claimType:  { type: 'string', enum: ['x402_payment_reliability', 'defi_trading_performance', 'code_software_delivery', 'website_app_delivery'] },
                    commitment: { type: 'string', description: 'SMART commitment statement' },
                    metric:     { type: 'string', description: 'Measurable target description' },
                    deadline:   { type: 'string', description: 'Deadline YYYY-MM-DD' },
                    evidence:   { type: 'string', description: 'Supporting URL (optional)' },
                    theme:      { type: 'string', description: 'Visual theme (optional)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Commitment attested onchain', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, commitmentUid: { type: 'string' }, easTxHash: { type: 'string' }, nftTxHash: { type: 'string' } } } } } },
            '401': { description: 'Wallet ownership verification failed — response includes signingPayload' },
            '402': { description: 'Payment Required' },
          },
          'x-payment-info': {
            protocols:   ['x402'],
            pricingMode: 'fixed',
            price:       '0.50',
          },
          'x-bazaar': {
            schema: {
              properties: {
                input: {
                  type:       'object',
                  required:   ['agentId', 'agentSig', 'agentNonce', 'claimType', 'commitment', 'metric', 'deadline'],
                  properties: {
                    agentId:    { type: 'string' },
                    agentSig:   { type: 'string' },
                    agentNonce: { type: 'string' },
                    claimType:  { type: 'string', enum: ['x402_payment_reliability', 'defi_trading_performance', 'code_software_delivery', 'website_app_delivery'] },
                    commitment: { type: 'string' },
                    metric:     { type: 'string' },
                    deadline:   { type: 'string' },
                    evidence:   { type: 'string' },
                  },
                },
                output: {
                  type:       'object',
                  properties: {
                    success:      { type: 'boolean' },
                    commitmentUid: { type: 'string' },
                    easTxHash:    { type: 'string' },
                    nftTxHash:    { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      '/api/attest-amendment': {
        post: {
          summary:     'Amend an existing commitment',
          description: 'Amend a pending commitment before the 40% window closes. Thresholds can only decrease. One amendment per commitment.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type:       'object',
                  required:   ['agentId', 'agentSig', 'agentNonce', 'commitmentUid', 'newMetric'],
                  properties: {
                    agentId:       { type: 'string', description: 'Agent wallet address (0x...)' },
                    agentSig:      { type: 'string', description: 'EIP-712 SealerAction signature' },
                    agentNonce:    { type: 'string', description: 'Unix timestamp (seconds) used when signing' },
                    commitmentUid: { type: 'string', description: 'Original commitment attestation UID' },
                    newMetric:     { type: 'string', description: 'Updated metric description' },
                    newCommitment: { type: 'string', description: 'Updated commitment statement (optional)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Amendment attested onchain', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, amendUID: { type: 'string' }, amendTxHash: { type: 'string' } } } } } },
            '401': { description: 'Wallet ownership verification failed — response includes signingPayload' },
            '402': { description: 'Payment Required' },
            '409': { description: 'Already amended, or commitment not in pending status' },
            '422': { description: 'Amendment window closed (≥40% elapsed), or threshold increase attempted' },
          },
          'x-payment-info': {
            protocols:   ['x402'],
            pricingMode: 'fixed',
            price:       '0.25',
          },
          'x-bazaar': {
            schema: {
              properties: {
                input: {
                  type:       'object',
                  required:   ['agentId', 'agentSig', 'agentNonce', 'commitmentUid', 'newMetric'],
                  properties: {
                    agentId:       { type: 'string' },
                    agentSig:      { type: 'string' },
                    agentNonce:    { type: 'string' },
                    commitmentUid: { type: 'string' },
                    newMetric:     { type: 'string' },
                  },
                },
                output: {
                  type:       'object',
                  properties: {
                    success:     { type: 'boolean' },
                    amendUID:    { type: 'string' },
                    amendTxHash: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      '/api/mirror/mint': {
        post: {
          summary:     'Mint a soulbound NFT mirror',
          description: 'Mirror any Base, ETH, or Solana NFT into a soulbound onchain credential. Ownership verified cross-chain before mint.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type:       'object',
                  required:   ['originalChain', 'originalTokenId', 'ownerWallet', 'recipientWallet'],
                  properties: {
                    originalChain:    { type: 'string', enum: ['base', 'ethereum', 'solana'] },
                    originalContract: { type: 'string', description: 'NFT contract address (EVM chains)' },
                    originalTokenId:  { type: 'string', description: 'Token ID (EVM) or mint address (Solana)' },
                    ownerWallet:      { type: 'string', description: 'Wallet that owns the original NFT' },
                    recipientWallet:  { type: 'string', description: 'Wallet to receive the Mirror NFT' },
                    targetChain:      { type: 'string', enum: ['Base', 'Solana'], description: 'Chain to mint mirror on (default: Base)' },
                    nftName:          { type: 'string', description: 'Display name for the mirror (optional)' },
                    imageUrl:         { type: 'string', description: 'NFT image URL (optional)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Mirror NFT minted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, mirrorTokenId: { type: 'string' }, txHash: { type: 'string' }, targetChain: { type: 'string' } } } } } },
            '402': { description: 'Payment Required' },
            '403': { description: 'NFT ownership verification failed' },
          },
          'x-payment-info': {
            protocols:   ['x402'],
            pricingMode: 'range',
            minPrice:    '0.30',
            maxPrice:    '0.90',
          },
          'x-bazaar': {
            schema: {
              properties: {
                input: {
                  type:       'object',
                  required:   ['originalChain', 'originalTokenId', 'ownerWallet', 'recipientWallet'],
                  properties: {
                    originalChain:    { type: 'string', enum: ['base', 'ethereum', 'solana'] },
                    originalContract: { type: 'string' },
                    originalTokenId:  { type: 'string' },
                    ownerWallet:      { type: 'string' },
                    recipientWallet:  { type: 'string' },
                    targetChain:      { type: 'string' },
                  },
                },
                output: {
                  type:       'object',
                  properties: {
                    success:       { type: 'boolean' },
                    mirrorTokenId: { type: 'string' },
                    txHash:        { type: 'string' },
                    targetChain:   { type: 'string' },
                  },
                },
              },
            },
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