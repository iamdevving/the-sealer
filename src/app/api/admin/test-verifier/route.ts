// src/app/api/admin/test-verifier/route.ts
//
// POST /api/admin/test-verifier
// Auth: Authorization: Bearer <CRON_SECRET>
//
// Calls any verifier function directly — no Redis entry needed, no EAS attestation,
// no payment. Pure dry-run: returns the raw VerificationResult.
//
// Body:
//   claimType    string   — which verifier to run
//   agentWallet  string   — wallet to check (any wallet, doesn't have to be yours)
//   mintTimestamp number  — unix seconds, how far back to look (default: 30 days ago)
//   windowDays   number   — commitment window (default: 30)
//   ...params            — claimType-specific thresholds (same as attest-commitment)
//
// Examples:
//
// x402:
//   { "claimType": "x402_payment_reliability", "agentWallet": "0x...",
//     "minSuccessRate": 90, "minTotalUSD": 10 }
//
// DeFi Base:
//   { "claimType": "defi_trading_performance", "agentWallet": "0x...",
//     "chain": "base", "minTradeCount": 5, "minVolumeUSD": 100 }
//
// DeFi Solana:
//   { "claimType": "defi_trading_performance", "agentWallet": "<solana pubkey>",
//     "chain": "solana", "minTradeCount": 3, "minVolumeUSD": 50 }
//
// GitHub (no Gist — ownership unverified but still runs):
//   { "claimType": "code_software_delivery", "agentWallet": "0x...",
//     "repoOwner": "someuser", "repoName": "somerepo",
//     "githubUsername": "someuser", "minMergedPRs": 1, "minCommits": 3 }
//
// GitHub (with Gist ownership proof):
//   { "claimType": "code_software_delivery", "agentWallet": "0x...",
//     "repoOwner": "someuser", "repoName": "somerepo",
//     "githubUsername": "someuser", "walletGithubSig": "<gistId>",
//     "minMergedPRs": 1 }
//
// Website:
//   { "claimType": "website_app_delivery", "agentWallet": "0x...",
//     "url": "https://thesealer.xyz", "minPerformanceScore": 50 }
//
// Website (with DNS ownership):
//   { "claimType": "website_app_delivery", "agentWallet": "0x...",
//     "url": "https://example.com", "requireDnsVerify": true,
//     "dnsVerifyRecord": "sealer-verify=0xYourWallet" }

import { NextRequest, NextResponse } from 'next/server';
import { verifyX402PaymentReliability }  from '@/lib/verify/x402';
import { verifyDefiTradingPerformance }   from '@/lib/verify/defi';
import { verifyCodeSoftwareDelivery }     from '@/lib/verify/github';
import { verifyWebsiteAppDelivery }       from '@/lib/verify/website';

export const runtime     = 'nodejs';
export const maxDuration = 60;

const TEST_UID = 'test-dry-run-no-attestation';

export async function POST(req: NextRequest) {
  // Auth gate — same secret as cron
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { claimType, agentWallet, windowDays = 30 } = body;
  if (!claimType) return NextResponse.json({ error: 'claimType required' }, { status: 400 });
  if (!agentWallet) return NextResponse.json({ error: 'agentWallet required' }, { status: 400 });

  // Default mintTimestamp = windowDays ago
  const mintTimestamp: number = body.mintTimestamp
    ?? Math.floor(Date.now() / 1000) - windowDays * 86400;

  const started = Date.now();

  try {
    let result;

    switch (claimType) {

      case 'x402_payment_reliability':
        result = await verifyX402PaymentReliability({
          agentWallet,
          windowDays,
          mintTimestamp,
          minSuccessRate:            body.minSuccessRate            ?? 0,
          minTotalUSD:               body.minTotalUSD               ?? 0,
          requireDistinctRecipients: body.requireDistinctRecipients ?? 0,
          maxGapHours:               body.maxGapHours,
          metric:                    'success_rate',
          target:                    body.minSuccessRate ?? 95,
          chain:                     'base',
          baselineSnapshot:          { txCount: 0, timestamp: mintTimestamp },
        }, TEST_UID);
        break;

      case 'defi_trading_performance':
        result = await verifyDefiTradingPerformance({
          agentWallet,
          protocol:      body.protocol      ?? 'any',
          chain:         body.chain         ?? 'base',
          windowDays,
          mintTimestamp,
          minTradeCount: body.minTradeCount ?? 0,
          minVolumeUSD:  body.minVolumeUSD  ?? 0,
          minPnlPercent: body.minPnlPercent,
        }, TEST_UID);
        break;

      case 'code_software_delivery':
        if (!body.repoOwner || !body.repoName || !body.githubUsername) {
          return NextResponse.json(
            { error: 'repoOwner, repoName, and githubUsername required for code_software_delivery' },
            { status: 400 },
          );
        }
        result = await verifyCodeSoftwareDelivery({
          agentWallet,
          repoOwner:       body.repoOwner,
          repoName:        body.repoName,
          githubUsername:  body.githubUsername,
          walletGithubSig: body.walletGithubSig,
          windowDays,
          mintTimestamp,
          minMergedPRs:    body.minMergedPRs    ?? 0,
          minCommits:      body.minCommits       ?? 0,
          requireCIPass:   body.requireCIPass    ?? false,
          minLinesChanged: body.minLinesChanged  ?? 0,
        }, TEST_UID);
        break;

      case 'website_app_delivery':
        if (!body.url) {
          return NextResponse.json(
            { error: 'url required for website_app_delivery' },
            { status: 400 },
          );
        }
        result = await verifyWebsiteAppDelivery({
          agentWallet,
          url:                 body.url,
          dnsVerifyRecord:     body.dnsVerifyRecord,
          windowDays,
          mintTimestamp,
          requireHttps:        body.requireHttps        ?? true,
          requireDnsVerify:    body.requireDnsVerify     ?? false,
          minPerformanceScore: body.minPerformanceScore  ?? 0,
          minAccessibility:    body.minAccessibility     ?? 0,
        }, TEST_UID);
        break;

      default:
        return NextResponse.json(
          { error: `Unknown or disabled claimType: ${claimType}. Active: x402_payment_reliability, defi_trading_performance, code_software_delivery, website_app_delivery` },
          { status: 400 },
        );
    }

    return NextResponse.json({
      claimType,
      agentWallet,
      mintTimestamp,
      windowDays,
      durationMs: Date.now() - started,
      result,
    });

  } catch (err) {
    return NextResponse.json({
      claimType,
      agentWallet,
      error:      String(err),
      durationMs: Date.now() - started,
    }, { status: 500 });
  }
}