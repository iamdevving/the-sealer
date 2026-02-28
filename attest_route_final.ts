// src/app/api/attest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withX402Payment, issueSealAttestation } from '@/lib/x402';
import { checkEntityType } from '@/lib/agentRegistry';

export async function POST(req: NextRequest) {
  // Parse body ONCE upfront — req.json() can only be called once per request
  // We need format before withX402Payment so the correct price is charged
  const body = await req.json();
  const format = body.format || 'card'; // 'badge' | 'card' | 'sealed'
  const price  = format === 'badge'  ? '0.05'
               : format === 'sealed' ? '0.15'
               : '0.10'; // card default

  return withX402Payment(req, async () => {
    try {
      const achievement = body.achievement?.trim() || 'Agent achievement (no description provided)';
      const theme       = body.theme || 'circuit-anim';
      const agentId     = body.agentId || req.headers.get('X-WALLET') || '????';
      const uploadedImg = body.uploadedImg || null;
      const chain       = body.chain || 'Base';

      // ERC-8004 registry check
      const walletAddress = agentId.startsWith('0x') ? agentId : '0x0000000000000000000000000000000000000000';
      const entityType = await checkEntityType(walletAddress);

      const receipt = await issueSealAttestation(achievement);
      const txHash  = receipt.transactionHash;

      const baseUrl = new URL(req.url).origin;
      const params = new URLSearchParams({
        achievement,
        theme,
        agentId,
        txHash,
        chain,
        entityType,
        ...(uploadedImg ? { uploadedImg } : {}),
      });

      const cardUrl        = `${baseUrl}/api/card?${params.toString()}`;
      const badgeUrl       = `${baseUrl}/api/badge?${params.toString()}`;
      const cardPermalink  = `${baseUrl}/api/card?uid=${txHash}&theme=${theme}`;
      const badgePermalink = `${baseUrl}/api/badge?uid=${txHash}&theme=${theme}`;

      return NextResponse.json({
        status:        'success',
        message:       'Statement sealed onchain.',
        achievement,
        theme,
        agentId,
        entityType,
        format,
        txHash,
        easExplorer:   `https://base-sepolia.easscan.org/attestation/view/${txHash}`,
        cardUrl,
        badgeUrl,
        cardPermalink,
        badgePermalink,
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      });

    } catch (error: any) {
      console.error('[The Sealer] Error:', error);
      return NextResponse.json({ error: 'Failed to issue attestation' }, { status: 500 });
    }
  }, price); // correct price passed here, determined before the paywall
}
