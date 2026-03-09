// src/app/api/verify/defi/route.ts
import { NextRequest } from 'next/server';
import { verifyDefiTradingPerformance } from '@/lib/verify/defi';
import { handleVerifyRoute, handleGetRoute } from '@/lib/verify/route-handler';

export const runtime = 'nodejs';

export function POST(req: NextRequest) {
  return handleVerifyRoute(req, 'defi_trading_performance', (pending, params, uid) =>
    verifyDefiTradingPerformance({
      agentWallet:   params.agentWallet || pending.subject,
      protocol:      params.protocol    || 'unknown',
      windowDays:    params.windowDays  || 30,
      mintTimestamp: pending.mintTimestamp,
      minTradeCount: params.minTradeCount,
      minVolumeUSD:  params.minVolumeUSD,
      minPnlPercent: params.minPnlPercent,
    }, uid)
  );
}

export function GET(req: NextRequest) {
  return handleGetRoute(req);
}