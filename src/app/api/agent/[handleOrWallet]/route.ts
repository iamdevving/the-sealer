// src/app/api/agent/[handleOrWallet]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const SID_ADDRESS = process.env.SEALER_ID_CONTRACT_ADDRESS as `0x${string}`;
const rpcUrl      = process.env.ALCHEMY_RPC_URL!;

const SID_ABI = parseAbi([
  'function hasSID(address wallet) view returns (bool)',
  'function walletToTokenId(address wallet) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function renewalCount(uint256 tokenId) view returns (uint256)',
]);

const KEY_PREFIX = 'achievement:pending:';

const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payments',
  defi_trading_performance: 'DeFi Trading',
  code_software_delivery:   'Code Delivery',
  website_app_delivery:     'App Delivery',
  social_media_growth:      'Social Growth',
};

export async function GET(
  req:     NextRequest,
  context: { params: Promise<{ handleOrWallet: string }> },
) {
  const { handleOrWallet } = await context.params;
  const param = handleOrWallet.toLowerCase().trim();

  // ── Resolve wallet ────────────────────────────────────────────────────────
  let wallet: string;
  let handle: string | null = null;

  if (param.startsWith('0x')) {
    wallet = param;
    handle = (await redis.get(`sid:wallet:${wallet}`)) as string | null;
  } else {
    // Treat as handle
    const resolved = await redis.get(`sid:handle:${param}`) as string | null;
    if (!resolved) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    wallet = resolved;
    handle = param;
  }

  // ── SID data ──────────────────────────────────────────────────────────────
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });

  let sidData: {
    tokenId:      string;
    name:         string;
    entityType:   string;
    imageUrl:     string;
    chain:        string;
    renewalCount: number;
    tokenUri:     string;
  } | null = null;

  try {
    const hasSID = await publicClient.readContract({
      address: SID_ADDRESS, abi: SID_ABI, functionName: 'hasSID',
      args: [wallet as `0x${string}`],
    });

    if (hasSID) {
      const tokenId = await publicClient.readContract({
        address: SID_ADDRESS, abi: SID_ABI, functionName: 'walletToTokenId',
        args: [wallet as `0x${string}`],
      });
      const [tokenUri, renewals] = await Promise.all([
        publicClient.readContract({ address: SID_ADDRESS, abi: SID_ABI, functionName: 'tokenURI', args: [tokenId] }),
        publicClient.readContract({ address: SID_ADDRESS, abi: SID_ABI, functionName: 'renewalCount', args: [tokenId] }),
      ]);

      // Parse params from tokenURI
      let name = 'UNNAMED AGENT', entityType = 'UNKNOWN', imageUrl = '', chain = 'Base';
      try {
        const url    = new URL(tokenUri as string);
        name         = url.searchParams.get('name')       || name;
        entityType   = url.searchParams.get('entityType') || entityType;
        imageUrl     = url.searchParams.get('imageUrl')   || imageUrl;
        chain        = url.searchParams.get('chain')      || chain;
      } catch { /* use defaults */ }

      sidData = {
        tokenId:      tokenId.toString(),
        name, entityType, imageUrl, chain,
        renewalCount: Number(renewals),
        tokenUri:     tokenUri as string,
      };
    }
  } catch (err) {
    console.warn('[agent-profile] SID read failed:', err);
  }

  // ── Achievements ──────────────────────────────────────────────────────────
  const keys = await redis.keys(`${KEY_PREFIX}*`);
  const raws = await Promise.all(keys.map(k => redis.get(k)));

  const commitments: any[] = [];
  let totalProofPoints = 0;
  let achievementCount = 0;

  for (const raw of raws) {
    if (!raw) continue;
    const entry = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
    if ((entry.subject as string)?.toLowerCase() !== wallet) continue;

    const commitment = {
      uid:          entry.attestationUID,
      claimType:    entry.claimType,
      claimLabel:   CLAIM_LABELS[entry.claimType] || entry.claimType,
      status:       entry.status,
      statement:    entry.statement,
      deadline:     entry.deadline ? new Date(entry.deadline * 1000).toISOString() : null,
      proofPoints:  entry.proofPoints  ?? 0,
      difficulty:   entry.difficulty   ?? 0,
      onTime:       entry.onTime       ?? false,
      failureReason: entry.failureReason || null,
    };

    commitments.push(commitment);

    if (entry.status === 'achieved') {
      totalProofPoints += Number(entry.proofPoints ?? 0);
      achievementCount++;
    }
  }

  // Sort: achieved first, then by proofPoints desc
  commitments.sort((a, b) => {
    if (a.status === 'achieved' && b.status !== 'achieved') return -1;
    if (b.status === 'achieved' && a.status !== 'achieved') return 1;
    return b.proofPoints - a.proofPoints;
  });

  // ── Rank ──────────────────────────────────────────────────────────────────
  let rank: number | null = null;
  try {
    const allKeys = await redis.keys(`${KEY_PREFIX}*`);
    const allRaws = await Promise.all(allKeys.map(k => redis.get(k)));
    const walletPoints = new Map<string, number>();
    for (const raw of allRaws) {
      if (!raw) continue;
      const e = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      if (e.status !== 'achieved') continue;
      const w = (e.subject as string)?.toLowerCase();
      if (!w) continue;
      walletPoints.set(w, (walletPoints.get(w) ?? 0) + Number(e.proofPoints ?? 0));
    }
    const sorted = [...walletPoints.entries()].sort((a, b) => b[1] - a[1]);
    const idx    = sorted.findIndex(([w]) => w === wallet);
    rank         = idx >= 0 ? idx + 1 : null;
  } catch { /* rank unavailable */ }

  return NextResponse.json({
    wallet,
    handle,
    sid:             sidData,
    totalProofPoints,
    achievementCount,
    rank,
    commitments,
  });
}