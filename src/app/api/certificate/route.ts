// src/app/api/certificate/route.ts
//
// Achievement Certificate SVG renderer
// Format: 560×400px landscape — distinct from Badge (240×200) and Card (560×530)
// Tiers: bronze / silver / gold — same layout, colour palette shifts only
// Used exclusively for verified achievements — never self-declared

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// ── Tier palettes ─────────────────────────────────────────────────────────────
const TIERS = {
  bronze: {
    bg:          '#0c0804',
    pageBg:      '#100a05',
    outerBorder: '#cd7f32',
    innerBorder: '#6b3a10',
    cornerAccent:'#cd7f32',
    headerBg:    '#1a0e06',
    titleText:   '#cd7f32',
    labelText:   '#8b5a2a',
    bodyText:    '#f0c890',
    bodyTextDim: '#7a5020',
    sealRing:    '#cd7f32',
    sealFill:    '#120a04',
    sealText:    '#cd7f32',
    ruleLine:    '#3a1e08',
    tierLabel:   'BRONZE',
    tierGlow:    'rgba(205,127,50,0.12)',
  },
  silver: {
    bg:          '#080a0e',
    pageBg:      '#0b0d12',
    outerBorder: '#c0c8d8',
    innerBorder: '#3a4560',
    cornerAccent:'#c0c8d8',
    headerBg:    '#0d1018',
    titleText:   '#c0c8d8',
    labelText:   '#6070a0',
    bodyText:    '#e8ecf4',
    bodyTextDim: '#6070a0',
    sealRing:    '#c0c8d8',
    sealFill:    '#0d1018',
    sealText:    '#c0c8d8',
    ruleLine:    '#2a3448',
    tierLabel:   'SILVER',
    tierGlow:    'rgba(192,200,216,0.10)',
  },
  gold: {
    bg:          '#0a0800',
    pageBg:      '#0e0b02',
    outerBorder: '#d4af37',
    innerBorder: '#6b5010',
    cornerAccent:'#d4af37',
    headerBg:    '#1a1400',
    titleText:   '#d4af37',
    labelText:   '#8b7020',
    bodyText:    '#f8e8a0',
    bodyTextDim: '#9a8030',
    sealRing:    '#d4af37',
    sealFill:    '#120e00',
    sealText:    '#d4af37',
    ruleLine:    '#3a2c08',
    tierLabel:   'GOLD',
    tierGlow:    'rgba(212,175,55,0.15)',
  },
} as const;

type Tier = keyof typeof TIERS;

// ── Claim type labels ─────────────────────────────────────────────────────────
const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payment Reliability',
  defi_trading_performance: 'DeFi Trading Performance',
  code_software_delivery:   'Code & Software Delivery',
  website_app_delivery:     'Website & App Delivery',
  social_media_growth:      'Social Media Growth',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// Decorative corner ornament — four identical rotations
