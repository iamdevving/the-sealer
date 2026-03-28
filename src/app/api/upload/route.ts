// src/app/api/upload/route.ts
//
// Accepts a PNG/JPG/WEBP upload, stores it to Vercel Blob,
// returns a permanent public URL for use in Card, SEALed, or Sealer ID.
//
// Payment: x402 via withX402Payment, $0.01 USDC
//
// SECURITY CHANGES vs original:
//   - Rate limited: 20 uploads per hour per IP
//   - No agentId field on this endpoint so no agentSig needed.
//     The x402 payment + file type/size validation are the guards here.
//
// Flow:
//   1. Agent calls POST /api/upload without payment → gets 402 challenge
//   2. Agent pays, retries with X-PAYMENT header
//   3. Server verifies payment, accepts multipart/form-data body
//   4. Stores to Vercel Blob at uploads/{uid}.{ext}
//   5. Returns { url, uid } — url is permanent public Blob URL

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { withZauthX402Payment } from '@/lib/zauth';
import { nanoid } from 'nanoid';
import { x402Challenge } from '@/lib/x402';
import { rateLimitRequest } from '@/lib/security';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const UPLOAD_PRICE_USDC = '0.01';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // ── SECURITY: Rate limiting ───────────────────────────────────────────────
  // 20 uploads per hour per IP — cheap action but still needs abuse protection
  const rateLimited = await rateLimitRequest(req, 'upload', 20, 3600);
  if (rateLimited) return rateLimited;

  return withZauthX402Payment(req, async (paymentChain: 'base' | 'solana' | undefined) => {
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return NextResponse.json(
          { error: 'Expected multipart/form-data body' },
          { status: 400 },
        );
      }

      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: 'Missing file field. Send multipart/form-data with field "file"' },
          { status: 400 },
        );
      }

      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error:    'Unsupported file type',
            allowed:  Array.from(ALLOWED_TYPES),
            received: file.type,
          },
          { status: 415 },
        );
      }

      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          {
            error:         'File too large',
            maxMB:         MAX_BYTES / 1024 / 1024,
            receivedBytes: file.size,
          },
          { status: 413 },
        );
      }

      const uid      = nanoid(12);
      const ext      = file.type.split('/')[1].replace('jpeg', 'jpg');
      const blobPath = `uploads/${uid}.${ext}`;

      let blobResult: { url: string };
      try {
        blobResult = await put(blobPath, file, {
          access:      'public',
          contentType: file.type,
        });
      } catch (err) {
        console.error('[upload] Vercel Blob error:', err);
        return NextResponse.json(
          { error: 'Storage failed. Check BLOB_READ_WRITE_TOKEN env var.' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        uid,
        url:     blobResult.url,
        type:    file.type,
        bytes:   file.size,
        paidVia: paymentChain ?? 'unknown',
        usage: {
          card:   `https://thesealer.xyz/api/card?imageUrl=${encodeURIComponent(blobResult.url)}&statement=...`,
          sealed: `https://thesealer.xyz/api/sealed?imageUrl=${encodeURIComponent(blobResult.url)}`,
          sid:    `https://thesealer.xyz/api/sid?imageUrl=${encodeURIComponent(blobResult.url)}&name=...`,
        },
      });
    },
    UPLOAD_PRICE_USDC,
    { schema: { properties: {
      input:  { properties: { body: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } },
      output: { properties: { example: { success: true, uid: 'abc123', url: 'https://blob.vercel-storage.com/abc.png', bytes: 204800 } } },
    } } },
  );
}

export async function GET() {
  return NextResponse.json({
    endpoint:    'POST /api/upload',
    description: 'Upload an image for use in attestation credentials',
    docs:        'https://thesealer.xyz/api/infoproducts',
    x402:        true,
    price:       '$0.01 USDC',
    networks:    ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    params: {
      file: 'image file (multipart/form-data) — png, jpg, webp, gif, max 5MB',
    },
  });
}