// src/app/api/attest-commitment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withX402Payment } from '@/lib/x402';
import { registerPendingAchievement } from '@/lib/verify/register';
import { mintBadge } from '@/lib/nft';
import type { ClaimType } from '@/lib/verify/types';

export const runtime = 'nodejs';

// Combined price covers: commitment mint + future achievement mint
const COMMITMENT_PRICE = '0.20';

/**
 * POST /api/attest-commitment
 *
 * Body (JSON):
 * {
 *   commitment: string      — the SMART goal statement (required)
 *   agentId:   string      — wallet address of agent/human (required)
 *   claimType: string      — 'x402_payment_reliability' | 'defi_trading_performance' | 'code_software_delivery' | 'website_app_delivery' | 'social_media_growth'
 *   deadline:  string      — ISO date string or human date, e.g. "2025-12-31" (required)
 *   metric:    string      — measurable target, e.g. "95% success rate over 30 days" (required)
 *   theme:     string      — badge/card theme key (optional, default 'circuit-anim')
 *
 *   // Per-claimType verification params (all optional, used to pre-fill PendingAchievement)
 *   // x402:
 *   agentWallet:          string
 *   minSuccessRate:       number
 *   minTotalUSD:          number
 *   requireDistinctRecipients: boolean
 *   maxGapHours:          number
 *   windowDays:           number
 *
 *   // defi_pnl:
 *   protocol:             string
 *   chain:                string
 *   minCollateral:        number
 *   minTradeCount:        number
 *   maxDrawdown:          number
 *   target:               number
 *
 *   // github_delivery:
 *   repoUrl:              string
 *   githubUsername:       string
 *   walletGithubSig:      string
 *   targetCount:          number
 *   requireCIPass:        boolean
 *   minDiffLinesPerPR:    number
 *
 *   // website_delivery:
 *   url:                  string
 *   dnsVerifyRecord:      string
 *   lighthouseMinScore:   number
 *   uptimeMonitorId:      string
 *   uptimeWindowDays:     number
 *   indexedPagesMin:      number
 *
 *   // social_growth:
 *   platform:             string   — 'farcaster' | 'lens'
 *   handle:               string
 *   platformId:           string
 *   baselineFollowers:    number
 *   targetFollowers:      number
 *   minEngagementRate:    number
 *   minPostsPerWeek:      number
 * }
 *
 * Headers:
 *   PAYMENT-SIGNATURE: <base tx hash or solana signature>
 *   X-TEST-PAYMENT: true   (bypass payment in dev)
 */
