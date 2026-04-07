// src/app/api/attest-commitment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withZauthX402Payment, issueCommitmentAttestation } from '@/lib/zauth';
import { registerPendingAchievement } from '@/lib/verify/register';
import { mintCommitment } from '@/lib/nft';
import type { ClaimType } from '@/lib/verify/types';
import { x402Challenge } from '@/lib/x402';
import { rateLimitRequest } from '@/lib/security';
import { verifyAgentSignature, getSigningPayload } from '@/lib/agentSig';
import { snapshotAcpBaseline } from '@/lib/verify/acp-job-delivery';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// $0.50 covers commitment NFT + future certificate mint — one payment, full lifecycle
const COMMITMENT_PRICE = '0.50';

const VALID_CLAIM_TYPES: ClaimType[] = [
  'x402_payment_reliability',
  'defi_trading_performance',
  'code_software_delivery',
  'website_app_delivery',
  'acp_job_delivery',
  'prediction_market_accuracy',
  // 'social_media_growth' — temporarily disabled, coming soon as a full category
];

// ── Shared handler body ───────────────────────────────────────────────────────

async function handleBody(
  req:          NextRequest,
  paymentChain: 'base' | 'solana' | undefined,
): Promise<NextResponse> {
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

  // ── SECURITY: Verify wallet ownership for EVM agentIds ────────────────
  if (agentId.startsWith('0x') && paymentChain !== undefined) {
    const agentSig   = (body.agentSig   as string) || '';
    const agentNonce = (body.agentNonce as string) || '';

    if (!agentSig || !agentNonce) {
      const nonce = Math.floor(Date.now() / 1000);
      return NextResponse.json(
        {
          error:   'Wallet ownership verification required',
          message: 'EVM agentId requires an EIP-712 signature proving you control the wallet.',
          howToFix: {
            step1: 'Sign the EIP-712 payload with your wallet',
            step2: 'Include agentSig (signature hex) and agentNonce (timestamp used) in your JSON body',
          },
          signingPayload: getSigningPayload(agentId, 'attest-commitment', nonce),
          exampleNonce:   nonce,
        },
        { status: 401 },
      );
    }

    const sigResult = await verifyAgentSignature(
      agentId,
      'attest-commitment',
      Number(agentNonce),
      agentSig,
    );

    if (!sigResult.valid) {
      const nonce = Math.floor(Date.now() / 1000);
      return NextResponse.json(
        {
          error:          'Wallet ownership verification failed',
          reason:         sigResult.reason,
          signingPayload: getSigningPayload(agentId, 'attest-commitment', nonce),
          exampleNonce:   nonce,
        },
        { status: 401 },
      );
    }

    console.log(`[attest-commitment] Wallet ownership verified for ${agentId}`);
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

  // ── Duplicate commitment check ────────────────────────────────────────
  // Uses a Redis Set per agent (commitment:active:{agentId}) to avoid
  // full keyspace scans. Checks for identical claimType + thresholds
  // among active (pending/amended) commitments only.
  // Allows same claimType with different thresholds (e.g. two repos).
  try {
    const activeUIDs = await redis.smembers(`commitment:active:${agentId}`);
    if (activeUIDs.length > 0) {
      const newParams      = extractVerificationParams(body, claimType);
      const thresholdKeys  = Object.keys(newParams).filter(k =>
        !['agentWallet', 'windowDays', 'deadline', 'mintBlock', 'acpContractAddress', 'kalshiApiKey'].includes(k)
      );

      for (const uid of activeUIDs) {
        const existing = await redis.get(`achievement:pending:${uid}`) as Record<string, unknown> | null;
        if (!existing) {
          // Stale entry — clean up
          await redis.srem(`commitment:active:${agentId}`, uid);
          continue;
        }
        if (
          existing.claimType === claimType &&
          existing.status !== 'failed' &&
          existing.status !== 'achieved'
        ) {
          const existingParams = JSON.parse(existing.verificationParams as string);
          const isDuplicate    = thresholdKeys.every(k =>
            String(existingParams[k]) === String(newParams[k])
          );
          if (isDuplicate) {
            return NextResponse.json(
              {
                error:       'Duplicate commitment',
                message:     'You already have an active commitment with identical thresholds for this claim type. Amend the existing one or wait for it to close before making another.',
                existingUID: existing.attestationUID,
              },
              { status: 409 },
            );
          }
        }
      }
    }
  } catch (dupErr) {
    // Non-fatal — log and continue rather than blocking a valid commitment
    console.warn('[attest-commitment] Duplicate check failed (non-fatal):', dupErr);
  }

  // ── EAS commitment attestation ────────────────────────────────────────
  let easTxHash:     string;
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
    let acpSnapshot: { acpContractAddress: string; mintBlock: string } | null = null;
    if (claimType === 'acp_job_delivery') {
      try {
        acpSnapshot = await snapshotAcpBaseline(agentId);
        console.log(`[attest-commitment] ACP snapshot — contract: ${acpSnapshot.acpContractAddress}, block: ${acpSnapshot.mintBlock}`);
      } catch (snapErr) {
        console.warn('[attest-commitment] ACP baseline snapshot failed (non-fatal):', snapErr);
      }
    }

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
        ...(acpSnapshot ? {
          acpContractAddress: acpSnapshot.acpContractAddress,
          mintBlock:          acpSnapshot.mintBlock,
        } : {}),
      }),
    });

    // Add to agent's active commitment set for efficient duplicate checking
    await redis.sadd(`commitment:active:${agentId}`, commitmentUid);

  } catch (err) {
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
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key');
  const isInternal  = !!(internalKey && internalKey === process.env.SEALER_INTERNAL_KEY);

  if (!isInternal) {
    const rateLimited = await rateLimitRequest(req, 'attest-commitment', 5, 3600);
    if (rateLimited) return rateLimited;
  }

  if (isInternal) {
    console.log('[attest-commitment] Internal key bypass — skipping x402 payment gate');
    return handleBody(req, undefined);
  }

  return withZauthX402Payment(req, (paymentChain) =>
    handleBody(req, paymentChain),
  COMMITMENT_PRICE, {
  schema: { properties: {
    input: { properties: { body: { type: 'object', required: ['agentId','agentSig','agentNonce','claimType','commitment','metric','deadline'], properties: { agentId: { type: 'string' }, agentSig: { type: 'string' }, agentNonce: { type: 'string' }, claimType: { type: 'string' }, commitment: { type: 'string' }, metric: { type: 'string' }, deadline: { type: 'string' } } } } },
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
        chain:          body.chain ?? 'base',
        protocol:       body.protocol,
        agentWallet:    body.agentWallet || body.agentId,
        minTradeCount:  body.minTradeCount,
        minVolumeUSD:   body.minVolumeUSD,
        minPnlPercent:  body.minPnlPercent,
        maxDrawdownPct: body.maxDrawdownPct,
      };

    case 'code_software_delivery':
      return {
        ...common,
        repoOwner:           body.repoOwner,
        repoName:            body.repoName,
        githubUsername:      body.githubUsername,
        walletGithubSig:     body.walletGithubSig,
        minMergedPRs:        body.minMergedPRs,
        minCommits:          body.minCommits,
        requireCIPass:       body.requireCIPass,
        minLinesChanged:     body.minLinesChanged,
      };

    case 'website_app_delivery':
      return {
        ...common,
        url:                 body.url,
        dnsVerifyRecord:     body.dnsVerifyRecord,
        requireDnsVerify:    body.requireDnsVerify,
        minPerformanceScore: body.minPerformanceScore,
        minAccessibility:    body.minAccessibility,
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

    case 'acp_job_delivery':
      return {
        ...common,
        agentWallet:           body.agentWallet || body.agentId,
        minCompletedJobsDelta: body.minCompletedJobsDelta,
        minSuccessRate:        body.minSuccessRate,
        minUniqueBuyersDelta:  body.minUniqueBuyersDelta,
      };

    case 'prediction_market_accuracy':
      return {
        ...common,
        agentWallet:        body.agentWallet || body.agentId,
        platform:           body.platform,
        category:           body.category ?? 'all',
        minMarketsResolved: body.minMarketsResolved,
        minWinRate:         body.minWinRate,
        minROI:             body.minROI,
        minVolumeUSD:       body.minVolumeUSD,
        kalshiApiKey:       body.kalshiApiKey,
      };

    default:
      return common;
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint:    'POST /api/attest-commitment',
    description: 'Commit to a measurable onchain goal — get certified when achieved',
    docs:        'https://thesealer.xyz/api/infoproducts',
    x402:        true,
    price:       '$0.50 USDC',
    networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    params: {
      agentId:    'your EVM wallet address',
      agentSig:   'EIP-712 signature proving wallet ownership',
      agentNonce: 'Unix timestamp (seconds) used when signing — valid for 5 minutes',
      claimType:  'x402_payment_reliability | defi_trading_performance | code_software_delivery | website_app_delivery | acp_job_delivery | prediction_market_accuracy',
      metric:     'measurable goal description',
      deadline:   'YYYY-MM-DD',
    },
    eip712: {
      domain:  { name: 'SealerProtocol', version: '1', chainId: 8453 },
      types:   { SealerAction: [{ name: 'wallet', type: 'address' }, { name: 'action', type: 'string' }, { name: 'nonce', type: 'uint256' }] },
      message: { wallet: '<agentId>', action: 'attest-commitment', nonce: '<unix_timestamp_seconds>' },
    },
  });
}