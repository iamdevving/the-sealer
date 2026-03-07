// src/app/api/commitment/route.ts
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';

// Reuse the mark assets from badge/card — same brand identity
const MARK_WHITE_PARTS: string[] = [
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAdtklEQVR42u18eZQV5Zn389Z2t77dfW/TNHsLsjZNoAERdARCiMaMK8iokYwKCi7f8ZsxGsckSubEISZxTk4cBaMmZkzirjF4/AiLYrtEQY0igsrSqA0N3X33rZZ3eb4/qereurdvE2EA8Qx1Tp3by616q371vM/ze37P8xYgIoGT28ntf/tGAEBydtnZ3d8JALAVK1ZIJ+qFf1lgEQBAAOBf8DjZc4xwPv9XASg7n2WAEUJg6NChUV3XGzVNCwFAkDEDEOU8olloaKiJf/JJV4IQIvo535cK5lEF0A1IhBCssLYiaMOGDQvkcrnpjLHZjNE2SmkL52IAIN",
];
const MARK_WHITE = `data:image/png;base64,${MARK_WHITE_PARTS.join("")}`;

const THEMES: Record<string, {
  bg: string;
  pageBg: string;
  border: string;
  accent: string;
  accentDim: string;
  headerBg: string;
  headerText: string;
  bodyText: string;
  bodyTextDim: string;
  ruleLine: string;
  stampColor: string;
  stampBg: string;
  dark: boolean;
}> = {
  'circuit-anim': {
    bg: '#04090f',
    pageBg: '#06111e',
    border: '#0d3040',
    accent: '#00e5ff',
    accentDim: '#1a5060',
    headerBg: '#04090f',
    headerText: '#00e5ff',
    bodyText: '#d0eef5',
    bodyTextDim: '#5a9aaa',
    ruleLine: '#0d3545',
    stampColor: '#00e5ff',
    stampBg: '#051018',
    dark: true,
  },
  'circuit': {
    bg: '#030a12',
    pageBg: '#05101c',
    border: '#0d3040',
    accent: '#00bcd4',
    accentDim: '#0d3a42',
    headerBg: '#030a12',
    headerText: '#00bcd4',
    bodyText: '#cce8ee',
    bodyTextDim: '#4a8a98',
    ruleLine: '#0d3040',
    stampColor: '#00bcd4',
    stampBg: '#040d18',
    dark: true,
  },
  'parchment': {
    bg: '#d4c5a0',
    pageBg: '#f5f0e8',
    border: '#c9b882',
    accent: '#8b1a1a',
    accentDim: '#6b3a1a',
    headerBg: '#8b1a1a',
    headerText: '#ffffff',
    bodyText: '#0d0a07',
    bodyTextDim: '#3a2a20',
    ruleLine: '#c9b882',
    stampColor: '#8b1a1a',
    stampBg: '#ede6d4',
    dark: false,
  },
  'aurora': {
    bg: '#04030e',
    pageBg: '#080c1a',
    border: '#201840',
    accent: '#a78bfa',
    accentDim: '#3a2a70',
    headerBg: '#04030e',
    headerText: '#a78bfa',
    bodyText: '#ddd6fe',
    bodyTextDim: '#6050a0',
    ruleLine: '#201840',
    stampColor: '#a78bfa',
    stampBg: '#05040f',
    dark: true,
  },
  'base': {
    bg: '#0042cc',
    pageBg: '#eef2ff',
    border: '#b0c8ff',
    accent: '#0052ff',
    accentDim: '#4d88ff',
    headerBg: '#0052ff',
    headerText: '#ffffff',
    bodyText: '#0a1a3a',
    bodyTextDim: '#2a4a8a',
    ruleLine: '#b0c8ff',
    stampColor: '#0052ff',
    stampBg: '#dde6ff',
    dark: false,
  },
  'gold': {
    bg: '#0a0800',
    pageBg: '#0d0a04',
    border: '#3a2a08',
    accent: '#d4af37',
    accentDim: '#8b6914',
    headerBg: '#1a1200',
    headerText: '#d4af37',
    bodyText: '#f0e0a0',
    bodyTextDim: '#8a7020',
    ruleLine: '#3a2a08',
    stampColor: '#d4af37',
    stampBg: '#100c02',
    dark: true,
  },
  'silver': {
    bg: '#080a0e',
    pageBg: '#0a0c10',
    border: '#2a3448',
    accent: '#c0c8d8',
    accentDim: '#4a5a80',
    headerBg: '#0d1018',
    headerText: '#c0c8d8',
    bodyText: '#e8ecf4',
    bodyTextDim: '#6070a0',
    ruleLine: '#2a3448',
    stampColor: '#c0c8d8',
    stampBg: '#0d1018',
    dark: true,
  },
  'bronze': {
    bg: '#080502',
    pageBg: '#0c0804',
    border: '#3a1e08',
    accent: '#cd7f32',
    accentDim: '#8b4513',
    headerBg: '#120a02',
    headerText: '#cd7f32',
    bodyText: '#f0c890',
    bodyTextDim: '#7a5020',
    ruleLine: '#3a1e08',
    stampColor: '#cd7f32',
    stampBg: '#100a03',
    dark: true,
  },
  'bitcoin': {
    bg: '#b85800',
    pageBg: '#f7931a',
    border: '#c46000',
    accent: '#ffffff',
    accentDim: '#ffe8c0',
    headerBg: '#d4720a',
    headerText: '#ffffff',
    bodyText: '#1a0a00',
    bodyTextDim: '#5a3000',
    ruleLine: '#c46000',
    stampColor: '#ffffff',
    stampBg: '#e8820a',
    dark: true,
  },
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

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (test.length > maxChars && cur) {
      lines.push(cur);
      if (lines.length >= maxLines) break;
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur && lines.length < maxLines) lines.push(truncate(cur, maxChars));
  return lines;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Support permanent link via EAS UID
  const uid_param = searchParams.get('uid');
  let commitment: string;
  let themeKey: string;
  let agentId: string;
  let txHash: string;
  let deadline: string;
  let metric: string;

  if (uid_param) {
    const { fetchAttestation, fetchAttestationByTx } = await import('@/lib/eas');
    const data = await fetchAttestation(uid_param) || await fetchAttestationByTx(uid_param);
    if (!data) {
      return new NextResponse('Attestation not found', { status: 404 });
    }
    // Parse structured JSON from statement field
    let parsed: Record<string, string> = {};
    try { parsed = JSON.parse(data.statement); } catch { parsed = { commitment: data.statement }; }
    commitment = truncate(parsed.commitment || parsed.statement || 'No commitment text', 200);
    themeKey   = searchParams.get('theme') || 'circuit-anim';
    agentId    = esc(data.recipient.slice(0, 8));
    txHash     = data.txHash;
    deadline   = parsed.deadline || '';
    metric     = parsed.metric || '';
  } else {
    commitment = truncate(searchParams.get('commitment') || searchParams.get('statement') || 'I commit to achieving this goal', 200);
    themeKey   = searchParams.get('theme') || 'circuit-anim';
    const rawId = searchParams.get('agentId') || '????';
    agentId    = esc(rawId.startsWith('0x') ? rawId.slice(0, 8) : rawId);
    txHash     = searchParams.get('txHash') || '';
    deadline   = esc(searchParams.get('deadline') || '');
    metric     = esc(searchParams.get('metric') || '');
  }

  const t       = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const uid     = txHash
    ? '0x' + txHash.slice(2, 6) + '\u2026' + txHash.slice(-4)
    : '0x\u2026pending';
  const dateStr = formatDate(new Date());

  // Text wrapping for commitment — narrower column, serif
  const charCount = commitment.length;
  const fontSize  = charCount <= 80  ? 13.5
                  : charCount <= 140 ? 12
                  : 10.5;
  const lineH     = fontSize + 9;
  const maxChars  = charCount <= 80  ? 44 : charCount <= 140 ? 50 : 56;
  const lines     = wrapText(esc(commitment), maxChars, 6);

  const totalTextH   = lines.length * lineH;
  // Commitment text block sits in the middle of the page area (y 95–280)
  const textStartY   = Math.round(95 + (185 - totalTextH) / 2);

  // Ruled lines behind text — document feel
  const ruleLines = Array.from({ length: 8 }, (_, i) =>
    `<line x1="28" y1="${88 + i * 26}" x2="332" y2="${88 + i * 26}" stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.5"/>`
  ).join('');

  // Minimalist stamp ring on the right side
  const stampX = 300;
  const stampY = 168;
  const stamp = [
    `<circle cx="${stampX}" cy="${stampY}" r="44" stroke="${t.stampColor}" stroke-width="1.2" fill="${t.stampBg}" opacity="0.85"/>`,
    `<circle cx="${stampX}" cy="${stampY}" r="38" stroke="${t.stampColor}" stroke-width="0.5" fill="none" opacity="0.4"/>`,
    `<text x="${stampX}" y="${stampY - 14}" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.stampColor}" text-anchor="middle" letter-spacing="2">PENDING</text>`,
    `<text x="${stampX}" y="${stampY}" font-family="monospace" font-size="6" fill="${t.stampColor}" text-anchor="middle" letter-spacing="1" opacity="0.7">VERIFICATION</text>`,
    `<text x="${stampX}" y="${stampY + 12}" font-family="monospace" font-size="5.5" fill="${t.stampColor}" text-anchor="middle" opacity="0.55">THESEALER.XYZ</text>`,
    `<text x="${stampX}" y="${stampY + 24}" font-family="monospace" font-size="5" fill="${t.stampColor}" text-anchor="middle" opacity="0.4">EAS · BASE</text>`,
  ].join('');

  // Signature line
  const sigLine = [
    `<line x1="28" y1="292" x2="180" y2="292" stroke="${t.ruleLine}" stroke-width="0.8" opacity="0.7"/>`,
    `<text x="28" y="304" font-family="monospace" font-size="6.5" fill="${t.accentDim}" letter-spacing="1">AGENT SIGNATURE</text>`,
    `<text x="28" y="316" font-family="monospace" font-size="6" fill="${t.accentDim}" opacity="0.6">#${agentId}</text>`,
  ].join('');

  // Deadline + metric row (bottom of page, if present)
  const metaRow = (deadline || metric) ? [
    deadline ? `<text x="28" y="334" font-family="monospace" font-size="6.5" fill="${t.accentDim}">DEADLINE: <tspan fill="${t.accent}" font-weight="bold">${deadline}</tspan></text>` : '',
    metric   ? `<text x="28" y="346" font-family="monospace" font-size="6.5" fill="${t.accentDim}">METRIC: <tspan fill="${t.accent}" font-weight="bold">${metric}</tspan></text>` : '',
  ].join('') : '';

  // Commitment text lines
  const commitmentLines = lines.map((line, i) =>
    `<text x="28" y="${textStartY + i * lineH}" font-family="Georgia,serif" font-size="${fontSize}" fill="${t.bodyText}">${line}</text>`
  ).join('');

  // Corner notch decoration — top right, document feel
  const cornerNotch = [
    `<polyline points="360,18 360,36 342,36" stroke="${t.accentDim}" stroke-width="0.8" fill="none" opacity="0.4"/>`,
  ].join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="380" height="420" viewBox="0 0 380 420" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="outer"><rect width="380" height="420" rx="10" ry="10"/></clipPath>
  </defs>

  <!-- Outer shell -->
  <rect width="380" height="420" rx="10" ry="10" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>

  <!-- Page area (inset document) -->
  <rect x="14" y="14" width="352" height="392" rx="6" ry="6"
    fill="${t.pageBg}" stroke="${t.border}" stroke-width="0.8"/>

  <!-- Corner fold effect -->
  ${cornerNotch}

  <!-- Header strip -->
  <rect x="14" y="14" width="352" height="30" rx="6" ry="6" fill="${t.headerBg}"/>
  <rect x="14" y="32" width="352" height="12" fill="${t.headerBg}"/>
  <text x="28" y="33" font-family="monospace" font-size="8" font-weight="bold"
    fill="${t.headerText}" letter-spacing="2">COMMITMENT DOCUMENT · THE SEALER</text>

  <!-- Document type label -->
  <text x="28" y="68" font-family="monospace" font-size="7" font-weight="bold"
    fill="${t.accent}" letter-spacing="3" opacity="0.7">STATEMENT OF INTENT</text>
  <line x1="28" y1="73" x2="352" y2="73" stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.4"/>

  <!-- Ruled lines -->
  ${ruleLines}

  <!-- Commitment text -->
  ${commitmentLines}

  <!-- Stamp -->
  ${stamp}

  <!-- Divider before signature -->
  <line x1="14" y1="282" x2="366" y2="282" stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.3"/>

  <!-- Signature + meta -->
  ${sigLine}
  ${metaRow}

  <!-- Footer bar -->
  <rect x="14" y="390" width="352" height="16" rx="0" ry="0" fill="${t.headerBg}" opacity="0.6"/>
  <rect x="14" y="390" width="352" height="1" fill="${t.ruleLine}" opacity="0.5"/>
  <text x="28" y="401" font-family="monospace" font-size="5.5" fill="${t.accentDim}" letter-spacing="1.5" opacity="0.7">
    ISSUED ${dateStr.toUpperCase()} · TX ${uid}
  </text>
  <text x="352" y="401" font-family="monospace" font-size="5.5"
    fill="${t.accentDim}" text-anchor="end" opacity="0.5">UNVERIFIED</text>

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
    },
  });
}