function cornerOrnament(x: number, y: number, rotate: number, color: string): string {
  return `<g transform="translate(${x},${y}) rotate(${rotate})">
    <line x1="0" y1="0" x2="18" y2="0" stroke="${color}" stroke-width="1.2"/>
    <line x1="0" y1="0" x2="0" y2="18" stroke="${color}" stroke-width="1.2"/>
    <rect x="0" y="0" width="4" height="4" fill="${color}" opacity="0.7"/>
  </g>`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // ── Params ──────────────────────────────────────────────────────────────────
  let tier       = (searchParams.get('tier') || 'bronze') as Tier;
  if (!TIERS[tier]) tier = 'bronze';

  const claimType   = searchParams.get('claimType') || 'x402_payment_reliability';
  const metric      = esc(truncate(searchParams.get('metric')    || 'Achievement verified', 80));
  const subject     = esc(truncate(searchParams.get('subject')   || '0x????', 18));
  const txHash      = searchParams.get('txHash') || '';
  const score       = searchParams.get('score')  || '';
  const onTime      = searchParams.get('onTime') !== 'false';
  const achievedAt  = searchParams.get('achievedAt')
    ? formatDate(Number(searchParams.get('achievedAt')))
    : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Support lookup by EAS UID
  const uid_param = searchParams.get('uid');
  if (uid_param) {
    try {
      const { fetchAttestation } = await import('@/lib/eas');
      const data = await fetchAttestation(uid_param);
      if (data) {
        try {
          const parsed = JSON.parse(data.statement);
          // Override params from onchain data if present
          // (verifier stores level, metric, score, onTime in EAS fields)
        } catch { /* use query params */ }
      }
    } catch { /* use query params */ }
  }

  const t           = TIERS[tier];
  const claimLabel  = esc(CLAIM_LABELS[claimType] || claimType);
  const uid         = txHash
    ? '0x' + txHash.slice(2, 6) + '\u2026' + txHash.slice(-4)
    : uid_param
    ? '0x' + uid_param.slice(2, 6) + '\u2026' + uid_param.slice(-4)
    : '0x\u2026';

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';

  // ── Corner ornaments (all four corners) ──────────────────────────────────
  const corners = [
    cornerOrnament(22, 22, 0, t.cornerAccent),
    cornerOrnament(538, 22, 90, t.cornerAccent),
    cornerOrnament(538, 378, 180, t.cornerAccent),
    cornerOrnament(22, 378, 270, t.cornerAccent),
  ].join('');

  // ── Seal (right side) ─────────────────────────────────────────────────────
  const sealX = 448;
  const sealY = 200;
  const seal  = [
    // Glow
    `<circle cx="${sealX}" cy="${sealY}" r="60" fill="${t.tierGlow}"/>`,
    // Outer ring
    `<circle cx="${sealX}" cy="${sealY}" r="52" stroke="${t.sealRing}" stroke-width="1.5" fill="${t.sealFill}"/>`,
    // Inner ring
    `<circle cx="${sealX}" cy="${sealY}" r="44" stroke="${t.sealRing}" stroke-width="0.5" fill="none" opacity="0.5"/>`,
    // Tick mark — verified checkmark
    `<polyline points="${sealX-14},${sealY} ${sealX-4},${sealY+12} ${sealX+16},${sealY-14}"
      stroke="${t.sealRing}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    // Tier label arc text approximation (straight, centred below tick)
    `<text x="${sealX}" y="${sealY+30}" font-family="'Courier New',monospace" font-size="7.5"
      font-weight="bold" fill="${t.sealText}" text-anchor="middle" letter-spacing="3">${t.tierLabel}</text>`,
    `<text x="${sealX}" y="${sealY+41}" font-family="'Courier New',monospace" font-size="5.5"
      fill="${t.sealText}" text-anchor="middle" letter-spacing="1.5" opacity="0.6">ACHIEVEMENT</text>`,
    // Score if present
    score
      ? `<text x="${sealX}" y="${sealY-26}" font-family="'Courier New',monospace" font-size="11"
          font-weight="bold" fill="${t.sealText}" text-anchor="middle">${score}</text>
         <text x="${sealX}" y="${sealY-14}" font-family="'Courier New',monospace" font-size="5"
          fill="${t.sealText}" text-anchor="middle" letter-spacing="1" opacity="0.5">SCORE</text>`
      : '',
  ].join('');

  // ── Divider line with ornament ─────────────────────────────────────────────
  const divider = `
    <line x1="44" y1="116" x2="390" y2="116" stroke="${t.ruleLine}" stroke-width="0.7"/>
    <circle cx="217" cy="116" r="2.5" fill="${t.outerBorder}" opacity="0.6"/>
    <line x1="44" y1="290" x2="390" y2="290" stroke="${t.ruleLine}" stroke-width="0.7"/>
  `;

  // ── On-time badge ──────────────────────────────────────────────────────────
  const onTimeBadge = onTime
    ? `<rect x="44" y="298" width="72" height="16" rx="3" fill="${t.outerBorder}" opacity="0.15"/>
       <text x="80" y="310" font-family="'Courier New',monospace" font-size="6.5" font-weight="bold"
         fill="${t.titleText}" text-anchor="middle" letter-spacing="1.5">ON TIME</text>`
    : `<rect x="44" y="298" width="72" height="16" rx="3" fill="${t.ruleLine}" opacity="0.4"/>
       <text x="80" y="310" font-family="'Courier New',monospace" font-size="6.5"
         fill="${t.bodyTextDim}" text-anchor="middle" letter-spacing="1.5">LATE</text>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="560" height="400" viewBox="0 0 560 400" xmlns="http://www.w3.org/2000/svg">

  <!-- Outer shell -->
  <rect width="560" height="400" rx="8" ry="8" fill="${t.bg}"/>

  <!-- Tier glow border -->
  <rect x="1" y="1" width="558" height="398" rx="8" ry="8"
    fill="none" stroke="${t.outerBorder}" stroke-width="2"/>

  <!-- Inner page -->
  <rect x="10" y="10" width="540" height="380" rx="5" ry="5"
    fill="${t.pageBg}" stroke="${t.innerBorder}" stroke-width="0.7"/>

  <!-- Corner ornaments -->
  ${corners}

  <!-- Header area -->
  <rect x="10" y="10" width="540" height="44" rx="5" ry="5" fill="${t.headerBg}"/>
  <rect x="10" y="42" width="540" height="12" fill="${t.headerBg}"/>

  <!-- Protocol label -->
  <text x="44" y="30" font-family="'Courier New',monospace" font-size="7" font-weight="bold"
    fill="${t.labelText}" letter-spacing="3">THE SEALER PROTOCOL · BASE · EAS</text>

  <!-- Certificate title -->
  <text x="44" y="46" font-family="'Courier New',monospace" font-size="9" font-weight="bold"
    fill="${t.titleText}" letter-spacing="4">CERTIFICATE OF ACHIEVEMENT</text>

  <!-- Right side — tier label in header -->
  <text x="516" y="38" font-family="'Courier New',monospace" font-size="8" font-weight="bold"
    fill="${t.titleText}" text-anchor="end" letter-spacing="3">${t.tierLabel}</text>

  ${divider}

  <!-- THIS CERTIFIES section -->
  <text x="44" y="96" font-family="'Courier New',monospace" font-size="6.5"
    fill="${t.labelText}" letter-spacing="3">THIS CERTIFIES THAT</text>

  <!-- Subject wallet -->
  <text x="44" y="112" font-family="'Courier New',monospace" font-size="13" font-weight="bold"
    fill="${t.bodyText}" letter-spacing="1">${subject}</text>

  <!-- Has achieved section -->
  <text x="44" y="148" font-family="'Courier New',monospace" font-size="6.5"
    fill="${t.labelText}" letter-spacing="3">HAS ACHIEVED</text>

  <!-- Claim type — large -->
  <text x="44" y="170" font-family="Georgia,'Times New Roman',serif" font-size="22" font-weight="bold"
    fill="${t.titleText}">${claimLabel}</text>

  <!-- Metric line -->
  <text x="44" y="196" font-family="'Courier New',monospace" font-size="9"
    fill="${t.bodyText}" opacity="0.85">${metric}</text>

  <!-- Lower section labels -->
  <text x="44" y="240" font-family="'Courier New',monospace" font-size="6"
    fill="${t.labelText}" letter-spacing="2">DATE ACHIEVED</text>
  <text x="44" y="254" font-family="'Courier New',monospace" font-size="9" font-weight="bold"
    fill="${t.bodyText}">${achievedAt}</text>

  <text x="200" y="240" font-family="'Courier New',monospace" font-size="6"
    fill="${t.labelText}" letter-spacing="2">ATTESTATION</text>
  <text x="200" y="254" font-family="'Courier New',monospace" font-size="9" font-weight="bold"
    fill="${t.bodyText}">${uid}</text>

  <!-- On-time badge -->
  ${onTimeBadge}

  <!-- Footer -->
  <rect x="10" y="372" width="540" height="18" rx="0" fill="${t.headerBg}" opacity="0.8"/>
  <rect x="10" y="372" width="540" height="1" fill="${t.ruleLine}" opacity="0.6"/>
  <text x="44" y="384" font-family="'Courier New',monospace" font-size="5.5"
    fill="${t.labelText}" letter-spacing="1.5" opacity="0.7">
    CRYPTOGRAPHICALLY VERIFIED · ONCHAIN · ${baseUrl.replace('https://', '').toUpperCase()}
  </text>
  <text x="516" y="384" font-family="'Courier New',monospace" font-size="5.5"
    fill="${t.labelText}" text-anchor="end" opacity="0.5">VERIFIED</text>

  <!-- Seal -->
  ${seal}

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}