// src/app/api/attest-commitment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withZauthX402Payment, issueCommitmentAttestation } from '@/lib/zauth';
import { registerPendingAchievement } from '@/lib/verify/register';
import { mintCommitment } from '@/lib/nft';
import type { ClaimType } from '@/lib/verify/types';
import { x402Challenge } from '@/lib/x402';
import { rateLimitRequest } from '@/lib/security';

export const runtime = 'nodejs';

// $0.50 covers commitment NFT + future certificate mint — one payment, full lifecycle
const COMMITMENT_PRICE = '0.50';

const VALID_CLAIM_TYPES: ClaimType[] = [
  'x402_payment_reliability',
  'defi_trading_performance',
  'code_software_delivery',
  'website_app_delivery',
  // 'social_media_growth' — temporarily disabled, coming soon as a full category
];

export async function POST(req: NextRequest) {
  // ── SECURITY: Rate limiting ──────────────────────────────────────────────
  // 5 commitment requests per hour per IP (tighter than attest — higher cost action)
  const rateLimited = await rateLimitRequest(req, 'attest-commitment', 5, 3600);
  if (rateLimited) return rateLimited;

  return withZauthX402Payment(req, async (paymentChain: 'base' | 'solana' | undefined) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // ── Validate required fields ──────────────────────────────────────────
    const commitment        = (body.commitment as string)?.trim();
    const agentId           = (body.agentId   as string)?.trim();
    const claimType         = (body.claimType as string)?.trim();
    const deadline          = (body.deadline  as string)?.trim();
    const metric            = (body.metric    as string)?.trim();
    const evidence          = (body.evidence  as string)?.trim() || '';
    const theme             = (body.theme     as string)?.trim() || 'dark';
    const difficultyVersion = Number(body.difficultyVersion) || 1;

    if (!commitment || commitment.length < 10) {
      return NextResponse.json({ error: 'commitment is required (min 10 chars)' }, { status: 400 });
    }
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }
    if (!claimType || !VALID_CLAIM_TYPES.includes(claimType as ClaimType)) {
      return NextResponse.json(
        { error: `claimType must be one of: ${VALID_CLAIM_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
    if (!deadline) {
      return NextResponse.json({ error: 'deadline is required (YYYY-MM-DD)' }, { status: 400 });
    }
    if (!metric) {
      return NextResponse.json({ error: 'metric is required' }, { status: 400 });
    }

    const walletAddress = agentId.startsWith('0x')
      ? agentId as `0x${string}`
      : '0x0000000000000000000000000000000000000000' as `0x${string}`;

    // ── Parse deadline → windowDays + unix timestamp ──────────────────────
    const deadlineDate = parseDeadline(deadline);
    const deadlineUnix = Math.floor(deadlineDate.getTime() / 1000);
    const nowUnix      = Math.floor(Date.now() / 1000);
    const windowDays   = body.windowDays
      ? Number(body.windowDays)
      : Math.max(1, Math.ceil((deadlineUnix - nowUnix) / 86400));

    // ── EAS commitment attestation ────────────────────────────────────────
    let easTxHash:    string;
    let commitmentUid: string;
    try {
      const receipt = await issueCommitmentAttestation({
        agentId:           walletAddress,
        claimType:         claimType as ClaimType,
        metric,
        evidence,
        deadline:          BigInt(deadlineUnix),
        difficultyVersion: difficultyVersion as 1,
      });
      easTxHash     = receipt.transactionHash;
      commitmentUid = receipt.uid;
    } catch (err) {
      console.error('[attest-commitment] EAS attestation failed:', err);
      return NextResponse.json(
        { error: 'EAS commitment attestation failed', details: String(err) },
        { status: 500 },
      );
    }

    // ── Mint commitment NFT ───────────────────────────────────────────────
    const baseUrl  = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
    const tokenUri = `${baseUrl}/api/commitment?uid=${commitmentUid}&theme=${theme}`;

    let nftTxHash: string;
    let tokenId:   bigint;
    try {
      const nft = await mintCommitment(
        walletAddress,
        easTxHash,
        claimType,
        deadlineUnix,
        commitmentUid,
      );
      nftTxHash = nft.txHash;
      tokenId   = nft.tokenId;
    } catch (err) {
      console.error('[attest-commitment] NFT mint failed:', err);
      return NextResponse.json(
        { error: 'Commitment NFT mint failed', details: String(err) },
        { status: 500 },
      );
    }

    // ── Register pending achievement in Redis ─────────────────────────────
    try {
      await registerPendingAchievement({
        attestationUID:     commitmentUid,
        subject:            agentId,
        claimType:          claimType as ClaimType,
        statement:          commitment,
        windowDays,
        verificationParams: JSON.stringify({
          ...extractVerificationParams(body, claimType),
          agentWallet: agentId,
          windowDays,
          deadline:    deadlineUnix,
        }),
      });
    } catch (err) {
      // Non-fatal — cron can recover
      console.error('[attest-commitment] Redis registration failed (non-fatal):', err);
    }

    // ── Response ──────────────────────────────────────────────────────────
    return NextResponse.json({
      success:        true,
      commitmentUid,
      easTxHash,
      nftTxHash,
      tokenId:        tokenId.toString(),
      tokenUri,
      commitment,
      claimType,
      metric,
      evidence,
      deadline:       deadlineDate.toISOString(),
      windowDays,
      agentId,
      paymentChain:   paymentChain || 'base',
      easExplorer:    `https://base.easscan.org/attestation/view/${commitmentUid}`,
      message:        'Commitment sealed onchain. Certificate will be issued after verification.',
      verifyEndpoint: `/api/verify/${claimType}`,
    });
  }, COMMITMENT_PRICE, {
  schema: { properties: {
    input: { properties: { body: { type: 'object', required: ['agentId','claimType','commitment','metric','deadline'], properties: { agentId: { type: 'string' }, claimType: { type: 'string' }, commitment: { type: 'string' }, metric: { type: 'string' }, deadline: { type: 'string' } } } } },
    output: { properties: { example: { status: 'success', commitmentUID: '0xabc', txHash: '0xdef', permalink: 'https://thesealer.xyz/c/abc123' } } },
  } },
});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDeadline(deadline: string): Date {
  const d = new Date(deadline);
  if (!isNaN(d.getTime())) return d;
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 30);
  return fallback;
}

