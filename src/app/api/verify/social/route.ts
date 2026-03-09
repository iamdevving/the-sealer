// src/app/api/verify/social/route.ts
import { NextRequest } from 'next/server';
import { verifySocialMediaGrowth } from '@/lib/verify/social';
import { handleVerifyRoute, handleGetRoute } from '@/lib/verify/route-handler';

export const runtime = 'nodejs';

export function POST(req: NextRequest) {
  return handleVerifyRoute(req, 'social_media_growth', (pending, params, uid) =>
    verifySocialMediaGrowth({
      agentWallet:       pending.subject,
      platform:          params.platform         || 'farcaster',
      handle:            params.handle,
      fid:               params.fid,
      windowDays:        params.windowDays        || 30,
      mintTimestamp:     pending.mintTimestamp,
      baselineFollowers: params.baselineFollowers || 0,
      minFollowerGrowth: params.minFollowerGrowth,
      minEngagementRate: params.minEngagementRate,
      minPostsPerWeek:   params.minPostsPerWeek,
    }, uid)
  );
}

export function GET(req: NextRequest) {
  return handleGetRoute(req);
}