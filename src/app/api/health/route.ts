// src/app/api/health/route.ts
// Public health check endpoint — used by UptimeRobot and other monitors.
// Returns 200 if all critical dependencies are reachable, 503 if any fail.

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

interface CheckResult {
  ok:      boolean;
  latency: number;
  error?:  string;
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await redis.ping();
    return { ok: true, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: String(err) };
  }
}

async function checkAlchemy(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(process.env.ALCHEMY_RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: String(err) };
  }
}

async function checkHelius(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'getSlot', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: String(err) };
  }
}

async function checkEAS(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch('https://base.easscan.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ attestations(take: 1) { id } }' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: String(err) };
  }
}

async function checkGitHub(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, error: String(err) };
  }
}

export async function GET() {
  const [redis, alchemy, helius, eas, github] = await Promise.all([
    checkRedis(),
    checkAlchemy(),
    checkHelius(),
    checkEAS(),
    checkGitHub(),
  ]);

  const checks = { redis, alchemy, helius, eas, github };
  const allOk  = Object.values(checks).every(c => c.ok);

  return NextResponse.json(
    {
      status:    allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 }
  );
}