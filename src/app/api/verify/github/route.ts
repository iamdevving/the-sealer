// src/app/api/verify/github/route.ts
import { NextRequest } from 'next/server';
import { verifyCodeSoftwareDelivery } from '@/lib/verify/github';
import { handleVerifyRoute, handleGetRoute } from '@/lib/verify/route-handler';

export const runtime = 'nodejs';

export function POST(req: NextRequest) {
  return handleVerifyRoute(req, 'code_software_delivery', (pending, params, uid) =>
    verifyCodeSoftwareDelivery({
      agentWallet:     pending.subject,
      repoOwner:       params.repoOwner,
      repoName:        params.repoName,
      githubUsername:  params.githubUsername,
      windowDays:      params.windowDays  || 30,
      mintTimestamp:   pending.mintTimestamp,
      requireCIPass:   params.requireCIPass,
      minLinesChanged: params.minLinesChanged,
    }, uid)
  );
}

export function GET(req: NextRequest) {
  return handleGetRoute(req);
}