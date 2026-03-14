// src/app/api/admin/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys    = await redis.keys('sealer-agent:feedback:*');
  const entries = await Promise.all(
    keys.map(async k => {
      const raw = await redis.get(k);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    })
  );

  // Sort by timestamp desc
  entries.sort((a: any, b: any) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return NextResponse.json({ feedback: entries, total: entries.length });
}