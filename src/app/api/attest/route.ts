// src/app/api/attest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withX402Payment, issueSealAttestation, issueIdentityAttestation } from '@/lib/x402';
import { checkEntityType } from '@/lib/agentRegistry';
import { snapshotSVG } from '@/lib/snapshot';
import { mintBadge, mintCard, mintSID, renewSID, mintSleeve } from '@/lib/nft';
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { Redis } from '@upstash/redis';
import { nanoid } from 'nanoid';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const HANDLE_REGEX = /^[a-z0-9][a-z0-9.\-]{1,30}[a-z0-9]$/;

async function claimHandle(handle: string, walletAddress: string): Promise<void> {
  // Free old handle if wallet already had one
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

export async function POST(req: NextRequest) {
  const body   = await req.json();
  const format = body.format || 'card';

  // Badge is closed as a standalone product — reserved for the post-launch achievement layer.
  // Existing attestation permalinks at /api/badge?uid=... continue to render (GET route is live).
  // New mints are blocked with 410 Gone.
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
      { status: 410 }
    );
  }

  const price = format === 'sleeve' ? '0.15'
              : format === 'sid'    ? '0.15'
              : '0.10';

  return withX402Payment(req, async (paymentChain) => {
    try {
      const theme         = body.theme || 'dark';
      const agentId       = body.agentId || req.headers.get('X-WALLET') || '????';
      const paymentSource = paymentChain === 'solana' ? 'Solana' : 'Base';

      const walletAddress = agentId.startsWith('0x')
        ? agentId as `0x${string}`
        : '0x0000000000000000000000000000000000000000' as `0x${string}`;

      const baseUrl = new URL(req.url).origin;
      const uid     = nanoid(12);

      // ── SID flow ────────────────────────────────────────────────────────
      if (format === 'sid') {
        const name       = body.name?.trim()       || 'UNNAMED AGENT';
        const entityType = body.entityType?.trim() || 'UNKNOWN';
        const chain      = body.chain?.trim()      || 'Base';
        const imageUrl   = body.imageUrl?.trim()   || '';
        const owner      = body.owner?.trim()      || '';
        const llm        = body.llm?.trim()        || '';
        const social     = body.social?.trim()     || '';
        const tags       = body.tags?.trim()       || '';
        const firstSeen  = body.firstSeen?.trim()  || '';
        const handle     = body.handle?.trim().toLowerCase() || '';

        // Validate handle if provided
        if (handle && !HANDLE_REGEX.test(handle)) {
          return NextResponse.json({ error: 'Invalid handle format. Use 3-32 chars, lowercase letters, numbers, dots and hyphens only.' }, { status: 400 });
        }

        // Check handle availability if provided
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

        // Claim handle in Redis if provided
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
          nftContract:      process.env.SEALER_ID_CONTRACT_ADDRESS,
          attestationChain: 'Base',
          paymentChain:     paymentSource,
          easExplorer:      `https://base.easscan.org/attestation/view/${txHash}`,
          permalink,
          sidUrl,
          date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        });
      }

      // ── Statement flow (card / sleeve / statement) ──────────────────────
      const statement        = body.statement?.trim() || 'Agent statement (no description provided)';
      const uploadedImg      = body.uploadedImg || null;
      const attestationChain = 'Base';
      const entityType       = await checkEntityType(walletAddress);

      const receipt = await issueSealAttestation(statement);
      const txHash  = receipt.transactionHash;

      const attestParams = new URLSearchParams({
        statement, theme, agentId, txHash,
        chain: attestationChain, entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      const sleeveParams = new URLSearchParams({
        statement, theme, agentId, txHash,
        chain: paymentSource, entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
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
  }, price);
}