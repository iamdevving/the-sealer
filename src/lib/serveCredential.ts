/**
 * lib/serveCredential.ts
 *
 * Shared middleware for all SVG credential routes:
 *   /api/badge, /api/card, /api/sealed, /api/sid
 *
 * Usage in each route:
 *
 *   export async function GET(req: NextRequest) {
 *     // Check for static snapshot first
 *     const staticResponse = await serveStaticIfMinted(req)
 *     if (staticResponse) return staticResponse
 *
 *     // Fall through to live render (preview / pre-mint)
 *     const svg = renderBadgeSVG(...)
 *     return svgResponse(svg)
 *   }
 *
 * Why redirect instead of proxy?
 *   - Vercel Blob URLs are CDN-served with proper cache headers
 *   - 301 redirect lets the client cache the final URL
 *   - Avoids double-transfer through the serverless function
 *   - Blob URL is permanent so 301 is safe
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSnapshot } from '@/lib/snapshot'

/**
 * If the UID in the request has a minted snapshot, redirect to the static Blob URL.
 * Returns null if not minted (caller should proceed with live render).
 */
export async function serveStaticIfMinted(req: NextRequest): Promise<NextResponse | null> {
  const { searchParams } = new URL(req.url)
  const uid = searchParams.get('uid')

  // No UID, or demo/preview UIDs → always live render
  if (!uid || uid === 'demo' || uid === 'preview') return null

  const snapshot = await getSnapshot(uid)
  if (!snapshot) return null

  // Permanent redirect to static Blob URL
  // Cache-Control: immutable tells CDN/browser this will never change
  return NextResponse.redirect(snapshot.url, {
    status: 301,
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Sealer-Minted': 'true',
      'X-Sealer-Attestation': snapshot.attestationUID,
      'X-Sealer-Minted-At': snapshot.mintedAt,
    },
  })
}

/**
 * Standard SVG response for live renders (pre-mint / preview).
 * No caching — always fresh until minted.
 */
export function svgResponse(svg: string, status = 200): NextResponse {
  return new NextResponse(svg, {
    status,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
      'X-Sealer-Minted': 'false',
    },
  })
}

/**
 * Example of how to integrate into /api/badge/route.ts:
 *
 * import { serveStaticIfMinted, svgResponse } from '@/lib/serveCredential'
 *
 * export async function GET(req: NextRequest) {
 *   // 1. Static snapshot check (post-mint)
 *   const staticRes = await serveStaticIfMinted(req)
 *   if (staticRes) return staticRes
 *
 *   // 2. Live render (preview / pre-mint)
 *   const { searchParams } = new URL(req.url)
 *   const statement = searchParams.get('statement') ?? ''
 *   const theme = searchParams.get('theme') ?? 'default'
 *   const svg = renderBadgeSVG({ statement, theme })
 *   return svgResponse(svg)
 * }
 */
