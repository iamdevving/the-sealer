// src/lib/verify/social.ts
// Verifier for Social Media Growth achievements
// Data source: Neynar API (Farcaster) — authenticated
// Measures: follower growth, engagement rate, posting consistency

import type { VerificationResult, AchievementLevel } from './types';

export interface SocialVerificationParams {
  agentWallet:       string;
  platform:          'farcaster'; // Lens post-launch, Twitter post-launch
  handle?:           string;      // Farcaster username (without @)
  fid?:              number;      // Farcaster ID — preferred over handle
  windowDays:        number;
  mintTimestamp:     number;
  baselineFollowers: number;      // snapshot at commitment time — stored in verificationParams
  // Optional thresholds
  minFollowerGrowth?:    number;  // absolute new followers
  minEngagementRate?:    number;  // percent, likes+recasts / followers
  minPostsPerWeek?:      number;
}

const THRESHOLDS: Record<AchievementLevel, {
  minFollowerGrowth: number;
  minEngagementRate: number;
  minPostsPerWeek:   number;
}> = {
  bronze: { minFollowerGrowth: 50,   minEngagementRate: 1,  minPostsPerWeek: 2  },
  silver: { minFollowerGrowth: 250,  minEngagementRate: 3,  minPostsPerWeek: 5  },
  gold:   { minFollowerGrowth: 1000, minEngagementRate: 5,  minPostsPerWeek: 10 },
};

const NEYNAR_API = 'https://api.neynar.com/v2';

