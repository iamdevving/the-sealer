// src/app/api/card/route.tsx
import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE, MARK_BLACK, STAMP_STATEMENT_WHITE, STAMP_STATEMENT_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const THEMES: Record<string, {
  bg: string; headerBg: string; headerText: string;
  accent: string; accentDim: string; accentMid: string;
  bodyText: string; bodyTextDim: string;
  statBg: string; statBorder: string;
  bandBg: string; border: string; dark: boolean;
}> = {
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', accentMid:'#3ab8cc', bodyText:'#ffffff', bodyTextDim:'#a0d8e8', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', border:'#0d3040', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', accentMid:'#2a8a9a', bodyText:'#ffffff', bodyTextDim:'#90c8d8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', border:'#0d3040', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', accentMid:'#8b6040', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#e8e0cc', border:'#c9b882', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', accentMid:'#7060b0', bodyText:'#ffffff', bodyTextDim:'#b0a0e0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', border:'#201840', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#4d88ff', accentMid:'#2a60cc', bodyText:'#0a1a3a', bodyTextDim:'#2a4a8a', statBg:'#dde6ff', statBorder:'#b0c8ff', bandBg:'#d0dcff', border:'#b0c8ff', dark:false },
  'gold':         { bg:'#0d0a04', headerBg:'#1a1200', headerText:'#d4af37', accent:'#d4af37', accentDim:'#8b6914', accentMid:'#b08a20', bodyText:'#ffffff', bodyTextDim:'#c8b870', statBg:'#140f03', statBorder:'#3a2a08', bandBg:'#0a0800', border:'#3a2a08', dark:true },
  'silver':       { bg:'#0a0c10', headerBg:'#0d1018', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#4a5a80', accentMid:'#8090b0', bodyText:'#ffffff', bodyTextDim:'#a0b0c8', statBg:'#0d1018', statBorder:'#2a3448', bandBg:'#080a0e', border:'#2a3448', dark:true },
  'bronze':       { bg:'#0c0804', headerBg:'#120a02', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#8b4513', accentMid:'#a05820', bodyText:'#ffffff', bodyTextDim:'#c09060', statBg:'#100a03', statBorder:'#3a1e08', bandBg:'#080502', border:'#3a1e08', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#d4720a', headerText:'#ffffff', accent:'#ffffff', accentDim:'rgba(255,255,255,0.4)', accentMid:'rgba(255,255,255,0.7)', bodyText:'#1a0800', bodyTextDim:'#5a3010', statBg:'rgba(0,0,0,0.15)', statBorder:'rgba(255,255,255,0.2)', bandBg:'#c97a10', border:'rgba(255,255,255,0.25)', dark:false },
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
    statement = truncate(data.statement, 120);
    themeKey  = searchParams.get('theme') || 'circuit-anim';
    agentId   = esc(data.recipient.slice(0,8));
    txHash    = data.txHash;
    chain     = searchParams.get('chain') || 'Base';
  } else {
    statement = truncate(searchParams.get('statement') || searchParams.get('achievement') || 'Verified Onchain Statement', 120);
    themeKey  = searchParams.get('theme') || 'circuit-anim';
    const rawId = searchParams.get('agentId') || '????';
    agentId   = esc(rawId.startsWith('0x') ? rawId.slice(0, 8) : rawId);
    txHash    = searchParams.get('txHash') || '';
    chain     = esc(searchParams.get('chain') || 'Base');
  }

  const t        = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const uid      = txHash ? '0x' + txHash.slice(2,6) + '…' + txHash.slice(-4) : '0x????…????';
  const dateStr  = formatDate(new Date());
  const stamp    = t.dark ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  const mark     = t.dark ? MARK_WHITE : MARK_BLACK;
  const uidColor = t.dark ? t.accentMid : t.accentDim;

  const isCircuit  = themeKey === 'circuit-anim' || themeKey === 'circuit';
  const traceColor = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';

  // Text wrapping for statement
  const charCount  = statement.length;
  const fontSize   = charCount <= 60 ? 16 : charCount <= 90 ? 14 : 12.5;
  const lineH      = fontSize + 10;
  const maxChars   = charCount <= 60 ? 42 : charCount <= 90 ? 50 : 56;
  const lines      = wrapText(esc(statement), maxChars, 4);
  const totalTextH = lines.length * lineH;

  const H = 470;
  const dashes = Array.from({length:44},(_,i) =>
    `<rect x="${i*12+1}" y="38" width="7" height="1.5" fill="${t.accent}" opacity="0.55"/>`
  ).join('');

  // Centred statement text in the body area (y258–358)
  const textBodyTop = 258;
  const textBodyH   = 100;
  const textStartY  = textBodyTop + Math.round((textBodyH - totalTextH) / 2) + fontSize;
  const textLines   = lines.map((line,i) =>
    `<text x="270" y="${textStartY + i*lineH}" font-family="Georgia,serif" font-size="${fontSize}" fill="${t.bodyText}" font-style="italic" text-anchor="middle">${line}</text>`
  ).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="540" height="${H}" viewBox="0 0 540 ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <clipPath id="cc"><rect width="540" height="${H}" rx="14" ry="14"/></clipPath>
  <linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="transparent"/>
    <stop offset="50%" stop-color="${t.accentDim}"/>
    <stop offset="100%" stop-color="transparent"/>
  </linearGradient>
</defs>

<g clip-path="url(#cc)">

  <!-- Background -->
  <rect width="540" height="${H}" fill="${t.bg}"/>

  <!-- Bitcoin background deco -->
  ${themeKey === 'bitcoin' ? `
  <g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.06">
    <text x="10" y="150" font-size="120" transform="rotate(-15,10,150)">₿</text>
    <text x="340" y="100" font-size="100" transform="rotate(-15,340,100)">₿</text>
    <text x="420" y="380" font-size="80" transform="rotate(-15,420,380)">₿</text>
  </g>` : ''}

  <!-- Circuit traces — left column (behind stamp) + right side full height -->
  ${isCircuit ? `
  <g stroke="${traceColor}" stroke-width="0.8" fill="none" opacity="0.25">
    <!-- Left: from edge, runs down the stamp column -->
    <polyline points="0,72 38,72 52,86 52,160"/>
    <polyline points="0,100 30,100 44,114 44,200"/>
    <polyline points="0,130 24,130"/>
    <polyline points="0,260 36,260 50,246"/>
    <polyline points="0,340 30,340 44,356"/>
    <!-- Right: from edge, full height -->
    <polyline points="540,72 502,72 488,86 488,160"/>
    <polyline points="540,100 510,100 496,114 496,200"/>
    <polyline points="540,130 516,130"/>
    <polyline points="540,260 504,260 490,246"/>
    <polyline points="540,340 510,340 496,356"/>
  </g>
  <g fill="${traceColor}" opacity="0.6">
    <circle cx="52" cy="160" r="3"/><circle cx="44" cy="200" r="2.5"/>
    <circle cx="50" cy="246" r="2"/><circle cx="44" cy="356" r="2"/>
    <circle cx="488" cy="160" r="3"/><circle cx="496" cy="200" r="2.5"/>
    <circle cx="490" cy="246" r="2"/><circle cx="496" cy="356" r="2"/>
  </g>` : ''}

  <!-- Header -->
  <rect x="0" y="0" width="540" height="42" fill="${t.headerBg}"/>
  ${dashes}
  <text x="22" y="25" font-family="monospace" font-size="9.5" font-weight="bold" fill="${t.headerText}" letter-spacing="2">THE SEALER PROTOCOL &#183; ONCHAIN STATEMENT</text>
  <text x="518" y="25" font-family="monospace" font-size="8" fill="${uidColor}" text-anchor="end">UID: ${uid}</text>

  <!-- Stamp — displayed in left column, no background rect -->
  <image href="${stamp}" x="29" y="58" width="92" height="92" preserveAspectRatio="xMidYMid meet" opacity="0.95"/>

  <!-- Chain pill — proper pill shape restored -->
  <rect x="20" y="162" width="110" height="16" rx="8" fill="${t.statBg}" stroke="${t.accent}" stroke-width="0.8" opacity="0.8"/>
  <text x="75" y="173" font-family="monospace" font-size="6" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">${chain} &#183; EAS</text>

  <!-- Upload zone -->
  <rect x="158" y="50" width="366" height="186" rx="8"
    fill="${t.statBg}" stroke="${t.accentDim}" stroke-width="1.2"
    stroke-dasharray="6,4" opacity="0.5"/>
  <text x="341" y="140" font-family="monospace" font-size="9" fill="${t.accentDim}" text-anchor="middle" opacity="0.4">NO ATTACHMENT</text>
  <text x="341" y="157" font-family="monospace" font-size="7" fill="${t.accentDim}" text-anchor="middle" opacity="0.2">P&amp;L CARD · SCREENSHOT · CHART</text>

  <!-- Divider -->
  <rect x="0" y="244" width="540" height="1" fill="url(#dg)" opacity="0.5"/>

  <!-- Statement label -->
  <text x="270" y="258" font-family="monospace" font-size="7.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="4">STATEMENT</text>

  <!-- Statement text — centred -->
  ${textLines}

  <!-- Stats row -->
  <rect x="22" y="372" width="496" height="52" rx="4" fill="${t.statBg}" stroke="${t.statBorder}" stroke-width="1"/>
  <rect x="187" y="372" width="1" height="52" fill="${t.statBorder}"/>
  <rect x="352" y="372" width="1" height="52" fill="${t.statBorder}"/>

  <text x="105" y="390" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">DATE ISSUED</text>
  <text x="105" y="408" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">${dateStr}</text>

  <text x="270" y="390" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">AGENT ID</text>
  <text x="270" y="408" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">#${agentId}</text>

  <text x="435" y="390" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">TX HASH</text>
  <text x="435" y="408" font-family="monospace" font-size="9.5" fill="${t.bodyText}" text-anchor="middle">${uid}</text>

  <!-- Links row -->
  <text x="518" y="434" font-family="monospace" font-size="6.5" fill="${uidColor}" text-anchor="end">EAS Attestation &#183; basescan.org</text>

  <!-- Footer band -->
  <rect x="0" y="438" width="540" height="32" fill="${t.bandBg}"/>
  <rect x="0" y="438" width="540" height="1" fill="${t.statBorder}"/>
  <text x="22" y="457" font-family="monospace" font-size="7" fill="${t.headerText}" opacity="0.3" letter-spacing="2">THESEALER.XYZ &#183; CRYPTOGRAPHICALLY VERIFIED</text>
  <image href="${mark}" x="511" y="445" width="18" height="18" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>

</g>

<!-- Double border on top of clip -->
<rect width="540" height="${H}" rx="14" ry="14" fill="none" stroke="${t.border}" stroke-width="2.5"/>
<rect x="3" y="3" width="534" height="${H-6}" rx="12" ry="12" fill="none" stroke="${t.accent}" stroke-width="0.6" opacity="0.2"/>

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}