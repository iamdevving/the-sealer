// src/app/api/social/queue/route.ts
// Manages the social post draft queue
// GET  /api/social/queue          — list pending drafts
// POST /api/social/queue          — create a draft manually
// PATCH /api/social/queue/[id]    — approve/reject/update a draft
// DELETE /api/social/queue/[id]   — delete a draft

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

export type Platform    = 'x' | 'farcaster';
export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'posted';

export interface SocialDraft {
  id:          string;
  text:        string;
  platforms:   Platform[];
  trigger:     string;   // human-readable reason e.g. "New #1 on leaderboard: aria.agent"
  triggerData: Record<string, any>;
  status:      DraftStatus;
  createdAt:   string;
  updatedAt:   string;
  postedAt?:   string;
}

export async function getDraft(id: string): Promise<SocialDraft | null> {
  const raw = await redis.get(`social:draft:${id}`).catch(() => null);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as SocialDraft;
}

export async function saveDraft(draft: SocialDraft): Promise<void> {
  await redis.set(`social:draft:${draft.id}`, JSON.stringify(draft), { ex: 30 * 86400 });
  await redis.zadd('social:drafts', { score: Date.now(), member: draft.id });
}

export async function listDrafts(status?: DraftStatus): Promise<SocialDraft[]> {
  const ids = await redis.zrange('social:drafts', 0, -1, { rev: true });
  if (!ids.length) return [];
  const drafts = await Promise.all((ids as string[]).map(id => getDraft(id)));
  const valid   = drafts.filter(Boolean) as SocialDraft[];
  return status ? valid.filter(d => d.status === status) : valid;
}

// ── GET — list drafts ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') as DraftStatus | null;
  const drafts = await listDrafts(status || 'pending');
  return NextResponse.json({ drafts });
}

// ── POST — create draft ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { text, platforms, trigger, triggerData } = body;

  if (!text || !platforms || !trigger) {
    return NextResponse.json({ error: 'text, platforms, trigger required' }, { status: 400 });
  }

  const draft: SocialDraft = {
    id:          `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    platforms:   platforms || ['x', 'farcaster'],
    trigger,
    triggerData: triggerData || {},
    status:      'pending',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };

  await saveDraft(draft);
  return NextResponse.json({ draft });
}

// ── PATCH — update draft ──────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, text, status, platforms } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

  if (text)      draft.text      = text;
  if (status)    draft.status    = status;
  if (platforms) draft.platforms = platforms;
  draft.updatedAt = new Date().toISOString();
  if (status === 'posted') draft.postedAt = new Date().toISOString();

  await saveDraft(draft);
  return NextResponse.json({ draft });
}

// ── DELETE — remove draft ─────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await redis.del(`social:draft:${id}`);
  await redis.zrem('social:drafts', id);
  return NextResponse.json({ deleted: true });
}