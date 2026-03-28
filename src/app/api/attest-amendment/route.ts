// src/app/api/attest-amendment/route.ts
//
// Allows an agent to amend an existing commitment — lowering thresholds only.
//
// Rules (from scoring model v1):
//   - One amendment maximum per commitment
//   - Must be submitted before 40% of the verification window has elapsed
//   - Thresholds can only DECREASE (never increase)
//   - No deadline extension
//   - Difficulty recalculates downward at amendment time
//   - Amendment is attested onchain as a new EAS attestation referencing the original
//
// Payment: $0.25 USDC via x402
//
// SECURITY:
//   - Rate limited: 5 amendments per hour per IP (tighter than attest — high-value action)
//   - EVM agentId requires EIP-712 wallet ownership signature (same pattern as attest)
//   - Solana wallets exempt — x402 payment from their wallet proves ownership
//
// POST /api/attest-amendment
// Body:
//   commitmentUid  string  — EAS UID of the original commitment attestation
//   agentId        string  — must match original commitment agent
//   agentSig       string  — EIP-712 signature (EVM wallets only)
//   agentNonce     number  — Unix timestamp used when signing (valid 5 min)
//   newCommitment  string  — updated commitment statement (optional)
//   newMetric      string  — updated metric description
//   theme          string  — visual theme (default: 'parchment')
//   [claimType-specific threshold params — same as attest-commitment but lowered]

import { NextRequest, NextResponse } from 'next/server';
import { withZauthX402Payment, issueAmendmentAttestation } from '@/lib/zauth';
import { Redis } from '@upstash/redis';
import { computeDifficulty } from '@/lib/difficulty';
import type { ClaimType } from '@/lib/verify/types';
import { x402Challenge } from '@/lib/x402';
import { rateLimitRequest } from '@/lib/security';
import { verifyAgentSignature, getSigningPayload } from '@/lib/agentSig';

export const runtime = 'nodejs';