function extractVerificationParams(
  body:      Record<string, unknown>,
  claimType: string,
): Record<string, unknown> {
  const common = { windowDays: body.windowDays };

  switch (claimType) {
    case 'x402_payment_reliability':
      return {
        ...common,
        agentWallet:               body.agentWallet || body.agentId,
        minSuccessRate:            body.minSuccessRate,
        minTotalUSD:               body.minTotalUSD,
        requireDistinctRecipients: body.requireDistinctRecipients,
        maxGapHours:               body.maxGapHours,
      };

    case 'defi_trading_performance':
      return {
        ...common,
        chain:         body.chain ?? 'base',
        protocol:      body.protocol,
        agentWallet:   body.agentWallet || body.agentId,
        minTradeCount: body.minTradeCount,
        minVolumeUSD:  body.minVolumeUSD,
        minPnlPercent: body.minPnlPercent,
        maxDrawdownPct: body.maxDrawdownPct,
      };

    case 'code_software_delivery':
      return {
        ...common,
        repoOwner:       body.repoOwner,
        repoName:        body.repoName,
        githubUsername:  body.githubUsername,
        walletGithubSig: body.walletGithubSig,
        minMergedPRs:    body.minMergedPRs,
        minCommits:      body.minCommits,
        requireCIPass:   body.requireCIPass,
        minLinesChanged: body.minLinesChanged,
      };

    case 'website_app_delivery':
      return {
        ...common,
        url:                body.url,
        dnsVerifyRecord:    body.dnsVerifyRecord,
        requireDnsVerify:   body.requireDnsVerify,
        minPerformanceScore: body.minPerformanceScore,
        minAccessibility:   body.minAccessibility,
      };

    case 'social_media_growth':
      return {
        ...common,
        platform:          body.platform,
        handle:            body.handle,
        fid:               body.fid,
        baselineFollowers: body.baselineFollowers,
        minFollowerGrowth: body.minFollowerGrowth,
        minEngagementRate: body.minEngagementRate,
        minPostsPerWeek:   body.minPostsPerWeek,
      };

    default:
      return common;
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/attest-commitment',
    description: 'Commit to a measurable onchain goal — get certified when achieved',
    docs: 'https://thesealer.xyz/api/infoproducts',
    x402: true,
    price: '$0.50 USDC',
    networks: ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    params: {
      agentId: 'your wallet address',
      claimType: 'github | defi_base | defi_solana | website | x402',
      metric: 'measurable goal description',
      deadline: 'unix timestamp',
    },
  });
}