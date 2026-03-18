// src/app/api/cron/social/route.ts
// Hourly cron — checks for social triggers and generates drafts
// Add to vercel.json: { "path": "/api/cron/social", "schedule": "0 * * * *" }

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis    = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';

// Cooldown keys to prevent duplicate posts
const COOLDOWN = {
  leaderboard:     24 * 60 * 60,  // 24h
  fastest_climber: 24 * 60 * 60,  // 24h
  weekly_stats:     7 * 24 * 3600, // 7 days
  new_sid:                    300, // 5 min per SID
  milestone:        24 * 60 * 60,  // 24h per milestone type
};

async function hasCooldown(key: string): Promise<boolean> {
  const val = await redis.get(`social:cooldown:${key}`).catch(() => null);
  return !!val;
}

async function setCooldown(key: string, seconds: number): Promise<void> {
  await redis.set(`social:cooldown:${key}`, '1', { ex: seconds });
}

async function triggerGenerate(trigger: string, triggerData: Record<string, any>, platforms: string[]) {
  await fetch(`${BASE_URL}/api/social/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ trigger, triggerData, platforms }),
  });
}

// ── Check leaderboard changes ─────────────────────────────────────────────────
async function checkLeaderboard() {
  const claimTypes = ['x402_payment_reliability', 'code_quality', 'task_completion', 'communication'];

  for (const claimType of claimTypes) {
    const cooldownKey = `leaderboard:${claimType}`;
    if (await hasCooldown(cooldownKey)) continue;

    // Get top 3 from leaderboard
    const entries = await redis.zrange(`lb:${claimType}`, 0, 2, { rev: true, withScores: true })
      .catch(() => []) as any[];

    if (!entries.length) continue;

    const leader = entries[0];
    const handle = leader.member || leader;
    const score  = leader.score || 0;

    // Check if leader changed
    const prevLeader = await redis.get(`social:prev_leader:${claimType}`).catch(() => null);
    if (prevLeader === handle) continue; // No change

    // New leader — generate post
    await redis.set(`social:prev_leader:${claimType}`, handle, { ex: 7 * 86400 });
    await setCooldown(cooldownKey, COOLDOWN.leaderboard);

    await triggerGenerate(
      `New #1 on ${claimType} leaderboard: ${handle}`,
      { claimType, handle, proofPoints: score, previousLeader: prevLeader },
      ['x', 'farcaster']
    );
  }
}

// ── Check fastest climber (24h) ───────────────────────────────────────────────
async function checkFastestClimber() {
  if (await hasCooldown('fastest_climber')) return;

  // Get current scores vs 24h ago snapshots
  const snapshot = await redis.get('social:lb_snapshot').catch(() => null) as Record<string, number> | null;
  if (!snapshot) {
    // First run — save snapshot
    const entries = await redis.zrange('lb:global', 0, 49, { rev: true, withScores: true })
      .catch(() => []) as any[];
    const snap: Record<string, number> = {};
    entries.forEach((e: any) => { if (e.member) snap[e.member] = e.score; });
    await redis.set('social:lb_snapshot', JSON.stringify(snap), { ex: 25 * 3600 });
    return;
  }

  const current = await redis.zrange('lb:global', 0, 49, { rev: true, withScores: true })
    .catch(() => []) as any[];

  let fastestHandle = '';
  let maxGain       = 0;

  current.forEach((e: any) => {
    if (!e.member) return;
    const prev = snapshot[e.member] || 0;
    const gain = e.score - prev;
    if (gain > maxGain) { maxGain = gain; fastestHandle = e.member; }
  });

  if (!fastestHandle || maxGain < 10) return; // Not significant enough

  await setCooldown('fastest_climber', COOLDOWN.fastest_climber);
  await triggerGenerate(
    `Fastest climber (24h): ${fastestHandle} +${maxGain} proof points`,
    { handle: fastestHandle, pointsGained: maxGain, period: '24h' },
    ['x', 'farcaster']
  );
}

