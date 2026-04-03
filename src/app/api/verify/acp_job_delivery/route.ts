// src/app/api/verify/acp_job_delivery/route.ts
//
// Thin route wrapper for the ACP Job Delivery verifier.
// All scoring, EAS attestation, NFT minting, and Redis updates handled
// by handleVerifyRoute in src/lib/verify/route-handler.ts.

import { NextRequest } from 'next/server';
import { verifyAcpJobDelivery } from '@/lib/verify/acp-job-delivery';
import { handleVerifyRoute, handleGetRoute } from '@/lib/verify/route-handler';

export const runtime     = 'nodejs';
export const maxDuration = 90; // Alchemy getLogs can be slow on large block ranges

export function POST(req: NextRequest) {
  return handleVerifyRoute(req, 'acp_job_delivery', (pending, params) =>
    verifyAcpJobDelivery({
      agentWallet:           params.agentWallet || pending.subject,
      acpContractAddress:    params.acpContractAddress || '',
      mintBlock:             params.mintBlock ? BigInt(params.mintBlock) : BigInt(0),
      minCompletedJobsDelta: Number(params.minCompletedJobsDelta ?? 0),
      minSuccessRate:        Number(params.minSuccessRate        ?? 0),
      minUniqueBuyersDelta:  Number(params.minUniqueBuyersDelta  ?? 0),
    })
  );
}

export function GET(req: NextRequest) {
  return handleGetRoute(req);
}