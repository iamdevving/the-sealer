// src/app/api/sleeve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { MARK_BLACK } from '@/lib/assets';

export const runtime = 'nodejs';

// ─── Chain logos (embedded path data) ─────────────────────────────────────────
const SOLANA_LOGO_PATH = `M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0067 100.84 67.3436C100.99 67.6806 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 34.3032C83.4444 33.9248 83.0058 33.6231 82.5185 33.4169C82.0312 33.2108 81.5055 33.1045 80.9743 33.1048H1.93563C1.55849 33.1048 1.18957 33.2121 0.874202 33.4136C0.558829 33.6151 0.31074 33.9019 0.160416 34.2388C0.0100923 34.5758 -0.0359181 34.9482 0.0280382 35.3103C0.0919944 35.6723 0.263131 36.0083 0.520422 36.277L17.2061 53.6968C17.5676 54.0742 18.0047 54.3752 18.4904 54.5814C18.9762 54.7875 19.5002 54.8944 20.0301 54.8952H99.0644C99.4415 54.8952 99.8104 54.7879 100.126 54.5864C100.441 54.3849 100.689 54.0981 100.84 53.7612C100.99 53.4242 101.036 53.0518 100.972 52.6897C100.908 52.3277 100.737 51.9917 100.48 51.723L83.8068 34.3032ZM1.93563 21.7905H80.9743C81.5055 21.7907 82.0312 21.6845 82.5185 21.4783C83.0058 21.2721 83.4444 20.9704 83.8068 20.592L100.48 3.17219C100.737 2.90357 100.908 2.56758 100.972 2.2055C101.036 1.84342 100.99 1.47103 100.84 1.13408C100.689 0.79713 100.441 0.510296 100.126 0.308823C99.8104 0.107349 99.4415 1.24074e-05 99.0644 0L20.0301 0C19.5002 0.000878397 18.9762 0.107699 18.4904 0.313848C18.0047 0.519998 17.5676 0.821087 17.2061 1.19848L0.524723 18.6183C0.267681 18.8866 0.0966198 19.2223 0.0325185 19.5839C-0.0315829 19.9456 0.0140624 20.3177 0.163856 20.6545C0.31365 20.9913 0.561081 21.2781 0.875804 21.4799C1.19053 21.6817 1.55886 21.7896 1.93563 21.7905Z`;

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function truncateHash(h: string) {
  return h ? '0x' + h.slice(2, 6) + '...' + h.slice(-4) : '0x????...????';
}

// Card layout constants
const W           = 315;   // fixed card width
const SLEEVE_PAD  = 12;    // sleeve border
const FOOTER_H    = 28;    // footer bar height
const INNER_W     = W - SLEEVE_PAD * 2;

