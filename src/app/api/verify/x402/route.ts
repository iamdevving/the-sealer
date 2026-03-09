// src/app/api/verify/x402/route.ts
import { NextRequest } from 'next/server';
import { verifyX402PaymentReliability } from '@/lib/verify/x402';
import { handleVerifyRoute, handleGetRoute } from '@/lib/verify/route-handler';

export const runtime = 'nodejs';

export function POST(req: NextRequest) {
  return handleVerifyRoute(req, 'x402_payment_reliability', (pending, params, uid) =>
    verifyX402PaymentReliability({
      agentWallet:               params.agentWallet || pending.subject,
      windowDays:                params.windowDays  || 30,
      minSuccessRate:            params.minSuccessRate,
      minTotalUSD:               params.minTotalUSD,
      requireDistinctRecipients: params.requireDistinctRecipients,
      maxGapHours:               params.maxGapHours,
      metric:                    params.metric || 'success_rate',
      target:                    params.target || 98,
      chain:                     'base',
      mintTimestamp:             pending.mintTimestamp,
      baselineSnapshot:          params.baselineSnapshot || { txCount: 0, timestamp: pending.mintTimestamp },
    }, uid)
  );
}

export function GET(req: NextRequest) {
  return handleGetRoute(req);
}