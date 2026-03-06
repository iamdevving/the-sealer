// src/app/api/mirror/card/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'edge';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const LOGO_B64 = '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';

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
const BORDER_W      = 1;
const PAD           = 8;
const NAME_BAR_H    = 30;
const FOOTER_H      = 26;
const INNER_W       = W - PAD * 2;
const MIN_RATIO     = 9 / 16;
const MAX_RATIO     = 16 / 9;
const DEFAULT_RATIO = 63 / 88;

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

  // Dev preview param — allows testing broken state without real transfer
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

  const IMG_Y = PAD;

  const chainLabel    = originalChain === 'ethereum' ? 'ETH' : originalChain.toUpperCase();
  const contractShort = truncateAddr(originalContract);

  const SOLANA_LOGO_PATH = `M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0067 100.84 67.3436C100.99 67.6806 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 34.3032C83.4444 33.9248 83.0058 33.6231 82.5185 33.4169C82.0312 33.2108 81.5055 33.1045 80.9743 33.1048H1.93563C1.55849 33.1048 1.18957 33.2121 0.874202 33.4136C0.558829 33.6151 0.31074 33.9019 0.160416 34.2388C0.0100923 34.5758 -0.0359181 34.9482 0.0280382 35.3103C0.0919944 35.6723 0.263131 36.0083 0.520422 36.277L17.2061 53.6968C17.5676 54.0742 18.0047 54.3752 18.4904 54.5814C18.9762 54.7875 19.5002 54.8944 20.0301 54.8952H99.0644C99.4415 54.8952 99.8104 54.7879 100.126 54.5864C100.441 54.3849 100.689 54.0981 100.84 53.7612C100.99 53.4242 101.036 53.0518 100.972 52.6897C100.908 52.3277 100.737 51.9917 100.48 51.723L83.8068 34.3032ZM1.93563 21.7905H80.9743C81.5055 21.7907 82.0312 21.6845 82.5185 21.4783C83.0058 21.2721 83.4444 20.9704 83.8068 20.592L100.48 3.17219C100.737 2.90357 100.908 2.56758 100.972 2.2055C101.036 1.84342 100.99 1.47103 100.84 1.13408C100.689 0.79713 100.441 0.510296 100.126 0.308823C99.8104 0.107349 99.4415 1.24074e-05 99.0644 0L20.0301 0C19.5002 0.000878397 18.9762 0.107699 18.4904 0.313848C18.0047 0.519998 17.5676 0.821087 17.2061 1.19848L0.524723 18.6183C0.267681 18.8866 0.0966198 19.2223 0.0325185 19.5839C-0.0315829 19.9456 0.0140624 20.3177 0.163856 20.6545C0.31365 20.9913 0.561081 21.2781 0.875804 21.4799C1.19053 21.6817 1.55886 21.7896 1.93563 21.7905Z`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Glass background gradient -->
    <linearGradient id="glassBg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%"   stop-color="#f0f4ff" stop-opacity="0.92"/>
      <stop offset="50%"  stop-color="#e8eeff" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#dde4f8" stop-opacity="0.94"/>
    </linearGradient>
    <!-- Frosted edge highlight -->
    <linearGradient id="glassEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="40%"  stop-color="#ffffff" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>
    <!-- Subtle inner sheen -->
    <linearGradient id="sheen" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- Footer glass -->
    <linearGradient id="footerGlass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>
    <!-- Vignette -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%"   stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,20,0.25)"/>
    </radialGradient>
    <!-- Invalidated overlay -->
    <linearGradient id="invalidGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#0a0a14" stop-opacity="0.97"/>
      <stop offset="100%" stop-color="#050508" stop-opacity="0.99"/>
    </linearGradient>
    <!-- Clip paths -->
    <clipPath id="imgClip">
      <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"/>
    </clipPath>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}" rx="16"/>
    </clipPath>
    <!-- Noise texture filter for frosted glass -->
    <filter id="frost" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4"
        stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
      <feBlend in="SourceGraphic" in2="grey" mode="soft-light" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>
    <!-- Mirror reflection sweep — diagonal light -->
    <linearGradient id="mirrorSweep" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="35%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="48%"  stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="52%"  stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="65%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- Glass stripe 1: dominant bright band top-left diagonal, cuts off sharply -->
    <linearGradient id="glassStripe1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="18%"  stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="32%"  stop-color="#ffffff" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- Glass stripe 2: razor-thin bright highlight line crossing diagonally -->
    <linearGradient id="glassStripe2" x1="0" y1="0.1" x2="0.9" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="36%"  stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="39%"  stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="45%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- Glass stripe 3: inner shadow bottom-right edge -->
    <linearGradient id="glassStripe3" x1="1" y1="1" x2="0.6" y2="0.6">
      <stop offset="0%"   stop-color="#1a1a3a" stop-opacity="0.22"/>
      <stop offset="30%"  stop-color="#1a1a3a" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#1a1a3a" stop-opacity="0"/>
    </linearGradient>
    <!-- Solana gradient -->
    <linearGradient id="solanaGrad" x1="8.52558" y1="90.0973" x2="88.9933" y2="-3.01622" gradientUnits="userSpaceOnUse">
      <stop offset="0.08" stop-color="#9945FF"/>
      <stop offset="0.5"  stop-color="#5497D5"/>
      <stop offset="0.97" stop-color="#19FB9B"/>
    </linearGradient>
  </defs>

  <g clip-path="url(#cardClip)">

    <!-- ── Card base: frosted glass ── -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="url(#glassBg)"/>
    <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="url(#frost)" opacity="0.4"/>
    <rect x="0" y="0" width="${W}" height="${H / 2}" rx="16" fill="url(#sheen)" opacity="0.6"/>

    ${invalidated ? `
    <!-- ── INVALIDATED STATE — cracked mirror ── -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"
      fill="rgba(8,8,18,0.92)"/>
    <!-- Crack lines radiating from center -->
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
    <!-- Secondary crack branches -->
    <g stroke="rgba(255,255,255,0.09)" stroke-width="0.5" fill="none">
      <line x1="${PAD + 20}" y1="${IMG_Y + 10}" x2="${PAD + 5}" y2="${IMG_Y + 35}"/>
      <line x1="${W - PAD - 15}" y1="${IMG_Y + 8}" x2="${W - PAD - 5}" y2="${IMG_Y + 40}"/>
      <line x1="${W/2 - 40}" y1="${IMG_Y + INNER_H}" x2="${PAD + 30}" y2="${IMG_Y + INNER_H - 30}"/>
    </g>
    <!-- Center impact point glow -->
    <circle cx="${W/2}" cy="${IMG_Y + INNER_H/2}" r="3"
      fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>
    <circle cx="${W/2}" cy="${IMG_Y + INNER_H/2}" r="8"
      fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <!-- Void text -->
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 - 22}"
      font-family="monospace" font-size="7" fill="rgba(255,255,255,0.22)"
      text-anchor="middle" letter-spacing="4">MIRROR VOID</text>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 + 32}"
      font-family="monospace" font-size="5.5" fill="rgba(255,255,255,0.12)"
      text-anchor="middle" letter-spacing="1.5">original nft transferred</text>
    <!-- Update button -->
    <rect x="${W/2 - 35}" y="${IMG_Y + INNER_H/2 + 40}" width="70" height="14" rx="3"
      fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 + 50}"
      font-family="monospace" font-size="5.5" fill="rgba(255,255,255,0.28)"
      text-anchor="middle" letter-spacing="1.5">UPDATE MIRROR →</text>
    ` : imgData ? `
    <!-- ── NFT image ── -->
    <image href="${imgData}"
      x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid meet"/>
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#vignette)" clip-path="url(#imgClip)"/>
    ` : `
    <!-- ── No image placeholder ── -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"
      fill="rgba(255,255,255,0.18)"/>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 - 6}"
      font-family="monospace" font-size="8" fill="rgba(100,120,180,0.4)"
      text-anchor="middle" letter-spacing="3">NO IMAGE</text>
    <text x="${W/2}" y="${IMG_Y + INNER_H/2 + 10}"
      font-family="monospace" font-size="6.5" fill="rgba(100,120,180,0.25)"
      text-anchor="middle">?imageUrl=https://...</text>
    `}

    <!-- ── Glass stripes over image (multi-stripe mirror effect) ── -->
    <!-- Stripe 1: wide soft diagonal from top-left -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#glassStripe1)" clip-path="url(#imgClip)" opacity="0.9"/>
    <!-- Stripe 2: razor bright highlight line -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#glassStripe2)" clip-path="url(#imgClip)" opacity="0.35"/>
    <!-- Stripe 3: bottom-right inner shadow -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}"
      fill="url(#glassStripe3)" clip-path="url(#imgClip)" opacity="1"/>

    <!-- ── Crisp single-pixel glass border around image ── -->
    <rect x="${PAD}" y="${IMG_Y}" width="${INNER_W}" height="${INNER_H}" rx="6"
      fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1"/>
    <!-- Inner shadow line bottom+right only via subtle dark inset -->
    <rect x="${PAD + 1}" y="${IMG_Y + 1}" width="${INNER_W - 2}" height="${INNER_H - 2}" rx="5"
      fill="none" stroke="rgba(20,20,60,0.12)" stroke-width="1"/>

    <!-- ── MIRROR watermark top-right ── -->
    <text x="${W - PAD - 8}" y="${IMG_Y + 13}"
      font-family="monospace" font-size="6" fill="rgba(255,255,255,0.35)"
      text-anchor="end" letter-spacing="2">MIRROR</text>

    <!-- ── Name bar ── -->
    <rect x="${PAD}" y="${NAME_Y}" width="${INNER_W}" height="${NAME_BAR_H}"
      fill="rgba(255,255,255,0.22)"/>
    <rect x="${PAD}" y="${NAME_Y}" width="${INNER_W}" height="0.5"
      fill="rgba(255,255,255,0.5)"/>
    <text x="${PAD + 12}" y="${NAME_Y + 20}"
      font-family="monospace" font-size="11" font-weight="700"
      fill="rgba(20,40,100,0.9)" letter-spacing="0.2">${nftName}</text>

    <!-- ── Footer ── -->
    <rect x="${PAD}" y="${FOOTER_Y}" width="${INNER_W}" height="${FOOTER_H}"
      fill="rgba(255,255,255,0.1)"/>
    <rect x="${PAD}" y="${FOOTER_Y}" width="${INNER_W}" height="0.5"
      fill="rgba(255,255,255,0.2)"/>

    <!-- Footer: chain logo left — vertically centered -->
    ${chain === 'Solana'
      ? `<g transform="translate(${PAD + 8} ${FOOTER_Y + 14}) scale(0.114)">
          <path d="${SOLANA_LOGO_PATH}" fill="url(#solanaGrad)" opacity="0.5"/>
        </g>`
      : `<g transform="translate(${PAD + 8} ${FOOTER_Y + 8}) scale(0.114)" opacity="0.45">
          <rect width="111" height="111" rx="20" fill="#0052FF"/>
          <path d="M55.5 24C38.103 24 24 38.103 24 55.5S38.103 87 55.5 87c15.977 0 29.2-11.714 31.145-27.158H63.931v9.272h-8.43V55.5h31.644C87.145 38.714 72.977 24 55.5 24z" fill="white"/>
        </g>`
    }

    <!-- Footer: tx hash — left, next to chain logo -->
    <text x="${PAD + 22}" y="${FOOTER_Y + 17}"
      font-family="monospace" font-size="5.5" fill="rgba(40,60,120,0.4)" letter-spacing="0.5">TX  ${uid}</text>

    <!-- Footer: date — right, with gap before logo -->
    <text x="${W - PAD - 26}" y="${FOOTER_Y + 17}"
      font-family="monospace" font-size="5.5" fill="rgba(40,60,120,0.38)"
      text-anchor="end" letter-spacing="0.3">${chainLabel} · ${dateStr}</text>

    <!-- Footer: seal logo — right, vertically centered, slight inset -->
    <g transform="translate(${W - PAD - 14} ${FOOTER_Y + 15})">
      <image href="data:image/png;base64,${LOGO_B64}"
        x="-7" y="-7" width="14" height="14"
        preserveAspectRatio="xMidYMid meet" opacity="0.75"/>
    </g>

    <!-- ── Outer card border — thin, crisp, defined ── -->
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