async function neynarFetch(path: string): Promise<any> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error('NEYNAR_API_KEY not set');

  const res = await fetch(`${NEYNAR_API}${path}`, {
    headers: {
      'api_key': apiKey,
      'Accept':  'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Neynar API error: ${res.status} ${path}`);
  return res.json();
}

// ── User lookup ───────────────────────────────────────────────────────────────

interface FarcasterUser {
  fid:             number;
  username:        string;
  follower_count:  number;
  following_count: number;
  verified_addresses: { eth_addresses: string[] };
}

async function lookupUser(
  params: SocialVerificationParams
): Promise<FarcasterUser | null> {
  try {
    if (params.fid) {
      const data = await neynarFetch(`/farcaster/user/bulk?fids=${params.fid}`);
      return data.users?.[0] || null;
    }
    if (params.handle) {
      const data = await neynarFetch(
        `/farcaster/user/by_username?username=${encodeURIComponent(params.handle)}`
      );
      return data.user || null;
    }
    // Fallback: look up by connected ETH wallet
    const data = await neynarFetch(
      `/farcaster/user/by_verification?address=${params.agentWallet}`
    );
    return data.result?.user || null;
  } catch {
    return null;
  }
}

// ── Casts (posts) in window ───────────────────────────────────────────────────

interface FarcasterCast {
  hash:       string;
  timestamp:  string;
  reactions: {
    likes_count:   number;
    recasts_count: number;
  };
  replies: { count: number };
}

async function fetchCastsInWindow(
  fid:           number,
  mintTimestamp: number,
): Promise<FarcasterCast[]> {
  const casts: FarcasterCast[] = [];
  let cursor: string | undefined;
  const mintDate = new Date(mintTimestamp * 1000).toISOString();

  do {
    const path   = `/farcaster/feed/user/casts?fid=${fid}&limit=100` +
                   (cursor ? `&cursor=${cursor}` : '');
    const data   = await neynarFetch(path);
    const batch: FarcasterCast[] = data.casts || [];

    // Filter to window and stop paginating if we've gone past mint date
    let doneEarly = false;
    for (const cast of batch) {
      if (cast.timestamp >= mintDate) {
        casts.push(cast);
      } else {
        doneEarly = true;
        break;
      }
    }

    cursor = doneEarly ? undefined : data.next?.cursor;
  } while (cursor);

  return casts;
}

// ── Wallet ownership verification ─────────────────────────────────────────────
// Ensures the Farcaster account is actually connected to the agent wallet
// Prevents claiming achievements for someone else's social growth

function verifyWalletConnection(
  user:        FarcasterUser,
  agentWallet: string,
): boolean {
  const verified = user.verified_addresses?.eth_addresses || [];
  return verified.some(
    addr => addr.toLowerCase() === agentWallet.toLowerCase()
  );
}

// ── Engagement rate ───────────────────────────────────────────────────────────

function calcEngagementRate(casts: FarcasterCast[], followers: number): number {
  if (casts.length === 0 || followers === 0) return 0;
  const totalEngagements = casts.reduce((sum, c) => {
    return sum +
      (c.reactions?.likes_count   || 0) +
      (c.reactions?.recasts_count || 0) +
      (c.replies?.count           || 0);
  }, 0);
  return (totalEngagements / casts.length / followers) * 100;
}

// ── Posts per week ────────────────────────────────────────────────────────────

function calcPostsPerWeek(casts: FarcasterCast[], windowDays: number): number {
  return windowDays > 0 ? (casts.length / windowDays) * 7 : 0;
}

// ── Level determination ───────────────────────────────────────────────────────

function determineLevel(
  followerGrowth: number,
  engagementRate: number,
  postsPerWeek:   number,
): AchievementLevel | null {
  for (const level of ['gold', 'silver', 'bronze'] as AchievementLevel[]) {
    const t = THRESHOLDS[level];
    if (
      followerGrowth >= t.minFollowerGrowth &&
      engagementRate >= t.minEngagementRate &&
      postsPerWeek   >= t.minPostsPerWeek
    ) return level;
  }
  return null;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifySocialMediaGrowth(
  params:         SocialVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);

  if (params.platform !== 'farcaster') {
    return {
      passed:        false,
      failureReason: `Platform '${params.platform}' not yet supported. Currently supported: farcaster.`,
      evidence: {
        checkedAt: now, dataSource: 'neynar_api',
        attestationUID, rawMetrics: { platform: params.platform },
      },
    };
  }

  // Look up user
  const user = await lookupUser(params);
  if (!user) {
    return {
      passed:        false,
      failureReason: 'Farcaster account not found. Provide handle or fid.',
      evidence: {
        checkedAt: now, dataSource: 'neynar_api',
        attestationUID, rawMetrics: {},
      },
    };
  }

  // Wallet ownership gate — must be connected to agent wallet
  if (!verifyWalletConnection(user, params.agentWallet)) {
    return {
      passed:        false,
      failureReason: `Farcaster account @${user.username} is not connected to wallet ${params.agentWallet}. Connect your wallet on Warpcast to verify ownership.`,
      evidence: {
        checkedAt: now, dataSource: 'neynar_api',
        attestationUID,
        rawMetrics: {
          fid:      user.fid,
          username: user.username,
          verifiedAddresses: JSON.stringify(user.verified_addresses?.eth_addresses || []),
        },
      },
    };
  }

  // Fetch casts in window
  const casts = await fetchCastsInWindow(user.fid, params.mintTimestamp);

  const currentFollowers = user.follower_count;
  const followerGrowth   = Math.max(0, currentFollowers - (params.baselineFollowers || 0));
  const engagementRate   = calcEngagementRate(casts, currentFollowers);
  const postsPerWeek     = calcPostsPerWeek(casts, params.windowDays);

  const rawMetrics = {
    fid:               user.fid,
    username:          user.username,
    currentFollowers,
    baselineFollowers: params.baselineFollowers || 0,
    followerGrowth,
    engagementRate:    parseFloat(engagementRate.toFixed(2)),
    postsPerWeek:      parseFloat(postsPerWeek.toFixed(1)),
    totalCasts:        casts.length,
    windowDays:        params.windowDays,
  };

  const evidence = {
    checkedAt:  now,
    dataSource: 'neynar_api',
    attestationUID,
    rawMetrics,
  };

  if (casts.length === 0) {
    return {
      passed:        false,
      failureReason: 'No posts found in commitment window.',
      evidence,
    };
  }

  const level = determineLevel(followerGrowth, engagementRate, postsPerWeek);

  if (!level) {
    return {
      passed:        false,
      failureReason: `Did not meet bronze threshold. growth=+${followerGrowth} followers, engagement=${engagementRate.toFixed(1)}%, posts/week=${postsPerWeek.toFixed(1)}`,
      evidence,
    };
  }

  return { passed: true, level, evidence };
}