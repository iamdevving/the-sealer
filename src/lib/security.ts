// src/lib/security.ts
// Shared security utilities for The Sealer Protocol
//
// Covers:
//   1. SSRF protection — validates imageUrl against an allowlist of safe domains
//      and blocks RFC-1918, loopback, and link-local (169.254.x.x / AWS metadata) ranges
//   2. Rate limiting — Redis-backed per-IP sliding window counter
//   3. Request validation helpers

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// ── SSRF Protection ──────────────────────────────────────────────────────────
//
// imageUrl is fetched server-side for NFT rendering. Without validation an
// attacker can force the server to make requests to:
//   - AWS Instance Metadata Service (169.254.169.254) → IAM credential theft
//   - Internal services on the VPC
//   - Localhost (127.0.0.1) — port scanning
//
// Strategy: allowlist of trusted image CDN hostnames only.
// Any URL not on the list is rejected before fetch.

const ALLOWED_IMAGE_HOSTS = new Set([
  // Vercel Blob (our own storage)
  'public.blob.vercel-storage.com',
  // IPFS gateways
  'ipfs.io',
  'cloudflare-ipfs.com',
  'gateway.pinata.cloud',
  'ipfs.filebase.io',
  // Common NFT / image CDNs
  'nft-cdn.alchemy.com',
  'res.cloudinary.com',
  'arweave.net',
  'cdn.helius-rpc.com',
  'metadata.ens.domains',
  // OpenSea / NFT platforms
  'i.seadn.io',
  'openseauserdata.com',
  // Image hosting
  'pbs.twimg.com',
  'abs.twimg.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  // Mirror / lens
  'mirror-media.imgix.net',
  'images.mirror.xyz',
]);

// Blocked IP ranges (SSRF protection)
// These should never be reachable from external imageUrl params
const BLOCKED_IP_PREFIXES = [
  '127.',       // loopback
  '10.',        // RFC-1918 private
  '172.16.',    // RFC-1918 private
  '172.17.',    // RFC-1918 private
  '172.18.',    // RFC-1918 private
  '172.19.',    // RFC-1918 private
  '172.20.',    // RFC-1918 private
  '172.21.',    // RFC-1918 private
  '172.22.',    // RFC-1918 private
  '172.23.',    // RFC-1918 private
  '172.24.',    // RFC-1918 private
  '172.25.',    // RFC-1918 private
  '172.26.',    // RFC-1918 private
  '172.27.',    // RFC-1918 private
  '172.28.',    // RFC-1918 private
  '172.29.',    // RFC-1918 private
  '172.30.',    // RFC-1918 private
  '172.31.',    // RFC-1918 private
  '192.168.',   // RFC-1918 private
  '169.254.',   // link-local / AWS metadata (169.254.169.254)
  '0.',         // this-network
  '::1',        // IPv6 loopback
  'fc00:',      // IPv6 unique local
  'fe80:',      // IPv6 link-local
];

export interface ImageUrlValidation {
  valid:  boolean;
  reason?: string;
}

export function validateImageUrl(imageUrl: string): ImageUrlValidation {
  if (!imageUrl || imageUrl.trim() === '') {
    return { valid: true }; // empty is fine — no server-side fetch will happen
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl.trim());
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }

  // Only allow http/https
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: `URL scheme '${parsed.protocol}' is not allowed. Use https.` };
  }

  // Prefer https
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS image URLs are accepted.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block raw IP addresses (catches 169.254.169.254 etc.)
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
                      /^\[?[0-9a-f:]+\]?$/.test(hostname);
  if (isIpAddress) {
    for (const prefix of BLOCKED_IP_PREFIXES) {
      if (hostname.startsWith(prefix)) {
        return { valid: false, reason: 'Direct IP addresses in that range are not allowed.' };
      }
    }
    return { valid: false, reason: 'Direct IP address URLs are not allowed. Use a hostname.' };
  }

  // Block localhost variants
  if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname === 'metadata' || hostname.endsWith('.internal') ||
      hostname.endsWith('.local')) {
    return { valid: false, reason: 'Local hostnames are not allowed.' };
  }

  // Allowlist check
  // Check exact hostname match OR *.allowedhost.com
  const isAllowed = ALLOWED_IMAGE_HOSTS.has(hostname) ||
    [...ALLOWED_IMAGE_HOSTS].some(allowed => hostname.endsWith('.' + allowed));

  if (!isAllowed) {
    return {
      valid: false,
      reason: `Image host '${hostname}' is not on the allowlist. ` +
               'Use Vercel Blob (via /api/upload) or a supported CDN.',
    };
  }

  return { valid: true };
}