const AMENDMENT_PRICE = '0.25';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export async function POST(req: NextRequest) {
  // ── SECURITY: Rate limiting ───────────────────────────────────────────────
  // 5 amendment requests per hour per IP — amendments are high-value, paid actions
  const rateLimited = await rateLimitRequest(req, 'attest-amendment', 5, 3600);
  if (rateLimited) return rateLimited;

  return withZauthX402Payment(req, async (paymentChain: 'base' | 'solana' | undefined) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const commitmentUid = (body.commitmentUid as string)?.trim();
    const agentId       = (body.agentId       as string)?.trim();
    const newMetric     = (body.newMetric      as string)?.trim();
    const theme         = (body.theme          as string)?.trim() || 'parchment';

    if (!commitmentUid) {
      return NextResponse.json({ error: 'commitmentUid is required' }, { status: 400 });
    }
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }
    if (!newMetric) {
      return NextResponse.json({ error: 'newMetric is required — describe the amended threshold' }, { status: 400 });
    }

    // ── SECURITY: Verify wallet ownership for EVM agentIds ────────────────
    // Solana agents (non-0x) are exempt — x402 payment proves ownership.
    if (agentId.startsWith('0x')) {
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
            signingPayload: getSigningPayload(agentId, 'attest-amendment', nonce),
            exampleNonce:   nonce,
          },
          { status: 401 },
        );
      }

      const sigResult = await verifyAgentSignature(
        agentId,
        'attest-amendment',
        Number(agentNonce),
        agentSig,
      );

      if (!sigResult.valid) {
        const nonce = Math.floor(Date.now() / 1000);
        return NextResponse.json(
          {
            error:          'Wallet ownership verification failed',
            reason:         sigResult.reason,
            signingPayload: getSigningPayload(agentId, 'attest-amendment', nonce),
            exampleNonce:   nonce,
          },
          { status: 401 },
        );
      }

      console.log(`[attest-amendment] Wallet ownership verified for ${agentId}`);
    }

    // ── Load existing pending achievement from Redis ───────────────────────
    const redisKey = `achievement:pending:${commitmentUid}`;
    const existing = await redis.get(redisKey) as Record<string, unknown> | null;

    if (!existing) {
      return NextResponse.json(
        { error: 'Commitment not found. Either the UID is wrong or the commitment has already been certified.' },
        { status: 404 },
      );
    }

    // ── Ownership check ────────────────────────────────────────────────────
    if ((existing.subject as string)?.toLowerCase() !== agentId.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized — agentId does not match the commitment owner.' },
        { status: 403 },
      );
    }

    // ── Status check: can only amend PENDING commitments ──────────────────
    if (existing.status !== 'pending') {
      return NextResponse.json(
        {
          error:  `Cannot amend — commitment status is '${existing.status}'.`,
          detail: 'Amendments are only allowed on pending commitments.',
        },
        { status: 409 },
      );
    }

    // ── Already amended check ─────────────────────────────────────────────
    if (existing.amendedUID) {
      return NextResponse.json(
        { error: 'This commitment has already been amended. Only one amendment is allowed.' },
        { status: 409 },
      );
    }

    // ── 40% window check ─────────────────────────────────────────────────
    const mintTimestamp = existing.mintTimestamp as number;
    const deadline      = existing.deadline      as number;
    const now           = Math.floor(Date.now() / 1000);
    const windowTotal   = deadline - mintTimestamp;
    const elapsed       = now - mintTimestamp;
    const pctElapsed    = windowTotal > 0 ? (elapsed / windowTotal) * 100 : 100;

    if (pctElapsed >= 40) {
      return NextResponse.json(
        {
          error:       'Amendment window has closed.',
          detail:      `${pctElapsed.toFixed(1)}% of the commitment window has elapsed. Amendments must be submitted before 40%.`,
          pctElapsed:  Math.round(pctElapsed),
          deadlineUtc: new Date(deadline * 1000).toISOString(),
        },
        { status: 422 },
      );
    }

    // ── Parse existing verification params ────────────────────────────────
    let existingParams: Record<string, unknown> = {};
    try {
      existingParams = JSON.parse(existing.verificationParams as string);
    } catch { /* use empty */ }

    const claimType = existing.claimType as ClaimType;

    // ── Build new params from body, enforcing decrease-only rule ──────────
    const numericParamKeys = [
      'minSuccessRate', 'minTotalUSD', 'requireDistinctRecipients', 'maxGapHours',
      'minTradeCount', 'minVolumeUSD', 'minPnlPercent',
      'minMergedPRs', 'minCommits', 'minLinesChanged',
      'minPerformanceScore', 'minAccessibility',
      'minFollowerGrowth', 'minEngagementRate',
    ];

    const violations: string[] = [];
    const newParams: Record<string, unknown> = { ...existingParams };

    for (const key of numericParamKeys) {
      if (body[key] !== undefined) {
        const newVal  = Number(body[key]);
        const origVal = Number(existingParams[key]);
        if (!isNaN(origVal) && newVal > origVal) {
          violations.push(`${key}: cannot increase from ${origVal} to ${newVal}`);
        } else if (!isNaN(newVal)) {
          newParams[key] = newVal;
        }
      }
    }

    if (violations.length > 0) {
      return NextResponse.json(
        {
          error:      'Threshold increase not allowed. Amendments can only lower thresholds.',
          violations,
        },
        { status: 422 },
      );
    }

    // ── Recompute difficulty against new thresholds ───────────────────────
    const newThresholds: Record<string, number> = {};
    for (const key of numericParamKeys) {
      const v = newParams[key];
      if (typeof v === 'number' && !isNaN(v)) newThresholds[key] = v;
    }

    let newDifficulty = 0;
    let newDifficultyTier: 'bronze' | 'silver' | 'gold' = 'bronze';
    let bootstrapped = false;
    try {
      const diffResult = computeDifficulty(claimType, newThresholds, []);
      newDifficulty     = diffResult.difficulty;
      bootstrapped      = diffResult.bootstrapped;
      newDifficultyTier = newDifficulty >= 70 ? 'gold'
                        : newDifficulty >= 40 ? 'silver'
                        : 'bronze';
    } catch (err) {
      console.warn('[attest-amendment] Difficulty compute failed (non-fatal):', err);
    }

    // ── EAS amendment attestation ─────────────────────────────────────────
    const newCommitment = ((body.newCommitment as string)?.trim()) || (existing.statement as string);
    const walletAddress = agentId.startsWith('0x')
      ? agentId as `0x${string}`
      : '0x0000000000000000000000000000000000000000' as `0x${string}`;

    let amendTxHash: string;
    let amendUID:    string;
    try {
      const receipt = await issueAmendmentAttestation({
        agentId:       walletAddress,
        claimType,
        originalUID:   commitmentUid,
        newMetric,
        newDifficulty,
        bootstrapped,
      });
      amendTxHash = receipt.transactionHash;
      amendUID    = receipt.uid;
    } catch (err) {
      console.error('[attest-amendment] EAS attestation failed:', err);
      return NextResponse.json(
        { error: 'EAS amendment attestation failed', details: String(err) },
        { status: 500 },
      );
    }

    // ── Update Redis entry ────────────────────────────────────────────────
    const updated = {
      ...existing,
      status:             'amended',
      amendedUID: amendUID,
      amendTxHash,
      amendedAt:          now,
      statement:          newCommitment,
      originalStatement:  existing.statement,
      verificationParams: JSON.stringify(newParams),
      difficultyScore:    newDifficulty,
      difficultyTier:     newDifficultyTier,
      bootstrapped,
      amendedMetric:      newMetric,
    };

    await redis.set(redisKey, updated, { ex: 90 * 86400 });

    // ── Build SVG URL for amended commitment ──────────────────────────────
    const baseUrl      = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
    const amendmentUrl = `${baseUrl}/api/amendment?uid=${amendUID}&originalUid=${commitmentUid}&theme=${theme}`;

    return NextResponse.json({
      success:          true,
      amendUID,
      amendTxHash,
      commitmentUid,
      claimType,
      agentId,
      newCommitment,
      newMetric,
      newDifficulty,
      newDifficultyTier,
      bootstrapped,
      pctElapsedAtAmendment: Math.round(pctElapsed),
      paymentChain:     paymentChain || 'base',
      easExplorer:      `https://base.easscan.org/attestation/view/${amendUID}`,
      originalExplorer: `https://base.easscan.org/attestation/view/${commitmentUid}`,
      amendmentUrl,
      message: 'Amendment sealed onchain. Verification at deadline will use the amended thresholds.',
    });
  }, AMENDMENT_PRICE, {
  schema: { properties: {
    input: { properties: { body: { type: 'object', required: ['agentId','agentSig','agentNonce','commitmentUid'], properties: { agentId: { type: 'string' }, agentSig: { type: 'string' }, agentNonce: { type: 'string' }, commitmentUid: { type: 'string' }, newMetric: { type: 'string' } } } } },
    output: { properties: { example: { success: true, amendUID: '0xabc', amendTxHash: '0xdef' } } },
  } },
});
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/attest-amendment',
    description: 'Amend an existing commitment with updated parameters',
    docs: 'https://thesealer.xyz/api/infoproducts',
    x402: true,
    price: '$0.25 USDC',
    networks: ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    params: {
      agentId:       'your wallet address',
      agentSig:      'EIP-712 signature (EVM wallets only)',
      agentNonce:    'Unix timestamp (seconds) used when signing — valid for 5 minutes',
      commitmentUid: 'UID of the commitment to amend',
      newMetric:     'updated goal description',
    },
    eip712: {
      domain: { name: 'SealerProtocol', version: '1', chainId: 8453 },
      types:  { SealerAction: [{ name: 'wallet', type: 'address' }, { name: 'action', type: 'string' }, { name: 'nonce', type: 'uint256' }] },
      message: { wallet: '<agentId>', action: 'attest-amendment', nonce: '<unix_timestamp_seconds>' },
    },
    note: 'Solana agents do not need agentSig — payment proves wallet ownership.',
  });
}