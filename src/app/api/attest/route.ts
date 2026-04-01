// src/app/api/attest/route.ts
//
// SECURITY CHANGE: Solana agentId impersonation fix (CRITICAL). — unchanged
// FIX: baseUrl now uses NEXT_PUBLIC_BASE_URL env var — unchanged
// FIX: SID renewal pricing ($0.10 renewal vs $0.20 mint) — unchanged
// NEW: x-internal-key bypass for ACP seller script — skips x402 + rate limiting

import { NextRequest, NextResponse } from 'next/server';
import { withZauthX402Payment, issueSealAttestation, issueIdentityAttestation } from '@/lib/zauth';
import { checkEntityType } from '@/lib/agentRegistry';
import { snapshotSVG } from '@/lib/snapshot';
import { mintCard, mintSID, renewSID, mintSleeve } from '@/lib/nft';
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { Redis } from '@upstash/redis';
import { nanoid } from 'nanoid';
import { put } from '@vercel/blob';
import { x402Challenge } from '@/lib/x402';
import { rateLimitRequest, validateImageUrl } from '@/lib/security';
import { verifyAgentSignature, getSigningPayload } from '@/lib/agentSig';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const HANDLE_REGEX  = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

// ── Solana pubkey validator ───────────────────────────────────────────────────
function isSolanaPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

// ── Parse request body — JSON or multipart ────────────────────────────────────
async function parseBody(req: NextRequest): Promise<{
  fields: Record<string, string>;
  file?: File;
}> {
  const ct = req.headers.get('content-type') || '';

  if (ct.includes('multipart/form-data')) {
    const form   = await req.formData();
    const fields: Record<string, string> = {};
    let file: File | undefined;

    for (const [key, value] of form.entries()) {
      if (key === 'file' && value instanceof File) {
        file = value;
      } else if (typeof value === 'string') {
        fields[key] = value;
      }
    }
    return { fields, file };
  }

  let body: Record<string, any> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) fields[k] = String(v);
  }
  return { fields };
}

// ── Upload a File to Vercel Blob ──────────────────────────────────────────────
async function uploadFileToBlobIfPresent(
  file: File | undefined,
  format: string,
): Promise<string> {
  if (!file) return '';

  if (!ALLOWED_TYPES.has(file.type)) {
    throw Object.assign(
      new Error(`Unsupported image type: ${file.type}. Allowed: png, jpg, webp, gif`),
      { status: 415 },
    );
  }
  if (file.size > MAX_IMG_BYTES) {
    throw Object.assign(
      new Error(`Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max 5MB.`),
      { status: 413 },
    );
  }

  const uid  = nanoid(12);
  const ext  = file.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `uploads/${format}/${uid}.${ext}`;

  const result = await put(path, file, { access: 'public', contentType: file.type });
  console.log(`[attest] Image uploaded to Blob: ${result.url}`);
  return result.url;
}

// ── Handle claim ──────────────────────────────────────────────────────────────
async function claimHandle(handle: string, walletAddress: string): Promise<void> {
  const oldHandle = await redis.get(`sid:wallet:${walletAddress}`) as string | null;
  if (oldHandle && oldHandle !== handle) {
    await redis.del(`sid:handle:${oldHandle}`);
  }
  await Promise.all([
    redis.set(`sid:handle:${handle}`, walletAddress.toLowerCase()),
    redis.set(`sid:wallet:${walletAddress.toLowerCase()}`, handle),
    redis.set(`sid:free_claim_used:${walletAddress.toLowerCase()}`, 'true'),
  ]);
}

// ── Shared handler body ───────────────────────────────────────────────────────
// Extracted so both the x402 path and the internal-key path can call it.
// fields/file are pre-parsed from parseBody() in the POST handler.

