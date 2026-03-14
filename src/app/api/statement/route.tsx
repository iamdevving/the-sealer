// src/app/api/statement/route.tsx
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
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', accentMid:'#3ab8cc', bodyText:'#ffffff', bodyTextDim:'#a0d8e8', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', bandText:'#00e5ff', border:'#0d3040', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', accentMid:'#2a8a9a', bodyText:'#ffffff', bodyTextDim:'#90c8d8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', bandText:'#00bcd4', border:'#0d3040', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', accentMid:'#8b6040', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#e8e0cc', bandText:'#8b1a1a', border:'#c9b882', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', accentMid:'#7060b0', bodyText:'#ffffff', bodyTextDim:'#b0a0e0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', bandText:'#a78bfa', border:'#201840', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#4d88ff', accentMid:'#2a60cc', bodyText:'#0a1a3a', bodyTextDim:'#2a4a8a', statBg:'#dde6ff', statBorder:'#b0c8ff', bandBg:'#d0dcff', bandText:'#0052ff', border:'#b0c8ff', dark:false },
  'gold':         { bg:'#0d0a04', headerBg:'#1a1200', headerText:'#d4af37', accent:'#d4af37', accentDim:'#8b6914', accentMid:'#b08a20', bodyText:'#ffffff', bodyTextDim:'#c8b870', statBg:'#140f03', statBorder:'#3a2a08', bandBg:'#0a0800', bandText:'#d4af37', border:'#3a2a08', dark:true },
  'silver':       { bg:'#0a0c10', headerBg:'#0d1018', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#4a5a80', accentMid:'#8090b0', bodyText:'#ffffff', bodyTextDim:'#a0b0c8', statBg:'#0d1018', statBorder:'#2a3448', bandBg:'#080a0e', bandText:'#c0c8d8', border:'#2a3448', dark:true },
  'bronze':       { bg:'#0c0804', headerBg:'#120a02', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#8b4513', accentMid:'#a05820', bodyText:'#ffffff', bodyTextDim:'#c09060', statBg:'#100a03', statBorder:'#3a1e08', bandBg:'#080502', bandText:'#cd7f32', border:'#3a1e08', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#d4720a', headerText:'#ffffff', accent:'#ffffff', accentDim:'#ffe8c0', accentMid:'#fff0d0', bodyText:'#1a0a00', bodyTextDim:'#5a3000', statBg:'#e8820a', statBorder:'#c46000', bandBg:'#b85800', bandText:'#ffffff', border:'#c46000', dark:false },
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

function topDeco(themeKey: string, accent: string): string {
  switch (themeKey) {
    case 'circuit-anim':
    case 'circuit': {
      const c = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
      return [
        `<g stroke="${c}" stroke-width="0.7" fill="none" opacity="0.3">`,
        `<polyline points="0,62 52,62 66,76 66,110"/>`,
        `<polyline points="0,92 40,92 54,106 54,130"/>`,
        `<polyline points="540,62 488,62 474,76 474,110"/>`,
        `<polyline points="540,92 500,92 486,106 486,130"/>`,
        `</g>`,
        `<g fill="${c}" opacity="0.7">`,
        `<circle cx="66" cy="110" r="2.5"/><circle cx="54" cy="130" r="2.5"/>`,
        `<circle cx="474" cy="110" r="2.5"/><circle cx="486" cy="130" r="2.5"/>`,
        `</g>`,
      ].join('');
    }
    case 'aurora':
      return [
        `<g fill="none" opacity="0.18">`,
        `<path d="M 0,78 Q 135,48 270,78 Q 405,108 540,78" stroke="${accent}" stroke-width="1"/>`,
        `<path d="M 0,106 Q 135,76 270,106 Q 405,136 540,106" stroke="#c4b5fd" stroke-width="0.8"/>`,
        `<path d="M 0,134 Q 135,104 270,134 Q 405,164 540,134" stroke="${accent}" stroke-width="0.5" opacity="0.5"/>`,
        `</g>`,
        `<g fill="#c4b5fd" opacity="0.5">`,
        `<circle cx="20" cy="63" r="1.5"/><circle cx="520" cy="70" r="1.2"/>`,
        `<circle cx="140" cy="56" r="1"/><circle cx="400" cy="60" r="1.5"/>`,
        `</g>`,
      ].join('');
    case 'parchment':
      return [
        `<g stroke="#c9b882" stroke-width="0.7" fill="none" opacity="0.25">`,
        `<path d="M 0,50 Q 0,72 18,75 Q 48,80 52,96"/>`,
        `<path d="M 540,50 Q 540,72 522,75 Q 492,80 488,96"/>`,
        `<path d="M 0,192 Q 0,170 18,167 Q 48,162 52,148"/>`,
        `<path d="M 540,192 Q 540,170 522,167 Q 492,162 488,148"/>`,
        `</g>`,
      ].join('');
    case 'base':
      return [
        `<g stroke="${accent}" stroke-width="0.25" opacity="0.12">`,
        ...[0,40,80,120,160,200,240,280,320,360,400,440,480,540].map(x=>`<line x1="${x}" y1="42" x2="${x}" y2="192"/>`),
        ...[68,88,108,128,148,168,188].map(y=>`<line x1="0" y1="${y}" x2="540" y2="${y}"/>`),
        `</g>`,
        `<rect x="0" y="42" width="3" height="150" fill="${accent}" opacity="0.35"/>`,
        `<rect x="537" y="42" width="3" height="150" fill="${accent}" opacity="0.35"/>`,
      ].join('');
    case 'silver': {
      const hex = (cx: number, cy: number, r: number) => {
        const pts = Array.from({length:6},(_,i)=>{const a=Math.PI/180*(60*i-30);return`${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;}).join(' ');
        return `<polygon points="${pts}" stroke="${accent}" stroke-width="0.5" fill="none" opacity="0.1"/>`;
      };
      return hex(30,85,26)+hex(68,85,26)+hex(49,107,26)+hex(472,85,26)+hex(510,85,26)+hex(491,107,26);
    }
    case 'bitcoin':
      return [
        `<g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.06">`,
        `<text x="10" y="130" font-size="60" transform="rotate(-15,10,130)">₿</text>`,
        `<text x="420" y="105" font-size="65" transform="rotate(-15,420,105)">₿</text>`,
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
  const stamp   = t.dark ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  const mark    = t.dark ? MARK_WHITE : MARK_BLACK;

  const charCount = statement.length;
  const fontSize  = charCount <= 80 ? 17 : charCount <= 140 ? 15 : charCount <= 200 ? 13.5 : 12;
  const lineH     = fontSize + 12;
  const maxChars  = charCount <= 80 ? 44 : charCount <= 140 ? 50 : charCount <= 200 ? 56 : 60;
  const lines     = wrapText(esc(statement), maxChars, 6);
  const totalTextH = lines.length * lineH;

  // Smaller card: 420px tall
  const H = 420;
  const stampY    = 50;  // stamp top y
  const stampH    = 130; // stamp area height
  const dividerY  = stampY + stampH; // 180
  const textAreaH = 120;
  const textStartY = dividerY + 20 + Math.round((textAreaH - totalTextH) / 2);
  const statsY    = dividerY + textAreaH + 16; // ~316
  const bandY     = H - 32;

  const uidColor   = t.dark ? t.accentMid : t.accentDim;

  const dashes = Array.from({length:44},(_,i) =>
    `<rect x="${i*12+1}" y="38" width="7" height="1.5" fill="${t.accent}" opacity="0.55"/>`
  ).join('');

  const textLines = lines.map((line,i) =>
    `<text x="270" y="${textStartY + i*lineH}" font-family="Georgia,serif" font-size="${fontSize}" fill="${t.bodyText}" font-style="italic" text-anchor="middle">${line}</text>`
  ).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="540" height="${H}" viewBox="0 0 540 ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <!-- clipPath covers entire card with rounded corners — all children clipped -->
  <clipPath id="cc"><rect width="540" height="${H}" rx="14" ry="14"/></clipPath>
  <linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="transparent"/>
    <stop offset="50%" stop-color="${t.accentDim}"/>
    <stop offset="100%" stop-color="transparent"/>
  </linearGradient>
</defs>

<!-- Everything clipped to rounded rect -->
<g clip-path="url(#cc)">

  <!-- Card background -->
  <rect width="540" height="${H}" fill="${t.bg}"/>

  <!-- Bitcoin background deco -->
  ${themeKey === 'bitcoin' ? `
  <g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.055">
    <text x="-10" y="150" font-size="120" transform="rotate(-15,-10,150)">₿</text>
    <text x="300" y="80" font-size="100" transform="rotate(-15,300,80)">₿</text>
    <text x="360" y="340" font-size="85" transform="rotate(-15,360,340)">₿</text>
    <text x="120" y="360" font-size="65" transform="rotate(-15,120,360)">₿</text>
    <text x="450" y="200" font-size="55" transform="rotate(-15,450,200)">₿</text>
  </g>` : ''}

  <!-- Stamp area tint -->
  <rect x="0" y="42" width="540" height="${stampH}" fill="${t.statBg}" opacity="0.3"/>

  <!-- Theme deco (stamp area) -->
  ${topDeco(themeKey, t.accent)}

  <!-- Full-card circuit traces (mid + lower) with dots -->
  ${(themeKey === 'circuit-anim' || themeKey === 'circuit') ? `
  <g stroke="${themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4'}" stroke-width="0.7" fill="none" opacity="0.22">
    <polyline points="0,240 40,240 40,256 56,256"/>
    <polyline points="0,305 34,305 48,291"/>
    <polyline points="540,240 500,240 500,256 484,256"/>
    <polyline points="540,305 506,305 492,291"/>
  </g>
  <g fill="${themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4'}" opacity="0.6">
    <circle cx="56" cy="256" r="2.5"/><circle cx="48" cy="291" r="2.5"/>
    <circle cx="484" cy="256" r="2.5"/><circle cx="492" cy="291" r="2.5"/>
  </g>` : ''}

  <!-- Header -->
  <rect x="0" y="0" width="540" height="42" fill="${t.headerBg}"/>
  ${dashes}
  <text x="22" y="26" font-family="monospace" font-size="9.5" font-weight="bold" fill="${t.headerText}" letter-spacing="2">THE SEALER PROTOCOL &#183; ONCHAIN STATEMENT</text>
  <text x="518" y="26" font-family="monospace" font-size="8" fill="${uidColor}" text-anchor="end">UID: ${uid}</text>

  <!-- Divider -->
  <rect x="0" y="${dividerY}" width="540" height="1" fill="url(#dg)" opacity="0.6"/>

  <!-- Statement label -->
  <text x="270" y="${dividerY + 14}" font-family="monospace" font-size="7.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="4">STATEMENT</text>

  <!-- Statement text -->
  ${textLines}

  <!-- Stats row -->
  <rect x="22" y="${statsY}" width="496" height="52" rx="4" fill="${t.statBg}" stroke="${t.statBorder}" stroke-width="1"/>
  <rect x="187" y="${statsY}" width="1" height="52" fill="${t.statBorder}"/>
  <rect x="352" y="${statsY}" width="1" height="52" fill="${t.statBorder}"/>

  <text x="105" y="${statsY+16}" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">DATE ISSUED</text>
  <text x="105" y="${statsY+34}" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">${dateStr}</text>

  <text x="270" y="${statsY+16}" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">AGENT ID</text>
  <text x="270" y="${statsY+34}" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">#${agentId}</text>

  <text x="435" y="${statsY+16}" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">TX HASH</text>
  <text x="435" y="${statsY+34}" font-family="monospace" font-size="9.5" fill="${t.bodyText}" text-anchor="middle">${uid}</text>

  <!-- Footer band -->
  <rect x="0" y="${bandY}" width="540" height="32" fill="${t.bandBg}"/>
  <rect x="0" y="${bandY}" width="540" height="1" fill="${t.statBorder}"/>
  <text x="22" y="${bandY+18}" font-family="monospace" font-size="7" fill="${t.bandText}" opacity="0.4" letter-spacing="2">THESEALER.XYZ &#183; CRYPTOGRAPHICALLY VERIFIED</text>
  <image href="${mark}" x="491" y="441" width="32" height="32" preserveAspectRatio="xMidYMid meet" opacity="0.75"/>

</g>

<!-- Double border drawn OUTSIDE clip so it sits on top, fully rounded -->
<rect width="540" height="${H}" rx="14" ry="14" fill="none" stroke="${t.border}" stroke-width="2.5"/>
<rect x="3" y="3" width="534" height="${H-6}" rx="12" ry="12" fill="none" stroke="${t.accent}" stroke-width="0.6" opacity="0.2"/>

<!-- Stamp on top of clip group so it's not clipped -->
<image href="${stamp}" x="210" y="${stampY+4}" width="120" height="120" preserveAspectRatio="xMidYMid meet" opacity="0.95"/>

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}