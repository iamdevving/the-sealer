// src/app/api/admin/patch-achievement/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis      = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const KEY_PREFIX = 'achievement:pending:';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { uid, proofPoints, difficulty, status } = await req.json();
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const raw = await redis.get(KEY_PREFIX + uid);
  if (!raw) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

  const entry = typeof raw === 'string' ? JSON.parse(raw) : raw as any;

  if (proofPoints !== undefined) entry.proofPoints = proofPoints;
  if (difficulty  !== undefined) entry.difficulty  = difficulty;
  if (status      !== undefined) entry.status      = status;

  await redis.set(KEY_PREFIX + uid, JSON.stringify(entry), { ex: 90 * 86400 });

  return NextResponse.json({
    success: true, uid,
    proofPoints: entry.proofPoints,
    difficulty:  entry.difficulty,
    status:      entry.status,
  });
}