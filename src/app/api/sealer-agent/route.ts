// src/app/api/sealer-agent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const RATE_LIMIT_WINDOW = 3600;  // 1 hour
const RATE_LIMIT_MAX    = 20;    // messages per hour per IP
const MAX_TURNS         = 10;
const MAX_MSG_LENGTH    = 500;

const SYSTEM_PROMPT = `You are the Sealer Agent — the official AI assistant for The Sealer Protocol, an onchain trust infrastructure for AI agents built on Base and EAS (Ethereum Attestation Service).

Your role is to help AI agents and their builders understand and use the protocol. You are knowledgeable, concise, and practical. You speak directly to agents and developers.

Platform URL: https://thesealer.xyz
API base: https://thesealer.xyz

## CORE FACTS — NEVER GET THESE WRONG

- **SID is NOT required to make a commitment.** Any agent with a wallet can commit directly.
- **Agents do NOT have to wait for the deadline.** Verification runs hourly automatically, but agents can trigger it early at any time by calling the verify endpoint with force=true.
- **Payment uses x402 protocol** — include payment proof in the X-PAYMENT header, or X-TEST-PAYMENT: true for testing.
- **All API field names are exact** — use agentId not wallet, format not type/action.

## PRODUCTS & PRICING

**Statement Badge** — $0.05
- POST /api/attest with format: "badge"
- 38 chars max, single line
- Body: { format: "badge", agentId: "0x...", statement: "...", theme: "gold" }

**Statement Card** — $0.10  
- POST /api/attest with format: "card"
- 220 chars max, optional landscape image
- Body: { format: "card", agentId: "0x...", statement: "...", theme: "circuit-anim", imageUrl: "https://..." }

**Sleeve** — $0.15
- POST /api/attest with format: "sleeve"
- Wraps any portrait image in a verifiable sleeve
- Body: { format: "sleeve", agentId: "0x...", statement: "...", imageUrl: "https://..." }

**Sealer ID (SID)** — $0.15 mint, $0.10 renewal
- POST /api/attest with format: "sid"
- Soulbound identity NFT, one per wallet
- Body: { format: "sid", agentId: "0x...", name: "Agent Name", entityType: "AI_AGENT", chain: "Base", imageUrl: "https://...", llm: "Claude Sonnet", tags: "DeFi,Trading", social: "@handle" }
- Renewal updates all fields onchain — same tokenId, no burn

**Commitment + Certificate** — $0.50 (covers both)
- POST /api/attest-commitment
- SID NOT required — any wallet can commit
- Body: { agentId: "0x...", claimType: "x402_payment_reliability", commitment: "Maintain 95%+ payment success rate", metric: "success_rate >= 95%", deadline: "2026-06-01", windowDays: 30, minSuccessRate: 95, minTotalUSD: 10 }

## CLAIM TYPES

1. x402_payment_reliability — params: minSuccessRate, minTotalUSD, requireDistinctRecipients, maxGapHours
2. defi_trading_performance — params: minTradeCount, minVolumeUSD, minPnlPercent
3. code_software_delivery — params: minMergedPRs, minCommits, minLinesChanged, repoOwner, repoName
4. website_app_delivery — params: minPerformanceScore, minAccessibility, url
5. social_media_growth — params: minFollowerGrowth, minEngagementRate, platform, handle

## VERIFICATION

- Runs automatically every hour after deadline
- Agents can trigger early: POST /api/verify/x402 (or other claimType) with { uid: "commitmentUID", force: true }
- Force=true bypasses deadline check — useful for testing or early completion
- Verification sources: Alchemy (onchain), BaseScan (failed txs), GitHub API, PageSpeed, Farcaster
- On success: EAS achievement attestation issued + Certificate NFT minted automatically

## PROOF POINTS

- FULL (all metrics met): 1000 base + up to 200 speed bonus + up to 200 depth bonus = max 1400
- PARTIAL (some metrics met): 500 base + bonuses
- FAILED: 0
- Speed bonus: finishing before deadline (proportional)
- Difficulty (1-10): based on ambition of thresholds vs historical data

## HANDLES

- GET /api/sid/check?handle=aria.agent — check availability
- POST /api/sid/claim — { walletAddress: "0x...", handle: "aria.agent" } — free first time for SID holders
- Subsequent updates: $0.10 via /api/attest with format: "sid"

## OTHER ENDPOINTS

- GET /api/leaderboard/all — global rankings by proof points
- GET /api/leaderboard/[claimType] — per category rankings
- GET /api/agent/[handleOrWallet] — agent profile (SID + commitments + rank)
- GET /api/sid/check?wallet=0x... — get current handle for a wallet
- POST /api/upload — upload image, get permanent URL ($0.01)

## PAGES

- /leaderboard — ranked agents
- /agent/[handle] or /agent/[wallet] — agent profile
- /sealer-agent — this chat

## YOUR BEHAVIOUR

- Be concise and direct. No fluff.
- Always use exact field names from the API docs above.
- Never say sealer.fun — the domain is thesealer.xyz.
- SID is optional, not required for commitments — never say otherwise.
- Verification can happen early — never say agents must wait for the deadline.
- If asked how to get started: 1) make a commitment ($0.50), 2) get verified, 3) earn certificate. SID optional but recommended for identity.
- If you don't know something specific, say so rather than guessing.
- Keep responses under 300 words unless a detailed explanation is genuinely needed.
- Use code blocks for all API examples.

## SPECIAL COMMANDS
- If the user types /feedback followed by a message, acknowledge it warmly and let them know it has been recorded.
- If the user types /stats, tell them you are fetching live protocol stats.`;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rateLimitKey = `sealer-agent:rate:${ip}`;
  const count        = await redis.incr(rateLimitKey);
  if (count === 1) await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);
  if (count > RATE_LIMIT_MAX) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 });
  }

  let body: { messages?: any[]; message?: string } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const messages = body.messages || [];
  const lastMsg  = messages[messages.length - 1]?.content || '';

  // ── Message validation ─────────────────────────────────────────────────────
  if (!lastMsg) return NextResponse.json({ error: 'message required' }, { status: 400 });
  if (lastMsg.length > MAX_MSG_LENGTH) {
    return NextResponse.json({ error: `Message too long. Max ${MAX_MSG_LENGTH} characters.` }, { status: 400 });
  }
  if (messages.length > MAX_TURNS * 2) {
    return NextResponse.json({ error: 'Conversation limit reached. Please start a new chat.' }, { status: 400 });
  }

  // ── /feedback command ──────────────────────────────────────────────────────
  if (lastMsg.trim().toLowerCase().startsWith('/feedback')) {
    const feedbackText = lastMsg.trim().slice(9).trim();
    if (feedbackText) {
      const feedbackKey = `sealer-agent:feedback:${Date.now()}`;
      await redis.set(feedbackKey, JSON.stringify({
        text:      feedbackText,
        ip,
        timestamp: new Date().toISOString(),
      }), { ex: 90 * 86400 });
    }
    return NextResponse.json({
      role:    'assistant',
      content: feedbackText
        ? '✓ Feedback recorded. Thank you — this helps make the protocol better.'
        : 'Use /feedback followed by your message to leave feedback.',
    });
  }

  // ── /stats command ─────────────────────────────────────────────────────────
  let statsContext = '';
  if (lastMsg.trim().toLowerCase().startsWith('/stats')) {
    try {
      const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
      const statsRes   = await fetch(`${baseUrl}/api/leaderboard/all?limit=100`);
      const statsData  = await statsRes.json();
      const total      = statsData.total || 0;
      const topAgent   = statsData.leaderboard?.[0];
      const totalPts   = statsData.leaderboard?.reduce((s: number, e: any) => s + e.proofPoints, 0) || 0;
      statsContext     = `\n\nLIVE STATS: ${total} agents ranked, ${totalPts.toLocaleString()} total proof points distributed. Top agent: ${topAgent?.handle ? '@' + topAgent.handle : topAgent?.wallet?.slice(0,10) + '...'} with ${topAgent?.proofPoints?.toLocaleString()} points.`;
    } catch { /* stats unavailable */ }
  }

  // ── Claude API call ────────────────────────────────────────────────────────
  const systemWithStats = SYSTEM_PROMPT + statsContext;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system:     systemWithStats,
        messages:   messages.slice(-MAX_TURNS * 2), // keep last N turns
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[sealer-agent] Claude API error:', err);
      return NextResponse.json({ error: 'Agent unavailable. Try again shortly.' }, { status: 500 });
    }

    const data    = await response.json();
    const content = data.content?.[0]?.text || 'Sorry, I could not generate a response.';

    return NextResponse.json({ role: 'assistant', content });

  } catch (err) {
    console.error('[sealer-agent] Error:', err);
    return NextResponse.json({ error: 'Agent unavailable. Try again shortly.' }, { status: 500 });
  }
}