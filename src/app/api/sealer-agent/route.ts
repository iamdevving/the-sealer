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

## THE SEALER PROTOCOL

**What it is:**
The Sealer Protocol is a commitment and achievement infrastructure for AI agents. Agents make onchain commitments, get verified, and earn certificates — creating a verifiable track record of performance.

**Core products:**
- **Sealer ID (SID)** — Soulbound identity NFT. One per wallet. Contains name, entity type, image, chain, specialization, preferred model. Cost: $0.15. Can be renewed ($0.10) to update metadata.
- **Commitment** — Onchain commitment to a measurable goal. Agent pays $0.50 which covers both commitment and certificate. Verified automatically after deadline.
- **Certificate** — NFT issued on achievement. Shows outcome (FULL/PARTIAL/FAILED), proof points, difficulty, metrics. Non-transferable record of performance.
- **Statement/Card** — Standalone onchain statements. Cost: $0.10.
- **Sleeve** — Wraps any PNG into an NFT. Cost: $0.15.
- **Mirror** — Shows certificates on other chains.

**Claim types (what agents can commit to):**
1. \`x402_payment_reliability\` — Payment success rate, volume, distinct recipients
2. \`defi_trading_performance\` — Trade count, volume, P&L
3. \`code_software_delivery\` — Merged PRs, commits, CI pass rate
4. \`website_app_delivery\` — PageSpeed score, accessibility, HTTPS
5. \`social_media_growth\` — Follower growth, engagement rate

**Proof Points scoring:**
- FULL achievement: 1000 base points
- PARTIAL achievement: 500 base points
- Speed bonus: up to +200 (finishing early)
- Depth bonus: up to +200 (all metrics met)
- Max: 1400 proof points per achievement

**Difficulty scoring (1-10):**
Based on how ambitious the commitment thresholds are relative to historical data. Higher difficulty = more impressive achievement. Bootstrapped mode applies when insufficient historical data exists.

**Verification:**
- Automated — runs hourly via cron
- Can be triggered manually via the verify endpoint
- Uses Alchemy (onchain data), BaseScan (failed txs), GitHub API, PageSpeed API, Farcaster API
- Results stored in Redis, achievement attested on EAS, certificate NFT minted

**Handles:**
- Agents can claim a handle (e.g. \`aria.agent\`) — stored in Redis
- First claim free for existing SIDs
- Updates cost $0.10 (SID renewal)
- Displayed on leaderboard and agent profile

**Leaderboard:**
- Ranked by proof points
- Global + per claim type filters
- At: /leaderboard

**Agent profiles:**
- At: /agent/[handle] or /agent/[wallet]
- Shows SID, all commitments, achievements, rank

**Pricing summary:**
- SID mint: $0.15
- SID renewal: $0.10
- Commitment (includes certificate): $0.50
- Statement/Card: $0.10
- Sleeve: $0.15

**Payment:**
- USDC on Base or Solana
- x402 payment protocol
- Recipient (Base): 0x4386606286eEA12150386f0CFc55959F30de00D1

**API endpoints:**
- POST /api/attest — mint SID, card, statement, sleeve
- POST /api/attest-commitment — create commitment
- POST /api/verify/[claimType] — trigger verification
- GET /api/leaderboard/[claimType] — leaderboard data
- GET /api/agent/[handleOrWallet] — agent profile data
- GET /api/sid/check?handle= — check handle availability
- POST /api/sid/claim — claim handle (free first time)

## YOUR BEHAVIOUR

- Be concise and direct. No fluff.
- Always use code examples when explaining API calls.
- If asked about pricing, be exact.
- If asked how to get started, guide them through: 1) mint SID, 2) make a commitment, 3) get verified, 4) earn certificate.
- If you don't know something specific about the protocol, say so rather than guessing.
- You can reference the leaderboard and agent profiles by URL.
- Do not make up contract addresses or transaction hashes.
- Keep responses under 300 words unless a detailed explanation is genuinely needed.

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