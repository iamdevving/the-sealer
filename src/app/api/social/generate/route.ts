// src/app/api/social/generate/route.ts
// Generates social post drafts based on trigger type
// Called by cron or manually

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const BASE_URL   = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || '';

type Platform = 'x' | 'farcaster';

interface GenerateRequest {
  trigger:     string;
  triggerData: Record<string, any>;
  platforms:   Platform[];
}

// ── Claude draft generation ───────────────────────────────────────────────────
async function generateDraft(trigger: string, triggerData: Record<string, any>, platforms: Platform[]): Promise<string> {
  const xLimit         = 280;
  const farcasterLimit = 320;
  const limit          = platforms.includes('x') ? xLimit : farcasterLimit;
  const isBoth         = platforms.includes('x') && platforms.includes('farcaster');

  const systemPrompt = `You are the social media voice of The Sealer Protocol — an onchain attestation and trust infrastructure for AI agents built on Base/EAS.

Your tone: authoritative, technical but accessible, concise. You speak for the protocol, not as an individual.
Never use emojis excessively — max 1-2 per post if any.
Always end posts with thesealer.xyz when relevant.
Never make up data — only use what's provided in the trigger context.
${isBoth ? `Write for both X and Farcaster — keep it under ${xLimit} chars.` : `Write for ${platforms.join('/')} — keep it under ${limit} chars.`}

Respond with ONLY the post text, nothing else. No quotes, no explanation.`;

  const userPrompt = `Generate a social post for this trigger:
Trigger: ${trigger}
Data: ${JSON.stringify(triggerData, null, 2)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 300,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

// ── Trigger handlers ──────────────────────────────────────────────────────────
async function handleLeaderboardChange(triggerData: any) {
  const { newLeader, handle, proofPoints, claimType, previousLeader } = triggerData;
  return {
    trigger:   `New #1 on ${claimType} leaderboard: ${handle}`,
    platforms: ['x', 'farcaster'] as Platform[],
    triggerData,
  };
}

async function handleNewSID(triggerData: any) {
  const { handle, entityType, chain, socialHandle } = triggerData;
  // Welcome posts are more personal — Farcaster first
  return {
    trigger:   `New SID registered: ${handle}`,
    platforms: socialHandle?.farcaster ? ['farcaster'] as Platform[] : ['x', 'farcaster'] as Platform[],
    triggerData,
  };
}

async function handleMilestone(triggerData: any) {
  const { type, value, description } = triggerData;
  return {
    trigger:   `Protocol milestone: ${description}`,
    platforms: ['x', 'farcaster'] as Platform[],
    triggerData,
  };
}

async function handleWeeklyStats(triggerData: any) {
  return {
    trigger:   'Weekly stats summary',
    platforms: ['x', 'farcaster'] as Platform[],
    triggerData,
  };
}

async function handleFastestClimber(triggerData: any) {
  const { handle, pointsGained, rankChange, period } = triggerData;
  return {
    trigger:   `Fastest climber (${period}): ${handle} +${pointsGained} proof points`,
    platforms: ['x', 'farcaster'] as Platform[],
    triggerData,
  };
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json();
  const { trigger, triggerData, platforms } = body;

  if (!trigger) return NextResponse.json({ error: 'trigger required' }, { status: 400 });

  // Generate post text via Claude
  const text = await generateDraft(trigger, triggerData, platforms || ['x', 'farcaster']);
  if (!text) return NextResponse.json({ error: 'Failed to generate draft' }, { status: 500 });

  // Save to queue via internal call
  const draft = {
    id:          `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    platforms:   platforms || ['x', 'farcaster'],
    trigger,
    triggerData: triggerData || {},
    status:      'pending',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };

  await redis.set(`social:draft:${draft.id}`, JSON.stringify(draft), { ex: 30 * 86400 });
  await redis.zadd('social:drafts', { score: Date.now(), member: draft.id });

  return NextResponse.json({ draft });
}