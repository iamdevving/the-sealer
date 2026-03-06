// src/app/api/webhooks/alchemy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import * as crypto from 'crypto';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function verifySignature(rawBody: string, signature: string, signingKey: string): boolean {
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(rawBody, 'utf8');
  const digest = hmac.digest('hex');
  return signature === digest;
}

export async function POST(req: NextRequest) {
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  const signature  = req.headers.get('x-alchemy-signature') || '';
  const rawBody    = await req.text();

  console.log(`[Webhook] Received — sig: ${signature ? 'present' : 'missing'}, body length: ${rawBody.length}`);

  // Verify signature if key is set
  if (signingKey && signature) {
    const valid = verifySignature(rawBody, signature, signingKey);
    if (!valid) {
      console.log(`[Webhook] Invalid signature — rejected`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    console.log(`[Webhook] Signature verified`);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.log(`[Webhook] Invalid JSON`);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const webhookType = payload?.type;
  const activities  = payload?.event?.activity ?? [];
  console.log(`[Webhook] Type: ${webhookType}, activities: ${activities.length}`);

  for (const activity of activities) {
    const contractAddress = (activity?.rawContract?.address || activity?.contractAddress || '').toLowerCase();
    const tokenId         = activity?.erc721TokenId || activity?.tokenId;
    const fromAddress     = activity?.fromAddress;
    const toAddress       = activity?.toAddress;

    console.log(`[Webhook] Activity — contract: ${contractAddress}, tokenId: ${tokenId}, from: ${fromAddress}, to: ${toAddress}`);

    if (!contractAddress || !tokenId) {
      console.log(`[Webhook] Skipping — missing contract or tokenId`);
      continue;
    }

    // Look up mirror by original contract + tokenId
    const mirrorKey     = `mirror:source:${contractAddress}:${tokenId}`;
    const mirrorTokenId = await redis.get<string>(mirrorKey);

    if (!mirrorTokenId) {
      console.log(`[Webhook] No mirror found for ${contractAddress}:${tokenId}`);
      continue;
    }

    console.log(`[Webhook] Mirror found — mirrorTokenId: ${mirrorTokenId}`);

    // Mark mirror as invalidated
    const dataKey = `mirror:data:${mirrorTokenId}`;
    const dataRaw = await redis.get<string>(dataKey);
    if (!dataRaw) {
      console.log(`[Webhook] Mirror data missing for tokenId: ${mirrorTokenId}`);
      continue;
    }

    const data         = typeof dataRaw === 'string' ? JSON.parse(dataRaw) : dataRaw;
    data.invalidated   = true;
    data.invalidatedAt = new Date().toISOString();
    data.newOwner      = toAddress;

    await redis.set(dataKey, JSON.stringify(data));
    console.log(`[Webhook] ✅ Mirror ${mirrorTokenId} invalidated — original NFT transferred from ${fromAddress} to ${toAddress}`);
  }

  return NextResponse.json({ ok: true });
}