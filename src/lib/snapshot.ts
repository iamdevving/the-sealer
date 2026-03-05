// src/lib/snapshot.ts
import { put } from '@vercel/blob'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export type Product = 'badge' | 'card' | 'sleeve' | 'sid'

export interface SnapshotMeta {
  url: string
  product: Product
  mintedAt: string
  attestationUID: string
  paymentTxHash?: string
  paymentChain?: string
}

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

  await redis.set(`snapshot:${uid}`, JSON.stringify(meta))
  console.log(`[snapshot] Stored ${product} ${uid} → ${blob.url}`)

  return meta
}

export async function getSnapshot(uid: string): Promise<SnapshotMeta | null> {
  if (!uid || uid === 'demo' || uid === 'preview') return null
  try {
    const raw = await redis.get<string>(`snapshot:${uid}`)
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

export async function isMinted(uid: string): Promise<boolean> {
  const snap = await getSnapshot(uid)
  return snap !== null
}
