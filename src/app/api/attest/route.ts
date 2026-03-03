// src/app/api/attest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withX402Payment, issueSealAttestation } from '@/lib/x402';
import { checkEntityType } from '@/lib/agentRegistry';
import { snapshotSVG } from '@/lib/snapshot';
import { nanoid } from 'nanoid';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const format = body.format || 'card';
  const price  = format === 'badge'  ? '0.05'
               : format === 'sealed' ? '0.15'
               : '0.10';

  return withX402Payment(req, async (paymentChain) => {
    try {
      const achievement  = body.achievement?.trim() || 'Agent achievement (no description provided)';
      const theme        = body.theme || 'circuit-anim';
      const agentId      = body.agentId || req.headers.get('X-WALLET') || '????';
      const uploadedImg  = body.uploadedImg || null;

      const attestationChain = 'Base';
      const paymentSource = paymentChain === 'solana' ? 'Solana' : 'Base';

      const walletAddress = agentId.startsWith('0x')
        ? agentId
        : '0x0000000000000000000000000000000000000000';
      const entityType = await checkEntityType(walletAddress);

      const receipt = await issueSealAttestation(achievement);
      const txHash  = receipt.transactionHash;

      const baseUrl = new URL(req.url).origin;
      const uid = nanoid(12);

      const attestParams = new URLSearchParams({
        achievement,
        theme,
        agentId,
        txHash,
        chain: attestationChain,
        entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      const sealedParams = new URLSearchParams({
        achievement,
        theme,
        agentId,
        txHash,
        chain: paymentSource,
        entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      // ── Snapshot SVG to Blob + Redis (non-fatal) ──────────────────────
      try {
        const svgRoute = format === 'badge' ? 'badge'
                       : format === 'sealed' ? 'sealed'
                       : format === 'sid' ? 'sid'
                       : 'card';

        const svgParams = format === 'sealed' ? sealedParams : attestParams;
        const svgFetchUrl = `${baseUrl}/api/${svgRoute}?${svgParams}`;

        const svgRes = await fetch(svgFetchUrl);
        if (svgRes.ok) {
          const svgContent = await svgRes.text();
          await snapshotSVG({
            uid,
            product: svgRoute as 'badge' | 'card' | 'sealed' | 'sid',
            svgContent,
            attestationUID: txHash,
            paymentChain: paymentSource,
          });
        } else {
          console.warn('[attest] SVG fetch failed:', svgRes.status);
        }
      } catch (err) {
        // Snapshot failure is non-fatal — mint still succeeds
        console.warn('[attest] Snapshot failed (non-fatal):', err);
      }
      // ─────────────────────────────────────────────────────────────────

      const cardUrl        = `${baseUrl}/api/card?${attestParams}`;
      const badgeUrl       = `${baseUrl}/api/badge?${attestParams}`;
      const sealedUrl      = `${baseUrl}/api/sealed?${sealedParams}`;
      const cardPermalink  = `${baseUrl}/api/card?uid=${txHash}&theme=${theme}`;
      const badgePermalink = `${baseUrl}/api/badge?uid=${txHash}&theme=${theme}`;
      const permalink      = `${baseUrl}/c/${uid}`;

      return NextResponse.json({
        status:           'success',
        message:          'Statement sealed onchain.',
        achievement,
        theme,
        agentId,
        entityType,
        format,
        uid,
        txHash,
        attestationChain,
        paymentChain:     paymentSource,
        easExplorer:      `https://base-sepolia.easscan.org/attestation/view/${txHash}`,
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