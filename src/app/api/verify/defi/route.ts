// ─────────────────────────────────────────────────────────────────────────────
// src/app/api/verify/defi/route.ts
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { verifyDefiTradingPerformance } from '@/lib/verify/defi';
import { attestAchievement, calculateScore } from '@/lib/verify/attest-achievement';
import type { PendingAchievement } from '@/lib/verify/types';

export const runtime = 'nodejs';

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX = 'achievement:pending:';

export async function POST(req: NextRequest) {
  return handleVerify(req, 'defi_trading_performance', async (pending, params, uid) => {
    return verifyDefiTradingPerformance({
      agentWallet:   params.agentWallet || pending.subject,
      protocol:      params.protocol    || 'unknown',
      windowDays:    params.windowDays  || 30,
      mintTimestamp: pending.mintTimestamp,
      minTradeCount: params.minTradeCount,
      minVolumeUSD:  params.minVolumeUSD,
      minPnlPercent: params.minPnlPercent,
    }, uid);
  });
}

export async function GET(req: NextRequest) {
  return handleGet(req);
}

// Shared handlers — same pattern for all 4 verifiers
async function handleVerify(
  req:       NextRequest,
  claimType: string,
  runVerifier: (pending: PendingAchievement, params: any, uid: string) => Promise<any>,
) {
  let body: { uid?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const uid = body.uid || req.headers.get('x-attestation-uid') || '';
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Pending achievement not found', uid }, { status: 404 });

  const pending: PendingAchievement = typeof raw === 'string' ? JSON.parse(raw) : raw as PendingAchievement;

  if (pending.claimType !== claimType) {
    return NextResponse.json({ error: `Wrong verifier. This is ${claimType}, commitment is ${pending.claimType}` }, { status: 400 });
  }
  if (['achieved', 'failed', 'expired'].includes(pending.status)) {
    return NextResponse.json({ uid, status: pending.status, alreadyResolved: true });
  }

  const now    = Math.floor(Date.now() / 1000);
  const force  = body.force || req.headers.get('x-force-verify') === 'true';
  if (!force && pending.deadline > now) {
    return NextResponse.json({ uid, status: 'pending', message: `${Math.ceil((pending.deadline - now) / 86400)} day(s) remaining.` });
  }

  await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'verifying', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });

  try {
    const params = JSON.parse(pending.verificationParams || '{}');
    const result = await runVerifier(pending, params, uid);

    if (!result.passed) {
      const expired = now > pending.deadline + 86400;
      await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: expired ? 'failed' : 'pending', lastChecked: now, failureReason: result.failureReason } satisfies PendingAchievement), { ex: 90 * 86400 });
      return NextResponse.json({ uid, status: expired ? 'failed' : 'pending', passed: false, failureReason: result.failureReason, evidence: result.evidence });
    }

    const onTime       = now <= pending.deadline;
    const deadlineDays = Math.ceil((pending.deadline - pending.mintTimestamp) / 86400);
    const score        = calculateScore({
      level:         result.level,
      onTime,
      daysRemaining: Math.ceil((pending.deadline - now) / 86400),
      deadlineDays,
      evidenceCount: Object.keys(result.evidence.rawMetrics).length,
      metricBonus:   0,
    });

    const achieved = await attestAchievement({
      agentId:       pending.subject as `0x${string}`,
      claimType:     pending.claimType,
      level:         result.level,
      commitmentUID: uid,
      evidence:      JSON.stringify(result.evidence),
      metric:        JSON.stringify(result.evidence.rawMetrics).slice(0, 120),
      score,
      onTime,
    });

    if (!achieved.success) {
      await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'pending', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });
      return NextResponse.json({ uid, passed: true, level: result.level, warning: 'Attestation failed — will retry', error: achieved.error }, { status: 500 });
    }

    await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'achieved', lastChecked: now, level: result.level } satisfies PendingAchievement), { ex: 90 * 86400 });
    return NextResponse.json({ uid, status: 'achieved', passed: true, level: result.level, score, onTime, achievementTxHash: achieved.achievementTxHash, nftTxHash: achieved.nftTxHash });

  } catch (err) {
    await redis.set(KEY_PREFIX + uid, JSON.stringify({ ...pending, status: 'pending', lastChecked: now } satisfies PendingAchievement), { ex: 90 * 86400 });
    return NextResponse.json({ error: 'Verification failed', details: String(err) }, { status: 500 });
  }
}

async function handleGet(req: NextRequest) {
  const uid = new URL(req.url).searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });
  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p: PendingAchievement = typeof raw === 'string' ? JSON.parse(raw) : raw as PendingAchievement;
  return NextResponse.json({ uid, status: p.status, claimType: p.claimType, subject: p.subject, deadline: new Date(p.deadline * 1000).toISOString(), level: p.level, failureReason: p.failureReason });
}


// ─────────────────────────────────────────────────────────────────────────────
// src/app/api/verify/github/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// import { NextRequest, NextResponse } from 'next/server';
// import { Redis } from '@upstash/redis';
// import { verifyCodeSoftwareDelivery } from '@/lib/verify/github';
// import { attestAchievement, calculateScore } from '@/lib/verify/attest-achievement';
// import type { PendingAchievement } from '@/lib/verify/types';
//
// export const runtime = 'nodejs';
// const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
// const KEY_PREFIX = 'achievement:pending:';
//
// export async function POST(req: NextRequest) {
//   return handleVerify(req, 'code_software_delivery', async (pending, params, uid) => {
//     return verifyCodeSoftwareDelivery({
//       agentWallet:    pending.subject,
//       repoOwner:      params.repoOwner,
//       repoName:       params.repoName,
//       githubUsername: params.githubUsername,
//       windowDays:     params.windowDays  || 30,
//       mintTimestamp:  pending.mintTimestamp,
//       requireCIPass:  params.requireCIPass,
//       minLinesChanged: params.minLinesChanged,
//     }, uid);
//   });
// }
// export async function GET(req: NextRequest) { return handleGet(req); }