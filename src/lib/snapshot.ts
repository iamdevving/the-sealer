/**
 * lib/snapshot.ts
 *
 * On every successful mint, call snapshotSVG() to:
 *   1. Store the rendered SVG to Vercel Blob (permanent, immutable)
 *   2. Store snapshot metadata in Upstash Redis keyed by UID
 *   3. Return the static URL
 *
 * The dynamic routes (/api/badge, /api/card, etc.) check Redis first.
 * If a static snapshot exists → redirect to it (immutable, CDN-cached).
 * If not → render live (pre-mint preview).
 *
 * Blob path scheme:
 *   credentials/badge/{uid}.svg
 *   credentials/card/{uid}.svg
 *   credentials/sealed/{uid}.svg
 *   credentials/sid/{uid}.svg
 *
 * Redis key scheme:
 *   snapshot:{uid} → SnapshotMeta JSON
 */

import { put } from '@vercel/blob'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export type Product = 'badge' | 'card' | 'sealed' | 'sid'

export interface SnapshotMeta {
  url: string
  product: Product
  mintedAt: string        // ISO timestamp
  attestationUID: string  // EAS attestation UID (0x...)
  paymentTxHash?: string
  paymentChain?: string   // 'base' | 'solana'
}

/**
 * Store a rendered SVG to Blob + metadata to Redis.
 * Call this immediately after EAS attestation confirms.
 */
export async function snapshotSVG(params: {
  uid: string
  product: Product
  svgContent: string
  attestationUID: string
  paymentTxHash?: string
  paymentChain?: string
}): Promise<SnapshotMeta> {
  const { uid, product, svgContent, attestationUID, paymentTxHash, paymentChain } = params

  const blobPath = `credentials/${product}/${uid}.svg`

  // Upload SVG to Vercel Blob — immutable, cache 1 year
  const blob = await put(blobPath, svgContent, {
    access: 'public',
    contentType: 'image/svg+xml',
    cacheControlMaxAge: 31536000,
  })

  const meta: SnapshotMeta = {
    url: blob.url,
    product,
    mintedAt: new Date().toISOString(),
    attestationUID,
    paymentTxHash,
    paymentChain,
  }

  // Store in Redis
  await redis.set(`snapshot:${uid}`, JSON.stringify(meta))

  console.log(`[snapshot] Stored ${product} ${uid} → ${blob.url}`)

  return meta
}

/**
 * Look up a snapshot by UID.
 * Returns null if not yet minted.
 */
export async function getSnapshot(uid: string): Promise<SnapshotMeta | null> {
  if (!uid || uid === 'demo' || uid === 'preview') return null

  try {
    const raw = await redis.get<string>(`snapshot:${uid}`)
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    // Redis not reachable — fall back to dynamic render
    return null
  }
}

/**
 * Check if a UID has been minted.
 */
export async function isMinted(uid: string): Promise<boolean> {
  const snap = await getSnapshot(uid)
  return snap !== null
}
