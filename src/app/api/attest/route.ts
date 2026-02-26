// src/app/api/attest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withX402Payment, issueSealAttestation } from '@/lib/x402';

export async function POST(req: NextRequest) {
  return withX402Payment(req, async () => {
    try {
      const body = await req.json();

      const achievement = (body.achievement?.trim() || 'Agent achievement (no description provided)').slice(0, 280);
      const theme       = body.theme   || 'circuit-anim';
      const agentId     = body.agentId || '????';
      const chain       = body.chain   || 'Base';
      const uploadedImg = body.uploadedImg || null;

      // Issue on-chain EAS attestation
      const receipt = await issueSealAttestation(achievement);
      const txHash  = receipt.transactionHash;

      // Build permanent card + badge URLs
      const baseUrl = new URL(req.url).origin;
      const params  = new URLSearchParams({
        achievement,
        theme,
        agentId,
        txHash,
        chain,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      const cardUrl  = `${baseUrl}/api/card?${params.toString()}`;
      const badgeUrl = `${baseUrl}/api/badge?${params.toString()}`;

      return NextResponse.json({
        status:      'success',
        message:     '🦭 Seal of Approval issued!',
        achievement,
        theme,
        agentId,
        txHash,
        explorer:    `https://sepolia.basescan.org/tx/${txHash}`,
        easExplorer: `https://base-sepolia.easscan.org/attestation/view/${txHash}`,
        cardUrl,
        badgeUrl,
        date: new Date().toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        }),
      });

    } catch (error: any) {
      console.error('[Seal] Attest error:', error);
      return NextResponse.json(
        { error: 'Failed to issue attestation', details: error?.message ?? String(error) },
        { status: 500 }
      );
    }
  });
}
