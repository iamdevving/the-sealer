// src/app/api/sealed/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// ─── Seal mark (white, for watermark) ────────────────────────────────────────
// Small base64 inline - using a minimal SVG seal mark as fallback
// Replace SEAL_MARK_B64 with the actual base64 from your mark file if available
const SEAL_MARK_SVG = `<g opacity="0.18">
  <circle cx="0" cy="0" r="22" fill="none" stroke="white" stroke-width="1.5"/>
  <text x="0" y="4" font-family="monospace" font-size="9" font-weight="bold"
    fill="white" text-anchor="middle" letter-spacing="1">SEAL</text>
</g>`;

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncateHash(h: string) {
  return h ? '0x' + h.slice(2, 6) + '...' + h.slice(-4) : '0x????...????';
}

// Card sleeve dimensions — portrait, trading card ratio ~63×88mm → 315×440px
const W = 315;
const H = 440;
const SLEEVE_PAD = 12;      // sleeve border thickness
const INNER_W = W - SLEEVE_PAD * 2;
const INNER_H = H - SLEEVE_PAD * 2 - 28; // 28px footer

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const imageUrl = searchParams.get('imageUrl') || '';
  const txHash   = searchParams.get('txHash') || '';
  const chain    = esc(searchParams.get('chain') || 'Base');
  const dateStr  = esc(formatDate(new Date()));
  const uid      = truncateHash(txHash);

  // Fetch and embed image as base64 if URL provided
  let imgData = '';
  let imgMime = 'image/png';
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        imgMime = res.headers.get('content-type') || 'image/png';
        imgData = `data:${imgMime};base64,${b64}`;
      }
    } catch {}
  }

  // ── SVG ──────────────────────────────────────────────────────────────────
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Sleeve plastic sheen gradient -->
    <linearGradient id="sleeveSheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#e8f0ff" stop-opacity="0.18"/>
      <stop offset="30%"  stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="60%"  stop-color="#c0d0f0" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.14"/>
    </linearGradient>

    <!-- Plastic edge refraction -->
    <linearGradient id="edgeLeft" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="edgeTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>

    <!-- Footer gradient -->
    <linearGradient id="footerGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#0a0e1a"/>
      <stop offset="100%" stop-color="#060810"/>
    </linearGradient>

    <!-- Clip image to inner bounds -->
    <clipPath id="imgClip">
      <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
        width="${INNER_W}" height="${INNER_H}" rx="3"/>
    </clipPath>

    <!-- Clip whole card -->
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}" rx="10"/>
    </clipPath>

    <!-- Sleeve noise texture -->
    <filter id="plastic">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3"
        stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
      <feBlend in="SourceGraphic" in2="grey" mode="soft-light" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>

    <!-- Subtle vignette for image -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%"   stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.4)"/>
    </radialGradient>
  </defs>

  <g clip-path="url(#cardClip)">

    <!-- ── Sleeve background ── -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="#111827" stroke="#2a3550" stroke-width="1"/>

    <!-- Sleeve border inner highlight -->
    <rect x="1" y="1" width="${W-2}" height="${H-2}" rx="9"
      fill="none" stroke="#3a4870" stroke-width="0.5" opacity="0.6"/>

    <!-- ── Image area ── -->
    ${imgData ? `
    <image href="${imgData}"
      x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
      width="${INNER_W}" height="${INNER_H}"
      clip-path="url(#imgClip)"
      preserveAspectRatio="xMidYMid slice"/>
    <!-- Vignette over image -->
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
      width="${INNER_W}" height="${INNER_H}"
      fill="url(#vignette)" clip-path="url(#imgClip)"/>
    ` : `
    <!-- No image placeholder -->
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
      width="${INNER_W}" height="${INNER_H}" rx="3"
      fill="#0d1220"/>
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H/2 - 10}"
      font-family="monospace" font-size="10" fill="#2a3550"
      text-anchor="middle" letter-spacing="2">NO IMAGE</text>
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H/2 + 10}"
      font-family="monospace" font-size="8" fill="#1a2540"
      text-anchor="middle" letter-spacing="1">?imageUrl=https://...</text>
    `}

    <!-- ── Sleeve plastic sheen overlay ── -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="url(#sleeveSheen)" filter="url(#plastic)"/>

    <!-- Left edge refraction -->
    <rect x="${SLEEVE_PAD - 4}" y="${SLEEVE_PAD}" width="6" height="${INNER_H}"
      fill="url(#edgeLeft)" opacity="0.7"/>

    <!-- Top edge refraction -->
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD - 4}" width="${INNER_W}" height="6"
      fill="url(#edgeTop)" opacity="0.5"/>

    <!-- ── Footer bar ── -->
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD + INNER_H}"
      width="${INNER_W}" height="28"
      fill="url(#footerGrad)" rx="0"/>
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD + INNER_H}"
      width="${INNER_W}" height="1"
      fill="#2a3a6a" opacity="0.8"/>

    <!-- Footer: TX left -->
    <text x="${SLEEVE_PAD + 8}" y="${SLEEVE_PAD + INNER_H + 11}"
      font-family="monospace" font-size="6" fill="#4a6090"
      letter-spacing="0.5">TX</text>
    <text x="${SLEEVE_PAD + 8}" y="${SLEEVE_PAD + INNER_H + 22}"
      font-family="monospace" font-size="7" fill="#6a80b0"
      letter-spacing="0.5">${uid}</text>

    <!-- Footer: date center -->
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H + 17}"
      font-family="monospace" font-size="7" fill="#5a70a0"
      text-anchor="middle" letter-spacing="0.5">${dateStr}</text>

    <!-- Footer: seal mark right (minimal) -->
    <g transform="translate(${W - SLEEVE_PAD - 20}, ${SLEEVE_PAD + INNER_H + 14})">
      ${SEAL_MARK_SVG}
    </g>

    <!-- ── Watermark: THESEALER.XYZ diagonal ── -->
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H - 16}"
      font-family="monospace" font-size="7" fill="white"
      text-anchor="middle" letter-spacing="2" opacity="0.12">THESEALER.XYZ</text>

    <!-- ── Top sleeve opening edge ── -->
    <rect x="${SLEEVE_PAD - 1}" y="${SLEEVE_PAD - 1}"
      width="${INNER_W + 2}" height="2"
      fill="#ffffff" opacity="0.06"/>

    <!-- Outer border glow -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="none" stroke="#1e2d4a" stroke-width="2"/>

  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
