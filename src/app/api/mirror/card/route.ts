// src/app/api/mirror/card/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { MARK_BLACK } from '@/lib/assets';

export const runtime = 'nodejs';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function truncateHash(h: string) {
  return h ? '0x' + h.slice(2, 6) + '...' + h.slice(-4) : '0x????...????';
}
function truncateAddr(a: string) {
  return a ? a.slice(0, 6) + '...' + a.slice(-4) : '';
}

const W             = 315;
const PAD           = 8;
const NAME_BAR_H    = 30;
const FOOTER_H      = 26;
const INNER_W       = W - PAD * 2;
const MIN_RATIO     = 9 / 16;
const MAX_RATIO     = 16 / 9;
const DEFAULT_RATIO = 63 / 88;

const SOLANA_LOGO_PATH = `M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0067 100.84 67.3436C100.99 67.6806 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 34.3032C83.4444 33.9248 83.0058 33.6231 82.5185 33.4169C82.0312 33.2108 81.5055 33.1045 80.9743 33.1048H1.93563C1.55849 33.1048 1.18957 33.2121 0.874202 33.4136C0.558829 33.6151 0.31074 33.9019 0.160416 34.2388C0.0100923 34.5758 -0.0359181 34.9482 0.0280382 35.3103C0.0919944 35.6723 0.263131 36.0083 0.520422 36.277L17.2061 53.6968C17.5676 54.0742 18.0047 54.3752 18.4904 54.5814C18.9762 54.7875 19.5002 54.8944 20.0301 54.8952H99.0644C99.4415 54.8952 99.8104 54.7879 100.126 54.5864C100.441 54.3849 100.689 54.0981 100.84 53.7612C100.99 53.4242 101.036 53.0518 100.972 52.6897C100.908 52.3277 100.737 51.9917 100.48 51.723L83.8068 34.3032ZM1.93563 21.7905H80.9743C81.5055 21.7907 82.0312 21.6845 82.5185 21.4783C83.0058 21.2721 83.4444 20.9704 83.8068 20.592L100.48 3.17219C100.737 2.90357 100.908 2.56758 100.972 2.2055C101.036 1.84342 100.99 1.47103 100.84 1.13408C100.689 0.79713 100.441 0.510296 100.126 0.308823C99.8104 0.107349 99.4415 1.24074e-05 99.0644 0L20.0301 0C19.5002 0.000878397 18.9762 0.107699 18.4904 0.313848C18.0047 0.519998 17.5676 0.821087 17.2061 1.19848L0.524723 18.6183C0.267681 18.8866 0.0966198 19.2223 0.0325185 19.5839C-0.0315829 19.9456 0.0140624 20.3177 0.163856 20.6545C0.31365 20.9913 0.561081 21.2781 0.875804 21.4799C1.19053 21.6817 1.55886 21.7896 1.93563 21.7905Z`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const imageUrl         = searchParams.get('imageUrl') || '';
  const txHash           = searchParams.get('txHash') || '';
  const chain            = esc(searchParams.get('chain') || 'Base');
  const originalChain    = esc(searchParams.get('originalChain') || 'ethereum');
  const originalContract = searchParams.get('originalContract') || '';
  const originalTokenId  = searchParams.get('originalTokenId') || '';
  const nftName          = esc(searchParams.get('nftName') || `#${originalTokenId}`);
  const mirrorTokenId    = searchParams.get('mirrorTokenId') || '';
  const dateStr          = esc(formatDate(new Date()));
  const uid              = truncateHash(txHash);

  // Check invalidation state from Redis
  let invalidated = false;

  if (searchParams.get('forceInvalidated') === 'true') {
    invalidated = true;
  } else if (mirrorTokenId) {
    try {
      const dataRaw = await redis.get<string>(`mirror:data:${mirrorTokenId}`);
      if (dataRaw) {
        const data = typeof dataRaw === 'string' ? JSON.parse(dataRaw) : dataRaw;
        invalidated = !!data.invalidated;
      }
    } catch {}
  }
  if (searchParams.get('invalidated') === 'true') invalidated = true;

  const paramW = parseInt(searchParams.get('imgW') || '0');
  const paramH = parseInt(searchParams.get('imgH') || '0');

  let imgData  = '';
  let imgMime  = 'image/png';
  let imgRatio = DEFAULT_RATIO;

  if (imageUrl && !invalidated) {
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

  const INNER_H   = Math.round(INNER_W / imgRatio);
  const NAME_Y    = PAD + INNER_H;
  const FOOTER_Y  = NAME_Y + NAME_BAR_H;
  const H         = FOOTER_Y + FOOTER_H + 6;
  const IMG_Y     = PAD;

  const chainLabel    = originalChain === 'ethereum' ? 'ETH' : originalChain.toUpperCase();
  const contractShort = truncateAddr(originalContract);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="glassBg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%"   stop-color="#f0f4ff" stop-opacity="0.92"/>
      <stop offset="50%"  stop-color="#e8eeff" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#dde4f8" stop-opacity="0.94"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%"   stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,20,0.25)"/>
    </radialGradient>
    <clipPath id="imgClip">
      <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"/>
    </clipPath>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}" rx="16"/>
    </clipPath>
    <filter id="frost" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4"
        stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
      <feBlend in="SourceGraphic" in2="grey" mode="soft-light" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>
    <linearGradient id="glassStripe1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="18%"  stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="32%"  stop-color="#ffffff" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="glassStripe2" x1="0" y1="0.1" x2="0.9" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="36%"  stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="39%"  stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="45%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="glassStripe3" x1="1" y1="1" x2="0.6" y2="0.6">
      <stop offset="0%"   stop-color="#1a1a3a" stop-opacity="0.22"/>
      <stop offset="30%"  stop-color="#1a1a3a" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#1a1a3a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="solanaGrad" x1="8.52558" y1="90.0973" x2="88.9933" y2="-3.01622" gradientUnits="userSpaceOnUse">
      <stop offset="0.08" stop-color="#9945FF"/>
      <stop offset="0.5"  stop-color="#5497D5"/>
      <stop offset="0.97" stop-color="#19FB9B"/>
    </linearGradient>
  </defs>

  <g clip-path="url(#cardClip)">

    <!-- Card base: frosted glass -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="url(#glassBg)"/>
    <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="url(#frost)" opacity="0.4"/>
    <rect x="0" y="0" width="${W}" height="${H / 2}" rx="16" fill="url(#sheen)" opacity="0.6"/>

    ${invalidated ? `
    <!-- INVALIDATED STATE — cracked mirror -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"
      fill="rgba(8,8,18,0.92)"/>
    <g stroke="rgba(255,255,255,0.18)" stroke-width="0.75" fill="none">
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${PAD + 20}" y2="${IMG_Y + 10}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${W - PAD - 15}" y2="${IMG_Y + 8}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${PAD + 8}" y2="${IMG_Y + INNER_H - 20}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${W - PAD - 10}" y2="${IMG_Y + INNER_H - 15}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${W/2 - 40}" y2="${IMG_Y + INNER_H}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${W/2 + 50}" y2="${IMG_Y + INNER_H}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${PAD}" y2="${IMG_Y + INNER_H/2 + 20}"/>
      <line x1="${W/2}" y1="${IMG_Y + INNER_H/2}" x2="${W - PAD}" y2="${IMG_Y + INNER_H/2 - 30}"/>
    </g>
    <g stroke="rgba(255,255,255,0.09)" stroke-width="0.5" fill="none">
      <line x1="${PAD + 20}" y1="${IMG_Y + 10}" x2="${PAD + 5}" y2="${IMG_Y + 35}"/>
      <line x1="${W - PAD - 15}" y1="${IMG_Y + 8}" x2="${W - PAD - 5}" y2="${IMG_Y + 40}"/>
      <line x1="${W/2 - 40}" y1="${IMG_Y + INNER_H}" x2="${PAD + 30}" y2="${IMG_Y + INNER_H - 30}"/>
    </g>
    <circle cx="${W/2}" cy="${IMG_Y + INNER_H/2}" r="3"
      fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>
    <circle cx="${W/2}" cy="${IMG_Y + INNER_H/2}" r="8"
      fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 - 22}"
      font-family="monospace" font-size="7" fill="rgba(255,255,255,0.22)"
      text-anchor="middle" letter-spacing="4">MIRROR VOID</text>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 + 32}"
      font-family="monospace" font-size="5.5" fill="rgba(255,255,255,0.12)"
      text-anchor="middle" letter-spacing="1.5">original nft transferred</text>
    <rect x="${W/2 - 35}" y="${IMG_Y + INNER_H/2 + 40}" width="70" height="14" rx="3"
      fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 + 50}"
      font-family="monospace" font-size="5.5" fill="rgba(255,255,255,0.28)"
      text-anchor="middle" letter-spacing="1.5">FIX MIRROR →</text>
    ` : imgData ? `
    <!-- NFT image -->
    <image href="${imgData}"
      x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid meet"/>
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#vignette)" clip-path="url(#imgClip)"/>
    ` : `
    <!-- No image placeholder -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"
      fill="rgba(255,255,255,0.18)"/>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 - 6}"
      font-family="monospace" font-size="8" fill="rgba(100,120,180,0.4)"
      text-anchor="middle" letter-spacing="3">NO IMAGE</text>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 + 10}"
      font-family="monospace" font-size="6.5" fill="rgba(100,120,180,0.25)"
      text-anchor="middle">?imageUrl=https://...</text>
    `}

    <!-- Glass stripes over image -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#glassStripe1)" clip-path="url(#imgClip)" opacity="0.9"/>
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#glassStripe2)" clip-path="url(#imgClip)" opacity="0.35"/>
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#glassStripe3)" clip-path="url(#imgClip)" opacity="1"/>

    <!-- Glass border around image -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"
      fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1"/>
    <rect x="${PAD + 1}" y="${IMG_Y + 1}" width="${INNER_W - 2}" height="${INNER_H - 2}" rx="5"
      fill="none" stroke="rgba(20,20,60,0.12)" stroke-width="1"/>

    <!-- MIRROR watermark top-right -->
    <text x="${W - PAD - 8}" y="${IMG_Y + 13}"
      font-family="monospace" font-size="6" fill="rgba(255,255,255,0.35)"
      text-anchor="end" letter-spacing="2">MIRROR</text>

    <!-- Name bar -->
    <rect x="${PAD}" y="${NAME_Y}" width="${INNER_W}" height="${NAME_BAR_H}"
      fill="rgba(255,255,255,0.22)"/>
    <rect x="${PAD}" y="${NAME_Y}" width="${INNER_W}" height="0.5"
      fill="rgba(255,255,255,0.5)"/>
    <text x="${PAD + 12}" y="${NAME_Y + 20}"
      font-family="monospace" font-size="11" font-weight="700"
      fill="rgba(20,40,100,0.9)" letter-spacing="0.2">${nftName}</text>

    <!-- Footer -->
    <rect x="${PAD}" y="${FOOTER_Y}" width="${INNER_W}" height="${FOOTER_H}"
      fill="rgba(255,255,255,0.1)"/>
    <rect x="${PAD}" y="${FOOTER_Y}" width="${INNER_W}" height="0.5"
      fill="rgba(255,255,255,0.2)"/>

    <!-- Footer: chain logo -->
    ${chain === 'Solana'
      ? `<g transform="translate(${PAD + 8} ${FOOTER_Y + 14}) scale(0.114)">
          <path d="${SOLANA_LOGO_PATH}" fill="url(#solanaGrad)" opacity="0.5"/>
        </g>`
      : `<g transform="translate(${PAD + 8} ${FOOTER_Y + 8}) scale(0.114)" opacity="0.45">
          <rect width="111" height="111" rx="20" fill="#0052FF"/>
          <path d="M55.5 24C38.103 24 24 38.103 24 55.5S38.103 87 55.5 87c15.977 0 29.2-11.714 31.145-27.158H63.931v9.272h-8.43V55.5h31.644C87.145 38.714 72.977 24 55.5 24z" fill="white"/>
        </g>`
    }

    <!-- Footer: tx hash -->
    <text x="${PAD + 22}" y="${FOOTER_Y + 17}"
      font-family="monospace" font-size="5.5" fill="rgba(40,60,120,0.4)" letter-spacing="0.5">TX  ${uid}</text>

    <!-- Footer: date -->
    <text x="${W - PAD - 26}" y="${FOOTER_Y + 17}"
      font-family="monospace" font-size="5.5" fill="rgba(40,60,120,0.38)"
      text-anchor="end" letter-spacing="0.3">${chainLabel} · ${dateStr}</text>

    <!-- Footer: seal mark -->
    <image href="${MARK_BLACK}" x="${W - PAD - 21}" y="${FOOTER_Y + 8}"
      width="14" height="14" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>

    <!-- Outer card border -->
    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="15.5"
      fill="none" stroke="rgba(180,195,230,0.7)" stroke-width="1"/>
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="14.5"
      fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>

  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type':  'image/svg+xml',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
    },
  });
}