// Image ratio bounds — min 9:16 portrait, max 16:9 landscape
const MIN_RATIO     = 9 / 16;
const MAX_RATIO     = 16 / 9;
const DEFAULT_RATIO = 63 / 88; // trading card default if no image

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const imageUrl  = searchParams.get('imageUrl') || '';
  const txHash    = searchParams.get('txHash') || '';
  const chain     = esc(searchParams.get('chain') || 'Base');
  const dateStr   = esc(formatDate(new Date()));
  const uid       = truncateHash(txHash);

  const paramW    = parseInt(searchParams.get('imgW') || '0');
  const paramH    = parseInt(searchParams.get('imgH') || '0');

  let imgData  = '';
  let imgMime  = 'image/png';
  let imgRatio = DEFAULT_RATIO;

  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        imgMime   = res.headers.get('content-type') || 'image/png';
        imgData   = `data:${imgMime};base64,${b64}`;

        if (paramW > 0 && paramH > 0) {
          imgRatio = paramW / paramH;
        } else if (imgMime.includes('png')) {
          const view = new DataView(buf);
          if (buf.byteLength >= 24) {
            const pngW = view.getUint32(16);
            const pngH = view.getUint32(20);
            if (pngW > 0 && pngH > 0) imgRatio = pngW / pngH;
          }
        } else if (imgMime.includes('jpeg') || imgMime.includes('jpg')) {
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length - 8; i++) {
            if (bytes[i] === 0xFF && (bytes[i+1] === 0xC0 || bytes[i+1] === 0xC2)) {
              const jpgH = (bytes[i+5] << 8) | bytes[i+6];
              const jpgW = (bytes[i+7] << 8) | bytes[i+8];
              if (jpgW > 0 && jpgH > 0) { imgRatio = jpgW / jpgH; break; }
            }
          }
        }
      }
    } catch {}
  }

  imgRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, imgRatio));

  const INNER_H  = Math.round(INNER_W / imgRatio);
  const H        = INNER_H + SLEEVE_PAD * 2 + FOOTER_H;
  const FOOTER_Y = SLEEVE_PAD + INNER_H;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sleeveSheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#e8f0ff" stop-opacity="0.18"/>
      <stop offset="30%"  stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="60%"  stop-color="#c0d0f0" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.14"/>
    </linearGradient>
    <linearGradient id="edgeLeft" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="edgeTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="footerGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#f8f9fc" stop-opacity="1"/>
      <stop offset="100%" stop-color="#eef0f5" stop-opacity="1"/>
    </linearGradient>
    <clipPath id="imgClip">
      <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
        width="${INNER_W}" height="${INNER_H}" rx="3"/>
    </clipPath>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}" rx="10"/>
    </clipPath>
    <filter id="plastic">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3"
        stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
      <feBlend in="SourceGraphic" in2="grey" mode="soft-light" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%"   stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.4)"/>
    </radialGradient>
    <linearGradient id="solanaLogoGrad" x1="8.52558" y1="90.0973" x2="88.9933" y2="-3.01622" gradientUnits="userSpaceOnUse">
      <stop offset="0.08" stop-color="#9945FF"/>
      <stop offset="0.3"  stop-color="#8752F3"/>
      <stop offset="0.5"  stop-color="#5497D5"/>
      <stop offset="0.6"  stop-color="#43B4CA"/>
      <stop offset="0.72" stop-color="#28E0B9"/>
      <stop offset="0.97" stop-color="#19FB9B"/>
    </linearGradient>
  </defs>

  <g clip-path="url(#cardClip)">

    <!-- Sleeve background -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="white" fill-opacity="0.01" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>

    <!-- Image area -->
    ${imgData ? `
    <image href="${imgData}"
      x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
      width="${INNER_W}" height="${INNER_H}"
      clip-path="url(#imgClip)"
      preserveAspectRatio="xMidYMid meet"/>
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD}"
      width="${INNER_W}" height="${INNER_H}"
      fill="url(#vignette)" clip-path="url(#imgClip)"/>
    ` : `
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

    <!-- Sleeve plastic sheen -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="10"
      fill="url(#sleeveSheen)" filter="url(#plastic)"/>

    <!-- Edge refractions -->
    <rect x="${SLEEVE_PAD - 4}" y="${SLEEVE_PAD}" width="6" height="${INNER_H}"
      fill="url(#edgeLeft)" opacity="0.4"/>
    <rect x="${SLEEVE_PAD}" y="${SLEEVE_PAD - 4}" width="${INNER_W}" height="6"
      fill="url(#edgeTop)" opacity="0.5"/>

    <!-- Footer bar -->
    <rect x="${SLEEVE_PAD}" y="${FOOTER_Y}"
      width="${INNER_W}" height="${FOOTER_H}"
      fill="url(#footerGrad)" rx="0"/>
    <rect x="${SLEEVE_PAD}" y="${FOOTER_Y}"
      width="${INNER_W}" height="1"
      fill="#000" opacity="0.08"/>

    <!-- Footer: chain logo -->
    ${chain === 'Solana'
      ? `<g transform="translate(20 ${FOOTER_Y + 7.901}) scale(0.138614)">
          <path d="${SOLANA_LOGO_PATH}" fill="url(#solanaLogoGrad)"/>
        </g>`
      : `<g transform="translate(20 ${FOOTER_Y + 7}) scale(0.126)">
          <rect width="111" height="111" rx="20" fill="#0052FF"/>
          <path d="M55.5 24C38.103 24 24 38.103 24 55.5S38.103 87 55.5 87c15.977 0 29.2-11.714 31.145-27.158H63.931v9.272h-8.43V55.5h31.644C87.145 38.714 72.977 24 55.5 24z" fill="white"/>
        </g>`
    }

    <!-- Footer: TX HASH -->
    <text x="49" y="${FOOTER_Y + 11}"
      font-family="monospace" font-size="6" fill="#999"
      letter-spacing="1">TX HASH</text>
    <text x="49" y="${FOOTER_Y + 20}"
      font-family="monospace" font-size="6.5" fill="#555"
      letter-spacing="0.5">${uid}</text>

    <!-- Footer: ISSUE DATE -->
    <text x="190" y="${FOOTER_Y + 11}"
      font-family="monospace" font-size="6" fill="#999"
      letter-spacing="1">ISSUE DATE</text>
    <text x="190" y="${FOOTER_Y + 20}"
      font-family="monospace" font-size="7" fill="#555"
      letter-spacing="0.5">${dateStr}</text>

    <!-- Footer: seal mark -->
    <image href="${MARK_BLACK}" x="${W - SLEEVE_PAD - 33}" y="${FOOTER_Y + 3}"
      width="22" height="22" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>

    <!-- Top sleeve opening edge -->
    <rect x="${SLEEVE_PAD - 1}" y="${SLEEVE_PAD - 1}"
      width="${INNER_W + 2}" height="2"
      fill="#ffffff" opacity="0.06"/>

    <!-- Outer border -->
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