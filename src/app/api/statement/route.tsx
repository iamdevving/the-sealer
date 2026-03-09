// src/app/api/statement/route.tsx
// Statement Card — no image/attachment required.
// Top area: large centred ONCHAIN STATEMENT stamp + theme deco.
import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE, MARK_BLACK, STAMP_STATEMENT_WHITE, STAMP_STATEMENT_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const THEMES: Record<string, {
  bg: string; headerBg: string; headerText: string;
  accent: string; accentDim: string; accentMid: string;
  bodyText: string; bodyTextDim: string;
  statBg: string; statBorder: string;
  bandBg: string; bandText: string;
  border: string; dark: boolean;
}> = {
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', accentMid:'#3ab8cc', bodyText:'#d0eef5', bodyTextDim:'#7ab8cc', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', bandText:'#00e5ff', border:'#0d3040', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', accentMid:'#2a8a9a', bodyText:'#cce8ee', bodyTextDim:'#5a9aa8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', bandText:'#00bcd4', border:'#0d3040', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', accentMid:'#8b6040', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#f2ead8', bandText:'#8b1a1a', border:'#c9b882', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', accentMid:'#7060b0', bodyText:'#ddd6fe', bodyTextDim:'#7060a0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', bandText:'#a78bfa', border:'#201840', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#4d88ff', accentMid:'#2a60cc', bodyText:'#0a1a3a', bodyTextDim:'#2a4a8a', statBg:'#dde6ff', statBorder:'#b0c8ff', bandBg:'#0042cc', bandText:'#ffffff', border:'#b0c8ff', dark:false },
  'gold':         { bg:'#0d0a04', headerBg:'#1a1200', headerText:'#d4af37', accent:'#d4af37', accentDim:'#8b6914', accentMid:'#b08a20', bodyText:'#f0e0a0', bodyTextDim:'#a08020', statBg:'#140f03', statBorder:'#3a2a08', bandBg:'#0a0800', bandText:'#d4af37', border:'#3a2a08', dark:true },
  'silver':       { bg:'#0a0c10', headerBg:'#0d1018', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#4a5a80', accentMid:'#8090b0', bodyText:'#e8ecf4', bodyTextDim:'#7080a0', statBg:'#0d1018', statBorder:'#2a3448', bandBg:'#080a0e', bandText:'#c0c8d8', border:'#2a3448', dark:true },
  'bronze':       { bg:'#0c0804', headerBg:'#120a02', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#8b4513', accentMid:'#a05820', bodyText:'#f0c890', bodyTextDim:'#8b5a20', statBg:'#100a03', statBorder:'#3a1e08', bandBg:'#080502', bandText:'#cd7f32', border:'#3a1e08', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#d4720a', headerText:'#ffffff', accent:'#ffffff', accentDim:'#ffe8c0', accentMid:'#fff0d0', bodyText:'#1a0a00', bodyTextDim:'#5a3000', statBg:'#e8820a', statBorder:'#c46000', bandBg:'#b85800', bandText:'#ffffff', border:'#c46000', dark:true },
};

function truncate(s: string, n: number) { return s.length > n ? s.slice(0,n-1)+'…' : s; }
function formatDate(d: Date) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
    } else { cur = test; }
  }
  if (cur && lines.length < maxLines) lines.push(truncate(cur, maxChars));
  return lines;
}

