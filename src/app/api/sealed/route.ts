// src/app/api/sealed/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// ─── Seal mark (white, for watermark) ────────────────────────────────────────
// Small base64 inline - using a minimal SVG seal mark as fallback
// Replace SEAL_MARK_B64 with the actual base64 from your mark file if available
const LOGO_B64 = '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';
const SEAL_MARK_SVG = `<image href="data:image/png;base64,${LOGO_B64}" x="-11" y="-11" width="22" height="22" preserveAspectRatio="xMidYMid meet" opacity="0.85"/>`;

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

    <!-- Footer gradient — light frosted -->
    <linearGradient id="footerGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#f5f7fa" stop-opacity="0.98"/>
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

    <!-- ── Sleeve background — transparent, border adapts to page ── -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="white" fill-opacity="0.01" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>

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
      fill="#f0f2f5"/>
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H/2 - 10}"
      font-family="monospace" font-size="10" fill="#aaa"
      text-anchor="middle" letter-spacing="2">NO IMAGE</text>
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H/2 + 10}"
      font-family="monospace" font-size="8" fill="#bbb"
      text-anchor="middle" letter-spacing="1">?imageUrl=https://...</text>
    `}

    <!-- ── Sleeve plastic sheen overlay ── -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="url(#sleeveSheen)" filter="url(#plastic)"/>

    <!-- Left edge refraction -->
    <rect x="${SLEEVE_PAD - 4}" y="${SLEEVE_PAD}" width="6" height="${INNER_H}"
      fill="url(#edgeLeft)" opacity="0.4"/>

    <!-- Top edge refraction -->
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD - 4}" width="${INNER_W}" height="6"
      fill="url(#edgeTop)" opacity="0.5"/>

    <!-- ── Footer bar ── -->
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD + INNER_H}"
      width="${INNER_W}" height="28"
      fill="url(#footerGrad)" rx="0"/>
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD + INNER_H}"
      width="${INNER_W}" height="1"
      fill="#000" opacity="0.08"/>

    <!-- Footer: TX left -->
    <text x="${SLEEVE_PAD + 8}" y="${SLEEVE_PAD + INNER_H + 11}"
      font-family="monospace" font-size="6" fill="#999"
      letter-spacing="0.5">TX HASH</text>
    <text x="${SLEEVE_PAD + 8}" y="${SLEEVE_PAD + INNER_H + 22}"
      font-family="monospace" font-size="7" fill="#555"
      letter-spacing="0.5">${uid}</text>

    <!-- Footer: date center - two lines like TX block -->
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H + 11}"
      font-family="monospace" font-size="5.5" fill="#999"
      text-anchor="middle" letter-spacing="1">ISSUE DATE</text>
    <text x="${W/2}" y="${SLEEVE_PAD + INNER_H + 22}"
      font-family="monospace" font-size="7" fill="#555"
      text-anchor="middle" letter-spacing="0.5">${dateStr}</text>

    <!-- Footer: seal mark right (minimal) -->
    <g transform="translate(${W - SLEEVE_PAD - 28}, ${SLEEVE_PAD + INNER_H + 14})">
      ${SEAL_MARK_SVG}
    </g>

    <!-- ── Top sleeve opening edge ── -->
    <rect x="${SLEEVE_PAD - 1}" y="${SLEEVE_PAD - 1}"
      width="${INNER_W + 2}" height="2"
      fill="#ffffff" opacity="0.06"/>

    <!-- Outer border subtle shadow -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>

  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