/**
 * Safe image fetch with SSRF protection.
 * Validates URL against allowlist before any network request.
 * Use this everywhere imageUrl params are fetched server-side.
 */
export async function safeFetchImage(imageUrl: string): Promise<{
  data:    ArrayBuffer | null;
  mime:    string;
  error?:  string;
}> {
  const validation = validateImageUrl(imageUrl);
  if (!validation.valid) {
    return { data: null, mime: '', error: validation.reason };
  }

  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(8000),
      // Prevent redirect to internal hosts
      redirect: 'error',
    });

    if (!res.ok) {
      return { data: null, mime: '', error: `Image fetch failed: HTTP ${res.status}` };
    }

    const mime = res.headers.get('content-type') || 'image/png';
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowedMimes.some(m => mime.startsWith(m))) {
      return { data: null, mime: '', error: `Content-Type '${mime}' is not an allowed image type.` };
    }

    const data = await res.arrayBuffer();

    // Cap image size at 5MB
    if (data.byteLength > 5 * 1024 * 1024) {
      return { data: null, mime: '', error: 'Image exceeds 5MB size limit.' };
    }

    return { data, mime };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { data: null, mime: '', error: 'Image fetch timed out.' };
    }
    return { data: null, mime: '', error: `Image fetch error: ${String(err)}` };
  }
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────
//
// Redis-backed sliding window rate limiter.
// Used on all attestation endpoints to prevent spam minting.
//
// Default: 20 requests per hour per IP address.
// Tighter limit: 5 requests per minute per IP on payment endpoints.

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
  }
  return _redis;
}

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  resetAt:    number;   // unix seconds
}

/**
 * Sliding window rate limiter backed by Redis INCR + EXPIRE.
 *
 * @param key        Unique rate limit key, e.g. `rl:attest:${ip}`
 * @param limit      Max requests in window
 * @param windowSecs Window size in seconds
 */
export async function checkRateLimit(
  key:        string,
  limit:      number,
  windowSecs: number,
): Promise<RateLimitResult> {
  try {
    const redis   = getRedis();
    const current = await redis.incr(key);

    if (current === 1) {
      // First request in this window — set expiry
      await redis.expire(key, windowSecs);
    }

    const ttl = await redis.ttl(key);
    const resetAt = Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : windowSecs);

    if (current > limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    return { allowed: true, remaining: limit - current, resetAt };
  } catch (err) {
    // Redis unavailable — fail open to avoid blocking legitimate traffic
    // Log the error but don't block the request
    console.error('[rateLimit] Redis error (failing open):', err);
    return { allowed: true, remaining: 1, resetAt: Math.floor(Date.now() / 1000) + windowSecs };
  }
}

/**
 * Rate limit middleware for Next.js route handlers.
 * Returns a 429 NextResponse if rate limit is exceeded, or null if allowed.
 *
 * Usage:
 *   const limited = await rateLimitRequest(req, 'attest', 20, 3600);
 *   if (limited) return limited;
 */
export async function rateLimitRequest(
  req:        NextRequest,
  action:     string,
  limit:      number = 20,
  windowSecs: number = 3600,
): Promise<NextResponse | null> {
  const ip  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `rl:${action}:${ip}`;

  const result = await checkRateLimit(key, limit, windowSecs);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error:   'Rate limit exceeded.',
        message: `Too many requests. Try again after ${new Date(result.resetAt * 1000).toISOString()}.`,
        resetAt: result.resetAt,
      },
      {
        status: 429,
        headers: {
          'Retry-After':          String(result.resetAt - Math.floor(Date.now() / 1000)),
          'X-RateLimit-Limit':    String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':    String(result.resetAt),
        },
      },
    );
  }

  return null; // allowed
}