function topDeco(themeKey: string, accent: string, accentDim: string): string {
  switch (themeKey) {
    case 'circuit-anim':
    case 'circuit': {
      const c = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
      return [
        `<g stroke="${c}" stroke-width="0.7" fill="none" opacity="0.35">`,
        `<polyline points="22,72 80,72 94,86"/>`,
        `<polyline points="22,97 65,97 79,111"/>`,
        `<polyline points="22,122 55,122"/>`,
        `<polyline points="518,72 460,72 446,86"/>`,
        `<polyline points="518,97 475,97 461,111"/>`,
        `<polyline points="518,122 485,122"/>`,
        `</g>`,
        `<g fill="${c}" opacity="0.6">`,
        `<circle cx="94" cy="86" r="2.5"/><circle cx="79" cy="111" r="2"/>`,
        `<circle cx="446" cy="86" r="2.5"/><circle cx="461" cy="111" r="2"/>`,
        `</g>`,
        `<g stroke="${c}" stroke-width="1" fill="none" opacity="0.4">`,
        `<polyline points="22,50 22,63 35,63"/>`,
        `<polyline points="518,50 518,63 505,63"/>`,
        `</g>`,
      ].join('');
    }
    case 'parchment':
      return [
        `<g stroke="#c9b882" stroke-width="0.7" fill="none" opacity="0.3">`,
        `<path d="M 22,53 Q 22,70 35,73 Q 48,76 52,92"/>`,
        `<path d="M 518,53 Q 518,70 505,73 Q 492,76 488,92"/>`,
        `<path d="M 22,197 Q 22,180 35,177 Q 48,174 52,158"/>`,
        `<path d="M 518,197 Q 518,180 505,177 Q 492,174 488,158"/>`,
        `</g>`,
        `<line x1="22" y1="53" x2="518" y2="53" stroke="#c9b882" stroke-width="0.4" opacity="0.2"/>`,
        `<line x1="22" y1="197" x2="518" y2="197" stroke="#c9b882" stroke-width="0.4" opacity="0.2"/>`,
      ].join('');
    case 'aurora':
      return [
        `<g opacity="0.08">`,
        `<ellipse cx="90" cy="125" rx="110" ry="80" fill="#7c3aed"/>`,
        `<ellipse cx="450" cy="125" rx="110" ry="80" fill="${accent}"/>`,
        `</g>`,
        `<g fill="none" opacity="0.12">`,
        `<path d="M 0,85 Q 130,55 270,85 Q 410,115 540,85" stroke="${accent}" stroke-width="1"/>`,
        `<path d="M 0,110 Q 130,80 270,110 Q 410,140 540,110" stroke="#c4b5fd" stroke-width="0.7"/>`,
        `</g>`,
      ].join('');
    case 'base':
      return [
        `<g stroke="${accent}" stroke-width="0.25" opacity="0.12">`,
        ...[40,80,120,160,200,240,280,320,360,400,440,480,520].map(x => `<line x1="${x}" y1="50" x2="${x}" y2="200"/>`),
        ...[70,90,110,130,150,170,190].map(y => `<line x1="22" y1="${y}" x2="518" y2="${y}"/>`),
        `</g>`,
        `<rect x="0" y="50" width="3" height="150" fill="${accent}" opacity="0.4"/>`,
      ].join('');
    case 'gold':
      return [
        `<polygon points="270,58 420,185 270,200 120,185" stroke="${accent}" stroke-width="0.7" fill="none" opacity="0.08"/>`,
        `<g stroke="${accent}" stroke-width="0.8" fill="none" opacity="0.2">`,
        `<path d="M 22,53 L 42,53 L 42,73"/><path d="M 518,53 L 498,53 L 498,73"/>`,
        `<path d="M 22,197 L 42,197 L 42,177"/><path d="M 518,197 L 498,197 L 498,177"/>`,
        `</g>`,
      ].join('');
    case 'silver': {
      const hex = (cx: number, cy: number, r: number) => {
        const pts = Array.from({length:6},(_,i) => {
          const a = Math.PI/180*(60*i-30);
          return `${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;
        }).join(' ');
        return `<polygon points="${pts}" stroke="${accent}" stroke-width="0.5" fill="none" opacity="0.1"/>`;
      };
      return hex(38,85,26)+hex(76,85,26)+hex(57,107,26)+hex(462,85,26)+hex(500,85,26)+hex(481,107,26);
    }
    case 'bronze':
      return [
        `<g stroke="${accent}" stroke-width="0.5" opacity="0.12">`,
        `<line x1="22" y1="58" x2="518" y2="58"/><line x1="22" y1="62" x2="518" y2="62"/>`,
        `<line x1="22" y1="192" x2="518" y2="192"/><line x1="22" y1="196" x2="518" y2="196"/>`,
        `</g>`,
      ].join('');
    case 'bitcoin':
      return [
        `<g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.08">`,
        `<text x="22"  y="120" font-size="55" transform="rotate(-15,22,120)">₿</text>`,
        `<text x="420" y="100" font-size="60" transform="rotate(-15,420,100)">₿</text>`,
        `</g>`,
      ].join('');
    default: return '';
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  let statement: string;
  let themeKey: string;
  let agentId: string;
  let txHash: string;
  let chain: string;

  const uid_param = searchParams.get('uid');
  if (uid_param) {
    const { fetchAttestation, fetchAttestationByTx } = await import('@/lib/eas');
    const data = await fetchAttestation(uid_param) || await fetchAttestationByTx(uid_param);
    if (!data) return new NextResponse('Attestation not found', { status: 404 });
    statement = truncate(data.statement, 300);
    themeKey  = searchParams.get('theme') || 'circuit-anim';
    agentId   = esc(data.recipient.slice(0,8));
    txHash    = data.txHash;
    chain     = searchParams.get('chain') || 'Base';
  } else {
    statement = truncate(searchParams.get('statement') || 'Verified Onchain Statement', 300);
    themeKey  = searchParams.get('theme') || 'circuit-anim';
    const rawId = searchParams.get('agentId') || '????';
    agentId   = esc(rawId.startsWith('0x') ? rawId.slice(0, 8) : rawId);
    txHash    = searchParams.get('txHash') || '';
    chain     = esc(searchParams.get('chain') || 'Base');
  }

  const t       = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const uid     = txHash ? '0x' + txHash.slice(2,6) + '…' + txHash.slice(-4) : '0x????…????';
  const dateStr = formatDate(new Date());

  const stamp = t.dark ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  const mark  = t.dark ? MARK_WHITE : MARK_BLACK;

  // Text sizing
  const charCount = statement.length;
  const fontSize  = charCount <= 80  ? 17
                  : charCount <= 140 ? 15
                  : charCount <= 200 ? 13.5
                  : 12;
  const lineH     = fontSize + 12;
  const maxChars  = charCount <= 80  ? 44
                  : charCount <= 140 ? 50
                  : charCount <= 200 ? 56
                  : 60;
  const lines = wrapText(esc(statement), maxChars, 6);
  const totalTextH = lines.length * lineH;

  // Card height: tighter — 460 instead of 530
  const H = 460;
  // Top stamp area: y42–192 (150px), body: 192–370, stats: 370–430, footer: 430–460
  const textStartY = Math.round(210 + (148 - totalTextH) / 2);

  const dashes = Array.from({length:44},(_,i) =>
    `<rect x="${i*12+1}" y="40" width="7" height="1.5" fill="${t.accent}" opacity="0.55"/>`
  ).join('');

  const textLines = lines.map((line,i) =>
    `<text x="270" y="${textStartY + i*lineH}" font-family="Georgia,serif" font-size="${fontSize}" fill="${t.bodyTextDim}" font-style="italic" text-anchor="middle">${line}</text>`
  ).join('');

  // Use accentMid for UID and bottom links on dark themes — brighter than accentDim
  const uidColor   = t.dark ? t.accentMid : t.accentDim;
  const linksColor = t.dark ? t.accentMid : t.accentDim;

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg width="540" height="${H}" viewBox="0 0 540 ${H}" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<clipPath id="cc"><rect width="540" height="${H}" rx="14" ry="14"/></clipPath>`,
    `<linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="0%">`,
    `<stop offset="0%" stop-color="transparent"/>`,
    `<stop offset="50%" stop-color="${t.accentDim}"/>`,
    `<stop offset="100%" stop-color="transparent"/>`,
    `</linearGradient>`,
    `</defs>`,

    `<rect width="540" height="${H}" rx="14" ry="14" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>`,

    // Header
    `<rect x="0" y="0" width="540" height="42" rx="14" ry="14" fill="${t.headerBg}"/>`,
    `<rect x="0" y="28" width="540" height="14" fill="${t.headerBg}"/>`,
    dashes,
    `<text x="22" y="26" font-family="monospace" font-size="10" font-weight="bold" fill="${t.headerText}" letter-spacing="2">THE SEALER &#183; ONCHAIN STATEMENT</text>`,
    `<text x="518" y="26" font-family="monospace" font-size="8.5" fill="${uidColor}" text-anchor="end">UID: ${uid}</text>`,

    // Top stamp area
    `<g clip-path="url(#cc)">`,
    `<rect x="0" y="42" width="540" height="150" fill="${t.statBg}" opacity="0.3"/>`,
    topDeco(themeKey, t.accent, t.accentDim),
    `</g>`,

    // Stamp — 120×120, centred in 150px top area (y42+15=57)
    `<image href="${stamp}" x="210" y="57" width="120" height="120" preserveAspectRatio="xMidYMid meet" opacity="0.95"/>`,

    // Rule
    `<line x1="22" y1="200" x2="518" y2="200" stroke="${t.accentDim}" stroke-width="0.5" opacity="0.4"/>`,
    `<rect x="22" y="200" width="496" height="1" fill="url(#dg)"/>`,

    // Statement label + text
    `<text x="270" y="218" font-family="monospace" font-size="8" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="4">STATEMENT</text>`,
    textLines,

    // Stats row
    `<rect x="22" y="368" width="496" height="56" rx="4" fill="${t.statBg}" stroke="${t.statBorder}" stroke-width="1"/>`,
    `<rect x="187" y="368" width="1" height="56" fill="${t.statBorder}"/>`,
    `<rect x="352" y="368" width="1" height="56" fill="${t.statBorder}"/>`,

    `<text x="105" y="388" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">DATE ISSUED</text>`,
    `<text x="105" y="406" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">${dateStr}</text>`,

    `<text x="270" y="388" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">AGENT ID</text>`,
    `<text x="270" y="406" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">#${agentId}</text>`,

    `<text x="435" y="388" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">TX HASH</text>`,
    `<text x="435" y="406" font-family="monospace" font-size="9.5" fill="${t.bodyText}" text-anchor="middle">${uid}</text>`,

    // Footer
    `<rect x="22" y="436" width="496" height="1" fill="${t.statBorder}"/>`,
    `<text x="22" y="451" font-family="monospace" font-size="7.5" font-weight="bold" fill="${t.accent}" letter-spacing="2">CRYPTOGRAPHICALLY VERIFIED &#183; ONCHAIN &#183; IMMUTABLE</text>`,
    `<text x="518" y="444" font-family="monospace" font-size="6.5" fill="${linksColor}" text-anchor="end">EAS Attestation</text>`,
    `<text x="518" y="455" font-family="monospace" font-size="6.5" fill="${linksColor}" text-anchor="end">basescan.org</text>`,

    // Band
    `<rect x="0" y="432" width="540" height="28" fill="${t.bandBg}"/>`,
    `<rect x="0" y="432" width="540" height="1" fill="${t.statBorder}"/>`,
    `<text x="22" y="450" font-family="monospace" font-size="7" fill="${t.bandText}" opacity="0.3" letter-spacing="2">THESEALER.XYZ</text>`,
    `<image href="${mark}" x="510" y="437" width="20" height="20" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>`,

    `</svg>`,
  ].join('\n');

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}