// ── Check new SIDs with social handles ───────────────────────────────────────
async function checkNewSIDs() {
  // Get recently registered SIDs from Redis queue
  const recentSIDs = await redis.lrange('social:pending_welcome', 0, 4).catch(() => []);
  if (!recentSIDs.length) return;

  for (const sidRaw of recentSIDs as string[]) {
    const sid = typeof sidRaw === 'string' ? JSON.parse(sidRaw) : sidRaw;
    const cooldownKey = `new_sid:${sid.handle}`;
    if (await hasCooldown(cooldownKey)) continue;

    await setCooldown(cooldownKey, COOLDOWN.new_sid);
    await redis.lrem('social:pending_welcome', 1, sidRaw);

    await triggerGenerate(
      `New agent registered: ${sid.handle}`,
      { handle: sid.handle, entityType: sid.entityType, chain: sid.chain, socialHandle: sid.socialHandle },
      sid.socialHandle?.farcaster ? ['farcaster'] : ['x', 'farcaster']
    );
  }
}

// ── Check milestones ──────────────────────────────────────────────────────────
async function checkMilestones() {
  const milestones = [
    { key: 'total_mirrors',   threshold: 10,   label: 'Mirror NFTs minted' },
    { key: 'total_sids',      threshold: 50,   label: 'agents registered'  },
    { key: 'total_sids',      threshold: 100,  label: 'agents registered'  },
    { key: 'total_commitments', threshold: 50, label: 'commitments made'   },
  ];

  for (const m of milestones) {
    const current = await redis.get(`stats:${m.key}`).catch(() => 0) as number;
    if (current < m.threshold) continue;

    const cooldownKey = `milestone:${m.key}:${m.threshold}`;
    if (await hasCooldown(cooldownKey)) continue;

    await setCooldown(cooldownKey, COOLDOWN.milestone);
    await triggerGenerate(
      `Protocol milestone: ${m.threshold} ${m.label}`,
      { type: m.key, value: current, threshold: m.threshold, description: `${m.threshold} ${m.label}` },
      ['x', 'farcaster']
    );
  }
}

// ── Check weekly stats ────────────────────────────────────────────────────────
async function checkWeeklyStats() {
  if (await hasCooldown('weekly_stats')) return;

  const [totalSIDs, totalMirrors, totalCommitments] = await Promise.all([
    redis.get('stats:total_sids').catch(() => 0),
    redis.get('stats:total_mirrors').catch(() => 0),
    redis.get('stats:total_commitments').catch(() => 0),
  ]);

  // Get top 3 agents
  const top3 = await redis.zrange('lb:global', 0, 2, { rev: true, withScores: true })
    .catch(() => []) as any[];

  await setCooldown('weekly_stats', COOLDOWN.weekly_stats);
  await triggerGenerate(
    'Weekly stats summary',
    { totalSIDs, totalMirrors, totalCommitments, top3, week: new Date().toISOString().slice(0, 10) },
    ['x', 'farcaster']
  );
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: string[] = [];

  try { await checkLeaderboard();    results.push('leaderboard checked'); }    catch (e: any) { results.push(`leaderboard error: ${e.message}`); }
  try { await checkFastestClimber(); results.push('fastest climber checked'); } catch (e: any) { results.push(`climber error: ${e.message}`); }
  try { await checkNewSIDs();        results.push('new SIDs checked'); }        catch (e: any) { results.push(`sids error: ${e.message}`); }
  try { await checkMilestones();     results.push('milestones checked'); }      catch (e: any) { results.push(`milestones error: ${e.message}`); }

  // Weekly stats — only on Mondays
  if (new Date().getDay() === 1) {
    try { await checkWeeklyStats(); results.push('weekly stats generated'); } catch (e: any) { results.push(`weekly error: ${e.message}`); }
  }

  return NextResponse.json({ ok: true, results, timestamp: new Date().toISOString() });
}