/**
 * /api/upload
 *
 * Accepts a PNG/JPG/WEBP upload, stores it to Vercel Blob,
 * returns a permanent public URL for use in Card, SEALed, or Sealer ID.
 *
 * Payment: x402 via withX402Payment, $0.01 USDC
 *
 * Flow:
 *   1. Agent calls POST /api/upload without payment → gets 402 challenge
 *   2. Agent pays, retries with X-PAYMENT header
 *   3. Server verifies payment, accepts multipart/form-data body
 *   4. Stores to Vercel Blob at uploads/{uid}.{ext}
 *   5. Returns { url, uid } — url is permanent public Blob URL
 *
 * The returned URL is then passed to:
 *   - /api/card?imageUrl=...
 *   - /api/sealed?imageUrl=...
 *   - /api/sid?imageUrl=...
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { withZauthX402Payment } from '@/lib/zauth'
import { nanoid } from 'nanoid'
import { x402Challenge } from '@/lib/x402'

// Max file size: 5MB
const MAX_BYTES = 5 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

// Upload costs $0.01 — utility step, not a mint
const UPLOAD_PRICE_USDC = '0.01'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return withZauthX402Payment(req, async (paymentChain: 'base' | 'solana' | undefined) => {
      // Parse multipart form
      let formData: FormData
      try {
        formData = await req.formData()
      } catch {
        return NextResponse.json(
          { error: 'Expected multipart/form-data body' },
          { status: 400 }
        )
      }

      const file = formData.get('file')
      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: 'Missing file field. Send multipart/form-data with field "file"' },
          { status: 400 }
        )
      }

      // Validate type
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error: 'Unsupported file type',
            allowed: Array.from(ALLOWED_TYPES),
            received: file.type,
          },
          { status: 415 }
        )
      }

      // Validate size
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          {
            error: 'File too large',
            maxMB: MAX_BYTES / 1024 / 1024,
            receivedBytes: file.size,
          },
          { status: 413 }
        )
      }

      // Generate UID and path
      const uid = nanoid(12)
      const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
      const blobPath = `uploads/${uid}.${ext}`

      // Upload to Vercel Blob
      let blobResult: { url: string }
      try {
        blobResult = await put(blobPath, file, {
          access: 'public',
          contentType: file.type,
        })
      } catch (err) {
        console.error('[upload] Vercel Blob error:', err)
        return NextResponse.json(
          { error: 'Storage failed. Check BLOB_READ_WRITE_TOKEN env var.' },
          { status: 500 }
        )
      }

      // Return URL + suggested usage
      return NextResponse.json({
        success: true,
        uid,
        url: blobResult.url,
        type: file.type,
        bytes: file.size,
        paidVia: paymentChain ?? 'unknown',
        usage: {
          card: `https://thesealer.xyz/api/card?imageUrl=${encodeURIComponent(blobResult.url)}&statement=...`,
          sealed: `https://thesealer.xyz/api/sealed?imageUrl=${encodeURIComponent(blobResult.url)}`,
          sid: `https://thesealer.xyz/api/sid?imageUrl=${encodeURIComponent(blobResult.url)}&name=...`,
        },
      })
    },
    UPLOAD_PRICE_USDC,
    { schema: { properties: {
      input: { properties: { body: { type: 'object', required: ['imageUrl'], properties: { imageUrl: { type: 'string' } } } } },
      output: { properties: { example: { success: true, uid: 'abc123', url: 'https://blob.vercel-storage.com/abc.png', bytes: 204800 } } },
    } } }
  )
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/upload',
    description: 'Upload an image for use in attestation credentials',
    docs: 'https://thesealer.xyz/api/infoproducts',
    x402: true,
    price: '$0.01 USDC',
    networks: ['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    params: {
      file: 'image file (multipart/form-data) — png, jpg, webp, gif, max 5MB',
    },
  });
}