async function handleAttestBody(
  req:          NextRequest,
  fields:       Record<string, string>,
  file:         File | undefined,
  rawImageUrl:  string,
  price:        string,
  paymentChain: 'base' | 'solana' | undefined,
): Promise<NextResponse> {
  try {
    const theme         = fields.theme || 'dark';
    const agentId       = fields.agentId || req.headers.get('X-WALLET') || '????';
    const paymentSource = paymentChain === 'solana' ? 'Solana' : 'Base';
    const format        = fields.format || 'card';

    // ── SECURITY: Verify wallet ownership ────────────────────────────────
    if (paymentChain === 'solana') {
      if (agentId.startsWith('0x')) {
        return NextResponse.json(
          {
            error:   'Identity mismatch',
            message: 'Solana payers must pass their Solana public key (base58) as agentId — not an EVM address. ' +
                     'Your Solana payment proves ownership of your Solana wallet, not any EVM wallet.',
            example: { agentId: '<your-solana-pubkey-base58>', format, statement: '...' },
          },
          { status: 400 },
        );
      }
      if (agentId !== '????' && !isSolanaPubkey(agentId)) {
        return NextResponse.json(
          { error: 'Invalid agentId for Solana payment — expected a base58 Solana public key (32-44 chars)' },
          { status: 400 },
        );
      }
      console.log(`[attest] Solana identity verified via payment: ${agentId}`);

    } else {
      // EVM agents must supply an EIP-712 signature (skip for internal callers —
      // internal key proves trust, wallet ownership was verified at commitment mint time)
      if (agentId.startsWith('0x') && paymentChain !== undefined) {
        const agentSig   = fields.agentSig   || req.headers.get('X-AGENT-SIG')   || '';
        const agentNonce = fields.agentNonce  || req.headers.get('X-AGENT-NONCE') || '';

        if (!agentSig || !agentNonce) {
          const nonce = Math.floor(Date.now() / 1000);
          return NextResponse.json(
            {
              error:   'Wallet ownership verification required',
              message: 'EVM agentId requires an EIP-712 signature proving you control the wallet.',
              howToFix: {
                step1: 'Sign the EIP-712 payload with your wallet',
                step2: 'Include agentSig (signature hex) and agentNonce (timestamp used) in your JSON body or as X-AGENT-SIG / X-AGENT-NONCE headers',
              },
              signingPayload: getSigningPayload(agentId, 'attest', nonce),
              exampleNonce:   nonce,
            },
            { status: 401 },
          );
        }

        const sigResult = await verifyAgentSignature(
          agentId,
          'attest',
          Number(agentNonce),
          agentSig,
        );

        if (!sigResult.valid) {
          const nonce = Math.floor(Date.now() / 1000);
          return NextResponse.json(
            {
              error:          'Wallet ownership verification failed',
              reason:         sigResult.reason,
              signingPayload: getSigningPayload(agentId, 'attest', nonce),
              exampleNonce:   nonce,
            },
            { status: 401 },
          );
        }

        console.log(`[attest] Wallet ownership verified for ${agentId}`);
      }
    }

    const walletAddress = agentId.startsWith('0x')
      ? agentId as `0x${string}`
      : '0x0000000000000000000000000000000000000000' as `0x${string}`;

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
    const uid     = nanoid(12);

    // Upload image if file was provided inline
    let imageUrl = rawImageUrl;
    if (file) {
      try {
        imageUrl = await uploadFileToBlobIfPresent(file, format);
      } catch (err: any) {
        return NextResponse.json(
          { error: err.message || 'Image upload failed' },
          { status: err.status || 400 },
        );
      }
    }

    // ── SID flow ──────────────────────────────────────────────────────────
    if (format === 'sid') {
      const name       = fields.name?.trim()       || 'UNNAMED AGENT';
      const entityType = fields.entityType?.trim() || 'UNKNOWN';
      const chain      = fields.chain?.trim()      || 'Base';
      const owner      = fields.owner?.trim()      || '';
      const llm        = fields.llm?.trim()        || '';
      const social     = fields.social?.trim()     || '';
      const tags       = fields.tags?.trim()       || '';
      const firstSeen  = fields.firstSeen?.trim()  || '';
      const handle     = fields.handle?.trim().toLowerCase() || '';

      if (handle && !HANDLE_REGEX.test(handle)) {
        return NextResponse.json(
          { error: 'Invalid handle format. Use 3-32 chars, lowercase letters, numbers, dots and hyphens only.' },
          { status: 400 },
        );
      }

      if (handle) {
        const existing = await redis.get(`sid:handle:${handle}`);
        if (existing && (existing as string).toLowerCase() !== walletAddress.toLowerCase()) {
          return NextResponse.json({ error: 'Handle already taken' }, { status: 409 });
        }
      }

      const receipt = await issueIdentityAttestation(name, entityType, chain, imageUrl, walletAddress);
      const txHash  = receipt.transactionHash;

      const sidParams = new URLSearchParams({
        agentId, name, entityType, chain, theme, txHash,
        ...(imageUrl  ? { imageUrl }  : {}),
        ...(owner     ? { owner }     : {}),
        ...(llm       ? { llm }       : {}),
        ...(social    ? { social }    : {}),
        ...(tags      ? { tags }      : {}),
        ...(firstSeen ? { firstSeen } : {}),
        ...(handle    ? { handle }    : {}),
      });

      const sidUrl    = `${baseUrl}/api/sid?${sidParams}`;
      const permalink = `${baseUrl}/c/${uid}`;

      let nftTxHash: string | null = null;
      let tokenId:   bigint | null = null;
      let nftRenewed = false;

      try {
        const publicClient  = createPublicClient({ chain: base, transport: http(process.env.ALCHEMY_RPC_URL!) });
        const SID_ADDRESS   = process.env.SEALER_ID_CONTRACT_ADDRESS as `0x${string}`;
        const SID_ABI       = parseAbi(['function hasSID(address wallet) view returns (bool)']);
        const alreadyHasSID = await publicClient.readContract({
          address: SID_ADDRESS, abi: SID_ABI, functionName: 'hasSID', args: [walletAddress],
        });

        if (alreadyHasSID) {
          const nft  = await renewSID(walletAddress, sidUrl, txHash);
          nftTxHash  = nft.txHash;
          nftRenewed = true;
        } else {
          const nft = await mintSID(walletAddress, sidUrl, txHash, name, entityType, chain);
          nftTxHash = nft.txHash;
          tokenId   = nft.tokenId;
        }
        console.log(`[attest] SID NFT ${nftRenewed ? 'renewed' : 'minted'}: ${nftTxHash}`);
      } catch (err) {
        console.warn('[attest] SID NFT mint failed (non-fatal):', err);
      }

      if (handle) {
        try {
          await claimHandle(handle, walletAddress);
          console.log(`[attest] Handle claimed: ${handle} → ${walletAddress}`);
        } catch (err) {
          console.warn('[attest] Handle claim failed (non-fatal):', err);
        }
      }

      try {
        const svgRes = await fetch(sidUrl);
        if (svgRes.ok) {
          const svgContent = await svgRes.text();
          await snapshotSVG({ uid, product: 'sid', svgContent, attestationUID: txHash, paymentChain: paymentSource });
        }
      } catch (err) {
        console.warn('[attest] SID snapshot failed (non-fatal):', err);
      }

      return NextResponse.json({
        status:           'success',
        message:          nftRenewed ? 'Sealer ID renewed onchain.' : 'Sealer ID sealed onchain.',
        name, entityType, chain, agentId, format, uid, txHash,
        nftTxHash,
        tokenId:          tokenId?.toString() ?? null,
        nftRenewed,
        handle:           handle || null,
        imageUrl:         imageUrl || null,
        nftContract:      process.env.SEALER_ID_CONTRACT_ADDRESS,
        attestationChain: 'Base',
        paymentChain:     paymentSource,
        easExplorer:      `https://base.easscan.org/attestation/view/${txHash}`,
        permalink,
        sidUrl,
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      });
    }

    // ── Statement / Card / Sleeve flow ────────────────────────────────────
    const statement        = fields.statement?.trim() || 'Agent statement (no description provided)';
    const attestationChain = 'Base';
    const entityType       = await checkEntityType(walletAddress);

    const receipt = await issueSealAttestation(statement);
    const txHash  = receipt.transactionHash;

    const attestParams = new URLSearchParams({
      statement, theme, agentId, txHash,
      chain: attestationChain, entityType,
      ...(imageUrl ? { imageUrl } : {}),
    });

    const sleeveParams = new URLSearchParams({
      statement, theme, agentId, txHash,
      chain: paymentSource, entityType,
      ...(imageUrl ? { imageUrl } : {}),
    });

    const cardUrl       = `${baseUrl}/api/card?${attestParams}`;
    const sleeveUrl     = `${baseUrl}/api/sleeve?${sleeveParams}`;
    const cardPermalink = `${baseUrl}/api/card?uid=${txHash}&theme=${theme}`;
    const permalink     = `${baseUrl}/c/${uid}`;

    let nftTxHash: string | null = null;
    let tokenId:   bigint | null = null;
    try {
      if (format === 'sleeve') {
        const nft = await mintSleeve(walletAddress, sleeveUrl, txHash, paymentSource);
        nftTxHash = nft.txHash; tokenId = nft.tokenId;
      } else {
        const nft = await mintCard(walletAddress, cardUrl, txHash, statement);
        nftTxHash = nft.txHash; tokenId = nft.tokenId;
      }
      console.log(`[attest] ${format} NFT minted: ${nftTxHash}`);
    } catch (err) {
      console.warn(`[attest] ${format} NFT mint failed (non-fatal):`, err);
    }

    try {
      const svgRoute    = format === 'sleeve' ? 'sleeve' : format === 'statement' ? 'statement' : 'card';
      const svgParams   = format === 'sleeve' ? sleeveParams : attestParams;
      const svgFetchUrl = `${baseUrl}/api/${svgRoute}?${svgParams}`;
      const svgRes      = await fetch(svgFetchUrl);
      if (svgRes.ok) {
        const svgContent = await svgRes.text();
        await snapshotSVG({ uid, product: svgRoute as any, svgContent, attestationUID: txHash, paymentChain: paymentSource });
      }
    } catch (err) {
      console.warn('[attest] Snapshot failed (non-fatal):', err);
    }

    return NextResponse.json({
      status:           'success',
      message:          'Statement sealed onchain.',
      statement, theme, agentId, entityType, format, uid, txHash,
      nftTxHash,
      tokenId:          tokenId?.toString() ?? null,
      imageUrl:         imageUrl || null,
      nftContract:      format === 'sleeve'
                          ? process.env.SLEEVE_CONTRACT_ADDRESS
                          : process.env.STATEMENT_CONTRACT_ADDRESS,
      attestationChain,
      paymentChain:     paymentSource,
      easExplorer:      `https://base.easscan.org/attestation/view/${txHash}`,
      permalink,
      cardUrl, sleeveUrl, cardPermalink,
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    });

  } catch (error: any) {
    console.error('[The Sealer] Attestation error:', error);
    return NextResponse.json({ error: 'Failed to issue attestation' }, { status: 500 });
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Internal key check — skip rate limiting for trusted callers ────────────
  const internalKey = req.headers.get('x-internal-key');
  const isInternal  = !!(internalKey && internalKey === process.env.SEALER_INTERNAL_KEY);

  // ── SECURITY: Rate limiting ───────────────────────────────────────────────
  if (!isInternal) {
    const rateLimited = await rateLimitRequest(req, 'attest', 10, 3600);
    if (rateLimited) return rateLimited;
  }

  const { fields, file } = await parseBody(req);
  const format = fields.format || 'card';

  // Badge closed — 410
  if (format === 'badge') {
    return NextResponse.json(
      {
        error:   'Product unavailable',
        message: 'Statement Badge is not available as a standalone product. Badges are earned automatically after a commitment is certified. Use format: "statement" ($0.10) or format: "card" ($0.15) for onchain statements.',
        alternatives: {
          statement:  'POST /api/attest with format: "statement" — text-only credential, $0.10',
          card:       'POST /api/attest with format: "card" — full credential with optional image, $0.15',
          commitment: 'POST /api/attest-commitment — commit onchain, earn certificate + badge on completion, $0.50',
        },
        docs: 'https://thesealer.xyz/api/infoproducts',
      },
      { status: 410 },
    );
  }

  // ── SECURITY: Validate imageUrl against SSRF allowlist ───────────────────
  const rawImageUrl = fields.imageUrl?.trim() || '';
  if (rawImageUrl && !file) {
    const imageValidation = validateImageUrl(rawImageUrl);
    if (!imageValidation.valid) {
      return NextResponse.json(
        { error: 'Invalid imageUrl', message: imageValidation.reason },
        { status: 400 },
      );
    }
  }

  // ── SID renewal pricing: $0.20 mint, $0.10 renewal ───────────────────────
  const sidAgentId  = fields.agentId?.toLowerCase() || '';
  const existingSID = format === 'sid' && sidAgentId
    ? await redis.get(`sid:wallet:${sidAgentId}`)
    : null;

  const price = format === 'sleeve' ? '0.15'
              : format === 'sid'    ? (existingSID ? '0.10' : '0.20')
              : '0.10';

  // ── Internal key bypass (ACP seller script) ───────────────────────────────
  if (isInternal) {
    console.log('[attest] Internal key bypass — skipping x402 payment gate');
    return handleAttestBody(req, fields, file, rawImageUrl, price, undefined);
  }

  return withZauthX402Payment(req, (paymentChain) =>
    handleAttestBody(req, fields, file, rawImageUrl, price, paymentChain),
  price, {
  schema: {
    properties: {
      input: {
        properties: {
          body: {
            type: 'object',
            required: ['format', 'agentId', 'agentSig', 'agentNonce'],
            properties: {
              format:     { type: 'string' },
              agentId:    { type: 'string', description: 'EVM: your 0x wallet. Solana: your base58 public key.' },
              agentSig:   { type: 'string', description: 'EIP-712 signature from your wallet proving ownership (EVM only)' },
              agentNonce: { type: 'string', description: 'Unix timestamp (seconds) used when signing' },
              statement:  { type: 'string' },
              theme:      { type: 'string' },
              imageUrl:   { type: 'string' },
            },
          },
        },
      },
      output: {
        properties: {
          example: {
            status:    'success',
            txHash:    '0xabc',
            uid:       'abc123',
            permalink: 'https://thesealer.xyz/c/abc123',
          },
        },
      },
    },
  },
});
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    endpoint:    'POST /api/attest',
    description: 'Issue onchain attestations — statements, credentials, Sealer IDs',
    docs:        'https://thesealer.xyz/api/infoproducts',
    x402:        true,
    price:       '$0.10–$0.20 USDC',
    networks:    ['eip155:8453 (Base)', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp (Solana)'],
    params: {
      format:     'statement | card | sleeve | sid',
      agentId:    'EVM: your 0x wallet address. Solana: your base58 public key.',
      agentSig:   'EIP-712 signature (EVM wallets only) — sign the SealerAction typed data',
      agentNonce: 'Unix timestamp (seconds) used when signing — valid for 5 minutes',
      statement:  'your statement text (for statement/card/sleeve formats)',
    },
    identityModel: {
      evm:    'agentId = 0x wallet address + EIP-712 signature required',
      solana: 'agentId = your Solana public key (base58) — payment proves ownership',
    },
    eip712: {
      domain: { name: 'SealerProtocol', version: '1', chainId: 8453 },
      types:  { SealerAction: [{ name: 'wallet', type: 'address' }, { name: 'action', type: 'string' }, { name: 'nonce', type: 'uint256' }] },
      message: { wallet: '<agentId>', action: 'attest', nonce: '<unix_timestamp_seconds>' },
    },
  });
}