// src/app/api/attest/route.ts
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

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const HANDLE_REGEX  = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

// ── Parse request body — JSON or multipart ────────────────────────────────────
// Returns { fields, file? } where fields mirrors what body.x would give in JSON mode.
// File is only present when a multipart 'file' field is included.

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

  // Default: JSON
  let body: Record<string, any> = {};
try {
  const text = await req.text();
  if (text) body = JSON.parse(text);
} catch {
  body = {};
}
  // Normalise — convert all values to strings for uniform access below
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) fields[k] = String(v);
  }
  return { fields };
}

// ── Upload a File to Vercel Blob, return permanent public URL ─────────────────

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

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Peek at format before consuming body — need it for price + badge check.
  // For JSON we can't peek without consuming, so we parse once and carry fields forward.
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

  const price = format === 'sleeve' ? '0.15'
              : format === 'sid'    ? '0.20'
              : '0.10';

  return withZauthX402Payment(req, async (paymentChain: 'base' | 'solana' | undefined) => {
    try {
      const theme         = fields.theme || 'dark';
      const agentId       = fields.agentId || req.headers.get('X-WALLET') || '????';
      const paymentSource = paymentChain === 'solana' ? 'Solana' : 'Base';

      const walletAddress = agentId.startsWith('0x')
        ? agentId as `0x${string}`
        : '0x0000000000000000000000000000000000000000' as `0x${string}`;

      const baseUrl = new URL(req.url).origin;
      const uid     = nanoid(12);

      // ── Upload image if file was provided inline ──────────────────────────
      // imageUrl can come from:
      //   a) multipart file field   → uploaded here to Blob
      //   b) imageUrl string field  → passed directly (agent pre-uploaded or has a URL)
      let imageUrl = fields.imageUrl?.trim() || '';
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
  }, price, {
  schema: {
    properties: {
      input: {
        properties: {
          body: {
            type: 'object',
            required: ['format', 'agentId'],
            properties: {
              format:     { type: 'string' },
              agentId:    { type: 'string' },
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
  return x402Challenge(req.url, '0.10', {
    schema: {
      properties: {
        input: {
          properties: {
            body: {
              type:       'object',
              required:   ['format', 'agentId'],
              properties: {
                format:     { type: 'string', enum: ['statement', 'card', 'sleeve', 'sid'] },
                agentId:    { type: 'string' },
                statement:  { type: 'string' },
                theme:      { type: 'string' },
                imageUrl:   { type: 'string' },
                name:       { type: 'string' },
                entityType: { type: 'string' },
                handle:     { type: 'string' },
              },
            },
          },
        },
        output: {
          properties: {
            example: {
              status:    'success',
              txHash:    '0xabc...',
              uid:       'abc123',
              permalink: 'https://thesealer.xyz/c/abc123',
            },
          },
        },
      },
    },
  });
}