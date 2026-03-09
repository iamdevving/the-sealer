// src/app/api/verify/website/route.ts
import { NextRequest } from 'next/server';
import { verifyWebsiteAppDelivery } from '@/lib/verify/website';
import { handleVerifyRoute, handleGetRoute } from '@/lib/verify/route-handler';

export const runtime = 'nodejs';

export function POST(req: NextRequest) {
  return handleVerifyRoute(req, 'website_app_delivery', (pending, params, uid) =>
    verifyWebsiteAppDelivery({
      agentWallet:         pending.subject,
      url:                 params.url,
      dnsVerifyRecord:     params.dnsVerifyRecord,
      windowDays:          params.windowDays     || 30,
      mintTimestamp:       pending.mintTimestamp,
      requireHttps:        params.requireHttps   !== false,
      requireDnsVerify:    params.requireDnsVerify,
      minPerformanceScore: params.minPerformanceScore,
      minAccessibility:    params.minAccessibility,
    }, uid)
  );
}

export function GET(req: NextRequest) {
  return handleGetRoute(req);
}