export async function POST(req: NextRequest) {
  return withX402Payment(req, async (paymentChain) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // ── Validate required fields ──────────────────────────────────────────
    const { commitment, agentId, claimType, deadline, metric, theme } = body as {
      commitment: string;
      agentId:   string;
      claimType: string;
      deadline:  string;
      metric:    string;
      theme?:    string;
    };

    if (!commitment || typeof commitment !== 'string' || commitment.trim().length < 10) {
      return NextResponse.json(
        { error: 'commitment is required (min 10 chars)' },
        { status: 400 }
      );
    }
    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }
    if (!claimType || typeof claimType !== 'string') {
      return NextResponse.json({ error: 'claimType is required' }, { status: 400 });
    }
    if (!deadline || typeof deadline !== 'string') {
      return NextResponse.json({ error: 'deadline is required' }, { status: 400 });
    }
    if (!metric || typeof metric !== 'string') {
      return NextResponse.json({ error: 'metric is required' }, { status: 400 });
    }

    const VALID_CLAIM_TYPES = [
      'x402_payment_reliability',
      'defi_trading_performance',
      'code_software_delivery',
      'website_app_delivery',
      'social_media_growth',
    ];
    if (!VALID_CLAIM_TYPES.includes(claimType)) {
      return NextResponse.json(
        { error: `claimType must be one of: ${VALID_CLAIM_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // ── Build structured statement stored in EAS ──────────────────────────
    // We encode as JSON so the verifier can reconstruct all params from EAS alone
    const structuredStatement = JSON.stringify({
      commitment: commitment.trim(),
      claimType,
      deadline,
      metric,
      agentId,
      // Pass through all verificationParams from body
      verificationParams: extractVerificationParams(body, claimType),
    });

    // ── Mint the commitment NFT (Badge, productType=0) ────────────────────
    // This reuses the existing mintBadge function — same contract, same mint
    // The SVG URI points to /api/commitment with the theme and statement
    const themeKey  = (theme as string) || 'circuit-anim';
    const safeCommitment = encodeURIComponent(commitment.trim().slice(0, 200));
    const safeDeadline   = encodeURIComponent(deadline);
    const safeMetric     = encodeURIComponent(metric.slice(0, 80));
    const safeAgentId    = encodeURIComponent(agentId.slice(0, 10));

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
    const imageUri = `${baseUrl}/api/commitment?commitment=${safeCommitment}&deadline=${safeDeadline}&metric=${safeMetric}&agentId=${safeAgentId}&theme=${themeKey}`;

    let mintReceipt: Awaited<ReturnType<typeof mintBadge>>;
    try {
      mintReceipt = await mintBadge(
        agentId as `0x${string}`,
        imageUri,
        '',                   // attestationTx — empty at mint time, filled by EAS later
        structuredStatement,  // statement — stored as NFT description
      );
    } catch (err: unknown) {
      console.error('[attest-commitment] Mint failed:', err);
      return NextResponse.json(
        { error: 'Commitment mint failed', details: String(err) },
        { status: 500 }
      );
    }

    const txHash       = mintReceipt.txHash;
    const attestTxHash = txHash;

    // ── Register pending achievement in Redis ─────────────────────────────
    // The verifier will check this periodically via cron or manual trigger
    const deadlineDate = parseDeadline(deadline);
    const windowDays   = body.windowDays ? Number(body.windowDays) : 30;

    try {
      await registerPendingAchievement({
        attestationUID:     txHash,
        subject:            agentId,
        claimType:          claimType as ClaimType,
        statement:          commitment.trim(),
        windowDays,
        verificationParams: JSON.stringify(extractVerificationParams(body, claimType)),
      });
    } catch (err: unknown) {
      // Non-fatal — log and continue. The cron can pick it up later.
      console.error('[attest-commitment] Redis registration failed:', err);
    }

    // ── Build SVG URIs for response ───────────────────────────────────────
    const permanentImageUri = `${baseUrl}/api/commitment?uid=${txHash}&theme=${themeKey}`;

    return NextResponse.json({
      success:           true,
      txHash,
      attestationTxHash: attestTxHash,
      imageUri:          permanentImageUri,
      commitment:        commitment.trim(),
      claimType,
      deadline,
      metric,
      agentId,
      paymentChain:      paymentChain || 'base',
      message:           'Commitment minted. Achievement verification will begin automatically.',
      verificationNote:  `Your achievement will be verified by ${deadlineDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. You can also trigger verification manually via POST /api/verify/${claimType.replace('_', '/')}.`,
    });
  }, COMMITMENT_PRICE);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDeadline(deadline: string): Date {
  const d = new Date(deadline);
  if (!isNaN(d.getTime())) return d;
  // Fallback: 30 days from now
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 30);
  return fallback;
}

function extractVerificationParams(
  body: Record<string, unknown>,
  claimType: string,
): Record<string, unknown> {
  // Pull only the fields relevant to this claimType
  const common = {
    windowDays: body.windowDays,
  };

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
        protocol:      body.protocol,
        chain:         body.chain,
        walletAddress: body.agentWallet || body.agentId,
        metric:        body.metric,
        target:        body.target,
        minCollateral: body.minCollateral,
        minTradeCount: body.minTradeCount,
        maxDrawdown:   body.maxDrawdown,
      };

    case 'code_software_delivery':
      return {
        ...common,
        repoUrl:           body.repoUrl,
        githubUsername:    body.githubUsername,
        walletGithubSig:   body.walletGithubSig,
        metric:            body.metric,
        targetCount:       body.targetCount,
        requireCIPass:     body.requireCIPass,
        minDiffLinesPerPR: body.minDiffLinesPerPR,
      };

    case 'website_app_delivery':
      return {
        ...common,
        url:                body.url,
        dnsVerifyRecord:    body.dnsVerifyRecord,
        lighthouseMinScore: body.lighthouseMinScore,
        uptimeMonitorId:    body.uptimeMonitorId,
        uptimeWindowDays:   body.uptimeWindowDays,
        indexedPagesMin:    body.indexedPagesMin,
        mintTimestamp:      new Date().toISOString(),
      };

    case 'social_media_growth':
      return {
        ...common,
        platform:          body.platform,
        handle:            body.handle,
        platformId:        body.platformId,
        baselineFollowers: body.baselineFollowers,
        targetFollowers:   body.targetFollowers,
        minEngagementRate: body.minEngagementRate,
        minPostsPerWeek:   body.minPostsPerWeek,
      };

    default:
      return common;
  }
}