// src/app/api/attest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withX402Payment, issueSealAttestation, issueIdentityAttestation } from '@/lib/x402';
import { checkEntityType } from '@/lib/agentRegistry';
import { snapshotSVG } from '@/lib/snapshot';
import { mintBadge, mintCard, mintOrRenewSealerID, mintSealed } from '@/lib/nft';
import { nanoid } from 'nanoid';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const format = body.format || 'card';
  const price  = format === 'badge'  ? '0.05'
               : format === 'sealed' ? '0.15'
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

        // EAS attestation
        const receipt = await issueIdentityAttestation(name, entityType, chain, imageUrl);
        const txHash  = receipt.transactionHash;

        const sidParams = new URLSearchParams({
          agentId,
          name,
          entityType,
          chain,
          theme,
          txHash,
          ...(imageUrl  ? { imageUrl }  : {}),
          ...(owner     ? { owner }     : {}),
          ...(llm       ? { llm }       : {}),
          ...(social    ? { social }    : {}),
          ...(tags      ? { tags }      : {}),
          ...(firstSeen ? { firstSeen } : {}),
        });

        const sidUrl   = `${baseUrl}/api/sid?${sidParams}`;
        const permalink = `${baseUrl}/c/${uid}`;

        // NFT mint (non-fatal)
        let nftTxHash: string | null = null;
        let tokenId: bigint | null = null;
        let nftRenewed = false;
        try {
          const nft = await mintOrRenewSealerID(walletAddress, sidUrl, txHash);
          nftTxHash  = nft.txHash;
          tokenId    = nft.tokenId;
          nftRenewed = nft.renewed;
          console.log(`[attest] SID NFT ${nftRenewed ? 'renewed' : 'minted'}: ${nftTxHash}`);
        } catch (err) {
          console.warn('[attest] SID NFT mint failed (non-fatal):', err);
        }

        // Snapshot (non-fatal)
        try {
          const svgRes = await fetch(sidUrl);
          if (svgRes.ok) {
            const svgContent = await svgRes.text();
            await snapshotSVG({
              uid,
              product:        'sid',
              svgContent,
              attestationUID: txHash,
              paymentChain:   paymentSource,
            });
          }
        } catch (err) {
          console.warn('[attest] SID snapshot failed (non-fatal):', err);
        }

        return NextResponse.json({
          status:           'success',
          message:          nftRenewed ? 'Sealer ID renewed onchain.' : 'Sealer ID sealed onchain.',
          name,
          entityType,
          chain,
          agentId,
          format,
          uid,
          txHash,
          nftTxHash,
          tokenId:          tokenId?.toString() ?? null,
          nftRenewed,
          nftContract:      process.env.SEALER_ID_CONTRACT_ADDRESS,
          attestationChain: 'Base',
          paymentChain:     paymentSource,
          easExplorer:      `https://base.easscan.org/attestation/view/${txHash}`,
          permalink,
          sidUrl,
          date: new Date().toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }),
        });
      }

      // ── Statement flow (badge / card / sealed) ──────────────────────────
      const statement        = body.statement?.trim() || 'Agent statement (no description provided)';
      const uploadedImg      = body.uploadedImg || null;
      const attestationChain = 'Base';
      const entityType       = await checkEntityType(walletAddress);

      // EAS attestation
      const receipt = await issueSealAttestation(statement);
      const txHash  = receipt.transactionHash;

      const attestParams = new URLSearchParams({
        statement,
        theme,
        agentId,
        txHash,
        chain: attestationChain,
        entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      const sealedParams = new URLSearchParams({
        statement,
        theme,
        agentId,
        txHash,
        chain: paymentSource,
        entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      const cardUrl        = `${baseUrl}/api/card?${attestParams}`;
      const badgeUrl       = `${baseUrl}/api/badge?${attestParams}`;
      const sealedUrl      = `${baseUrl}/api/sealed?${sealedParams}`;
      const cardPermalink  = `${baseUrl}/api/card?uid=${txHash}&theme=${theme}`;
      const badgePermalink = `${baseUrl}/api/badge?uid=${txHash}&theme=${theme}`;
      const permalink      = `${baseUrl}/c/${uid}`;

      // NFT mint (non-fatal)
      let nftTxHash: string | null = null;
      let tokenId: bigint | null = null;
      try {
        if (format === 'badge') {
          const nft = await mintBadge(walletAddress, badgeUrl, txHash);
          nftTxHash = nft.txHash;
          tokenId   = nft.tokenId;
        } else if (format === 'sealed') {
          const nft = await mintSealed(walletAddress, sealedUrl, txHash, paymentSource);
          nftTxHash = nft.txHash;
          tokenId   = nft.tokenId;
        } else {
          // card (default)
          const nft = await mintCard(walletAddress, cardUrl, txHash);
          nftTxHash = nft.txHash;
          tokenId   = nft.tokenId;
        }
        console.log(`[attest] ${format} NFT minted: ${nftTxHash}`);
      } catch (err) {
        console.warn(`[attest] ${format} NFT mint failed (non-fatal):`, err);
      }

      // Snapshot (non-fatal)
      try {
        const svgRoute    = format === 'badge' ? 'badge' : format === 'sealed' ? 'sealed' : 'card';
        const svgParams   = format === 'sealed' ? sealedParams : attestParams;
        const svgFetchUrl = `${baseUrl}/api/${svgRoute}?${svgParams}`;

        const svgRes = await fetch(svgFetchUrl);
        if (svgRes.ok) {
          const svgContent = await svgRes.text();
          await snapshotSVG({
            uid,
            product:        svgRoute as 'badge' | 'card' | 'sealed' | 'sid',
            svgContent,
            attestationUID: txHash,
            paymentChain:   paymentSource,
          });
        } else {
          console.warn('[attest] SVG fetch failed:', svgRes.status);
        }
      } catch (err) {
        console.warn('[attest] Snapshot failed (non-fatal):', err);
      }

      return NextResponse.json({
        status:           'success',
        message:          'Statement sealed onchain.',
        statement,
        theme,
        agentId,
        entityType,
        format,
        uid,
        txHash,
        nftTxHash,
        tokenId:          tokenId?.toString() ?? null,
        nftContract:      format === 'sealed'
                            ? process.env.SEALED_CONTRACT_ADDRESS
                            : process.env.STATEMENT_CONTRACT_ADDRESS,
        attestationChain,
        paymentChain:     paymentSource,
        easExplorer:      `https://base.easscan.org/attestation/view/${txHash}`,
        permalink,
        cardUrl,
        badgeUrl,
        sealedUrl,
        cardPermalink,
        badgePermalink,
        date: new Date().toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        }),
      });

    } catch (error: any) {
      console.error('[The Sealer] Attestation error:', error);
      return NextResponse.json(
        { error: 'Failed to issue attestation' },
        { status: 500 }
      );
    }
  }, price);
}
