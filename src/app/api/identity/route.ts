// src/app/api/identity/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const LOGO_B64 = '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';

const W = 428;
const H = 600;

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function truncateAddr(addr: string) {
  if (!addr || addr === '????') return '????…????';
  return addr.slice(0, 6) + '···' + addr.slice(-4);
}

function padMRZ(s: string, len: number) {
  return s.replace(/[^A-Z0-9]/g, '<').toUpperCase().padEnd(len, '<').slice(0, len);
}

function serialNumber(agentId: string, year: string): string {
  const fragment = agentId && agentId.startsWith('0x')
    ? agentId.slice(2, 6).toUpperCase()
    : '????';
  return `ID-${year}-${fragment}`;
}

function buildStamp(serial: string): string {
  const r = 44;
  return `
    <circle cx="0" cy="0" r="${r}" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="0" cy="0" r="${r - 5}" fill="none" stroke="currentColor" stroke-width="0.4" opacity="0.4"/>
    <defs>
      <path id="rimArc" d="M ${-r+4},0 a ${r-4},${r-4} 0 1,1 ${(r-4)*2},0"/>
    </defs>
    <text font-family="monospace" font-size="6.5" letter-spacing="2.2" fill="currentColor">
      <textPath href="#rimArc" startOffset="8%">THESEALER.XYZ</textPath>
    </text>
    <text x="${-r + 8}" y="4" font-family="monospace" font-size="11" fill="currentColor" text-anchor="middle">{</text>
    <text x="${r - 8}" y="4" font-family="monospace" font-size="11" fill="currentColor" text-anchor="middle">}</text>
    <text x="${-r + 14}" y="${r - 10}" font-family="monospace" font-size="9" fill="currentColor" text-anchor="middle">&lt;</text>
    <text x="${r - 14}" y="${r - 10}" font-family="monospace" font-size="9" fill="currentColor" text-anchor="middle">&gt;</text>
    <text x="0" y="${r - 7}" font-family="monospace" font-size="7" fill="currentColor" text-anchor="middle" letter-spacing="2">SEAL ID</text>
    <image href="data:image/png;base64,${LOGO_B64}"
      x="-20" y="-26" width="40" height="40"
      preserveAspectRatio="xMidYMid meet" opacity="0.7"
      filter="url(#inkify)"/>
    <text x="0" y="${r + 13}" font-family="monospace" font-size="6.5" fill="currentColor" text-anchor="middle" letter-spacing="1.5">${serial}</text>
  `;
}
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;

  const agentId        = esc(p.get('agentId')        || '????');
  const name           = esc(p.get('name')            || 'UNNAMED AGENT');
  const owner          = esc(p.get('owner')           || '');
  const chain          = esc(p.get('chain')           || 'Base');
  const entityType     = esc(p.get('entityType')      || 'UNKNOWN');
  const firstSeen      = esc(p.get('firstSeen')       || '—');
  const statementCount = esc(p.get('statementCount')  || '0');
  const social         = esc(p.get('social')          || '');
  const theme          = p.get('theme') === 'light' ? 'light' : 'dark';
  const imageUrl       = p.get('imageUrl') || '';
  const year           = new Date().getFullYear().toString();
  const issueDate      = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const serial         = serialNumber(agentId, year);

  // Theme colours
  const isDark    = theme === 'dark';
  const BG        = isDark ? '#0d1117' : '#f5f0e8';
  const HEADER_BG = isDark ? '#0a0f1e' : '#1a1f3a';
  const INK       = isDark ? '#c8d8f0' : '#1a1f3a';
  const INK_DIM   = isDark ? '#5a7090' : '#6b7280';
  const INK_FAINT = isDark ? '#1e2d4a' : '#d4c9a8';
  const STAMP_COL = isDark ? '#2a4a8a' : '#1a2a6a';
  const MRZ_BG    = isDark ? '#070c14' : '#e8e0cc';
  const ACCENT    = entityType === 'AI_AGENT' ? '#3b82f6'
                  : entityType === 'HUMAN'    ? '#9ca3af'
                  : '#f59e0b';
  const ENTITY_LABEL = entityType === 'AI_AGENT' ? 'AI AGENT'
                     : entityType === 'HUMAN'    ? 'HUMAN'
                     : 'UNKNOWN';

  // Chain logo
  const chainLogo = chain === 'Solana'
    ? `<g transform="scale(0.18) translate(-50 -44)">
        <path d="M100.48 69.38L83.81 86.8c-.36.38-.8.68-1.29.89-.49.21-1.01.31-1.54.31H1.94c-.38 0-.75-.11-1.06-.31-.32-.2-.56-.49-.71-.83-.15-.34-.18-.71-.11-1.07.06-.36.23-.7.48-.97L17.21 67.41c.36-.38.8-.68 1.29-.89.49-.21 1.01-.31 1.54-.31h79.03c.38 0 .75.11 1.06.31.32.2.56.49.71.83.15.34.18.71.11 1.07-.06.36-.23.7-.48.97zM83.81 34.3c-.36-.38-.8-.68-1.29-.89-.49-.21-1.01-.31-1.54-.31H1.94c-.38 0-.75.11-1.06.31-.32.2-.56.49-.71.83-.15.34-.18.71-.11 1.07.06.36.23.7.48.97l16.69 17.42c.36.38.8.68 1.29.89.49.21 1.01.31 1.54.31h79.03c.38 0 .75-.11 1.06-.31.32-.2.56-.49.71-.83.15-.34.18-.71.11-1.07-.06-.36-.23-.7-.48-.97L83.81 34.3zM1.94 21.79h79.03c.53 0 1.05-.11 1.54-.31.49-.21.93-.51 1.29-.89L100.48 3.17c.26-.27.43-.61.49-.97.06-.36.02-.73-.11-1.07-.15-.34-.39-.62-.71-.83C99.82.11 99.44 0 99.06 0H20.03c-.53 0-1.05.11-1.54.31-.49.21-.93.51-1.29.89L.52 18.62c-.26.27-.43.61-.49.97-.06.36-.02.73.11 1.07.15.34.39.62.71.83.32.2.69.31 1.09.31z" fill="url(#solGradID)"/>
        <defs><linearGradient id="solGradID" x1="8.5" y1="90" x2="89" y2="-3" gradientUnits="userSpaceOnUse"><stop offset="0.08" stop-color="#9945FF"/><stop offset="0.5" stop-color="#5497D5"/><stop offset="0.97" stop-color="#19FB9B"/></linearGradient></defs>
      </g>`
    : `<g transform="scale(0.18) translate(-50 -44)">
        <rect width="111" height="111" rx="20" fill="#0052FF"/>
        <path d="M55.5 24C38.1 24 24 38.1 24 55.5S38.1 87 55.5 87c16 0 29.2-11.7 31.1-27.2H64v9.3h-8.4V55.5h31.6C87.1 38.7 73 24 55.5 24z" fill="white"/>
      </g>`;

  // Fetch profile image
  let photoData = '';
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const b64img = Buffer.from(buf).toString('base64');
        const mime = res.headers.get('content-type') || 'image/png';
        photoData = `data:${mime};base64,${b64img}`;
      }
    } catch {}
  }

  // Stamp
  const stamp = buildStamp(serial);

  // MRZ
  const mrzLine1 = `AGENT<${padMRZ(name.replace(/ /g,'<'), 20)}<<<<<<<<<<<<<<<<<<`.slice(0,44);
  const mrzLine2 = `${padMRZ(agentId.replace('0x',''), 20)}<<${padMRZ(chain, 6)}<${padMRZ(entityType.replace('_',''), 8)}<<${year}<<`.slice(0,44);

  // Layout
  const PAD     = 20;
  const HDR_H   = 80;
  const PHOTO_W = 110;
  const PHOTO_H = 132;
  const PHOTO_X = PAD;
  const PHOTO_Y = HDR_H + PAD;
  const FX      = PHOTO_X + PHOTO_W + 16;
  const FW      = W - FX - PAD;
  const SEC_Y   = PHOTO_Y + PHOTO_H + 14;
  const MRZ_Y   = H - 72;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Ink filter for stamp seal face -->
    <filter id="inkify" color-interpolation-filters="sRGB">
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="0" intercept="0"/>
        <feFuncG type="linear" slope="0" intercept="0"/>
        <feFuncB type="linear" slope="0" intercept="0"/>
      </feComponentTransfer>
    </filter>
    <pattern id="guil" x="0" y="0" width="40" height="20" patternUnits="userSpaceOnUse">
      <path d="M0 10 Q10 0 20 10 Q30 20 40 10" fill="none" stroke="${INK_FAINT}" stroke-width="0.5"/>
      <path d="M0 16 Q10 6 20 16 Q30 26 40 16" fill="none" stroke="${INK_FAINT}" stroke-width="0.25" opacity="0.5"/>
    </pattern>
    <clipPath id="photoClip">
      <rect x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" rx="4"/>
    </clipPath>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}" rx="12"/>
    </clipPath>
  </defs>

  <g clip-path="url(#cardClip)">

    <!-- Body -->
    <rect x="0" y="0" width="${W}" height="${H}" fill="${BG}"/>
    <rect x="0" y="${HDR_H}" width="${W}" height="${H - HDR_H}" fill="url(#guil)" opacity="0.5"/>

    <!-- Header -->
    <rect x="0" y="0" width="${W}" height="${HDR_H}" fill="${HEADER_BG}"/>
    <rect x="0" y="0" width="${W}" height="${HDR_H}" fill="url(#guil)" opacity="0.12"/>

    <!-- Line 1: logo + protocol name + registry | issued date right -->
    <image href="data:image/png;base64,${LOGO_B64}"
      x="${PAD}" y="8" width="16" height="16"
      preserveAspectRatio="xMidYMid meet" opacity="0.9"/>
    <text x="${PAD + 20}" y="21" font-family="monospace" font-size="7.5" fill="#fff" opacity="0.7" letter-spacing="1.5">THE SEALER PROTOCOL · ONCHAIN IDENTITY REGISTRY</text>
    <text x="${W - PAD}" y="21" font-family="monospace" font-size="6" fill="#fff" opacity="0.4" text-anchor="end" letter-spacing="1">ISSUED ${issueDate}</text>

    <!-- Line 2: SEAL ID large | chain logo right -->
    <text x="${PAD}" y="52" font-family="Georgia, 'Times New Roman', serif" font-size="24" fill="#fff" letter-spacing="3">SEAL ID</text>
    <g transform="translate(${W - PAD - 10}, 42)">${chainLogo}</g>

    <!-- Line 3: document type -->
    <text x="${PAD}" y="68" font-family="monospace" font-size="6.5" fill="#fff" opacity="0.35" letter-spacing="2">AGENT IDENTITY DOCUMENT · ERC-8004</text>

    <!-- Accent line -->
    <rect x="0" y="${HDR_H}" width="${W}" height="2" fill="${ACCENT}" opacity="0.9"/>

    <!-- Photo -->
    ${photoData
      ? `<image href="${photoData}" x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" rx="4" fill="${isDark ? '#1a2540' : '#ddd8cc'}"/>
         <image href="data:image/png;base64,${LOGO_B64}" x="${PHOTO_X + 25}" y="${PHOTO_Y + 28}" width="60" height="60" opacity="0.15" preserveAspectRatio="xMidYMid meet"/>`
    }
    <rect x="${PHOTO_X}" y="${PHOTO_Y}" width="${PHOTO_W}" height="${PHOTO_H}" rx="4" fill="none" stroke="${INK_FAINT}" stroke-width="0.8"/>

    <!-- Entity badge below photo -->
    <rect x="${PHOTO_X}" y="${PHOTO_Y + PHOTO_H + 6}" width="${PHOTO_W}" height="18" rx="3" fill="${ACCENT}" opacity="0.12"/>
    <rect x="${PHOTO_X}" y="${PHOTO_Y + PHOTO_H + 6}" width="${PHOTO_W}" height="18" rx="3" fill="none" stroke="${ACCENT}" stroke-width="0.8" opacity="0.5"/>
    <text x="${PHOTO_X + PHOTO_W / 2}" y="${PHOTO_Y + PHOTO_H + 19}" font-family="monospace" font-size="7.5" fill="${ACCENT}" text-anchor="middle" letter-spacing="2">${ENTITY_LABEL}</text>

    <!-- Fields right of photo -->
    <text x="${FX}" y="${PHOTO_Y + 14}" font-family="monospace" font-size="6" fill="${INK_DIM}" letter-spacing="1.5">NAME</text>
    <text x="${FX}" y="${PHOTO_Y + 28}" font-family="Georgia, serif" font-size="13" fill="${INK}">${truncate(name, 20)}</text>

    <text x="${FX}" y="${PHOTO_Y + 50}" font-family="monospace" font-size="6" fill="${INK_DIM}" letter-spacing="1.5">AGENT ID</text>
    <text x="${FX}" y="${PHOTO_Y + 63}" font-family="monospace" font-size="9" fill="${INK}" letter-spacing="0.5">${truncateAddr(agentId)}</text>

    <text x="${FX}" y="${PHOTO_Y + 112}" font-family="monospace" font-size="6" fill="${INK_DIM}" letter-spacing="1.5">OWNER</text>
    <text x="${FX}" y="${PHOTO_Y + 125}" font-family="monospace" font-size="9" fill="${INK}" letter-spacing="0.5">${owner ? truncateAddr(owner) : '—'}</text>

    <text x="${FX}" y="${PHOTO_Y + 80}" font-family="monospace" font-size="6" fill="${INK_DIM}" letter-spacing="1.5">CHAIN</text>
    <text x="${FX}" y="${PHOTO_Y + 93}" font-family="monospace" font-size="10" fill="${INK}" letter-spacing="1">${chain.toUpperCase()}</text>

    <!-- Divider — below entity badge -->
    <line x1="${PAD}" y1="${SEC_Y + 4}" x2="${W - PAD}" y2="${SEC_Y + 4}" stroke="${INK_FAINT}" stroke-width="0.8"/>

    <!-- Secondary fields -->
    <text x="${PAD}" y="${SEC_Y + 16}" font-family="monospace" font-size="6" fill="${INK_DIM}" letter-spacing="1.5">FIRST SEEN</text>
    <text x="${PAD}" y="${SEC_Y + 29}" font-family="monospace" font-size="9" fill="${INK}">${firstSeen}</text>

    <text x="${PAD + 130}" y="${SEC_Y + 16}" font-family="monospace" font-size="6" fill="${INK_DIM}" letter-spacing="1.5">STATEMENTS</text>
    <text x="${PAD + 130}" y="${SEC_Y + 29}" font-family="monospace" font-size="9" fill="${INK}">${statementCount}</text>

    ${social ? `
    <rect x="${PAD + 250}" y="${SEC_Y + 6}" width="80" height="16" rx="8"
      fill="${ACCENT}" opacity="0.15"/>
    <rect x="${PAD + 250}" y="${SEC_Y + 6}" width="80" height="16" rx="8"
      fill="none" stroke="${ACCENT}" stroke-width="0.8" opacity="0.5"/>
    <text x="${PAD + 290}" y="${SEC_Y + 18}" font-family="monospace" font-size="7.5" fill="${ACCENT}"
      text-anchor="middle" letter-spacing="0.5">${truncate(social, 10)}</text>
    ` : ''}

    <!-- Serial -->
    <text x="${W - PAD}" y="${SEC_Y + 29}" font-family="monospace" font-size="8" fill="${ACCENT}" text-anchor="end" letter-spacing="1.5">${serial}</text>

    <!-- Stamp — rotated, semi-transparent, bottom-right of photo -->
    <g transform="translate(${PHOTO_X + PHOTO_W + 10}, ${SEC_Y - 20}) rotate(-15)" color="${STAMP_COL}" opacity="0.55">
      ${stamp}
    </g>

    <!-- MRZ zone -->
    <rect x="0" y="${MRZ_Y}" width="${W}" height="72" fill="${MRZ_BG}"/>
    <line x1="0" y1="${MRZ_Y}" x2="${W}" y2="${MRZ_Y}" stroke="${INK_FAINT}" stroke-width="0.8"/>
    <text x="${PAD}" y="${MRZ_Y + 13}" font-family="monospace" font-size="5.5" fill="${INK_DIM}" letter-spacing="1">MACHINE READABLE ZONE</text>
    <text x="${PAD}" y="${MRZ_Y + 34}" font-family="'Courier New', monospace" font-size="9.5" fill="${INK}" letter-spacing="1.8">${mrzLine1}</text>
    <text x="${PAD}" y="${MRZ_Y + 52}" font-family="'Courier New', monospace" font-size="9.5" fill="${INK}" letter-spacing="1.8">${mrzLine2}</text>

    <!-- Card border -->
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="none" stroke="${INK_FAINT}" stroke-width="1"/>

  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
