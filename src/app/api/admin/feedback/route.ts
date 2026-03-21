// src/app/api/admin/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  return (
    auth === process.env.CRON_SECRET ||
    auth === process.env.ADMIN_PASSWORD
  );
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await redis.keys('sealer-agent:feedback:*');

  if (!keys.length) {
    return NextResponse.json({ feedback: [], total: 0 });
  }

  const raws = await Promise.all(keys.map(k => redis.get(k)));

  const entries = raws
    .map(raw => (typeof raw === 'string' ? JSON.parse(raw) : raw))
    .filter(Boolean);

  entries.sort((a: any, b: any) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return NextResponse.json({ feedback: entries, total: entries.length });
}