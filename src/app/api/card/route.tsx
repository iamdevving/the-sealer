// src/app/api/card/route.tsx
// Statement Card with optional image attachment.
// Fixes: header → ONCHAIN STATEMENT, brighter UID + links on dark themes.
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
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', accentMid:'#3ab8cc', bodyText:'#d0eef5', bodyTextDim:'#7ab8cc', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', border:'#0d3040', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', accentMid:'#2a8a9a', bodyText:'#cce8ee', bodyTextDim:'#5a9aa8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', border:'#0d3040', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', accentMid:'#8b6040', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#f2ead8', border:'#c9b882', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', accentMid:'#7060b0', bodyText:'#ddd6fe', bodyTextDim:'#7060a0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', border:'#201840', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#93b4f5', accentMid:'#2a60cc', bodyText:'#0d1b2a', bodyTextDim:'#3a5080', statBg:'#d8e4ff', statBorder:'#93b4f5', bandBg:'#dce8ff', border:'#93b4f5', dark:false },
  'gold':         { bg:'#0e0b06', headerBg:'#070503', headerText:'#d4af37', accent:'#d4af37', accentDim:'#3a2e10', accentMid:'#b08a20', bodyText:'#e8ddc0', bodyTextDim:'#8a7a50', statBg:'#120e07', statBorder:'#2a2010', bandBg:'#050300', border:'#2a2010', dark:true },
  'silver':       { bg:'#0c0c10', headerBg:'#070709', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#2a3040', accentMid:'#8090b0', bodyText:'#e0e8f0', bodyTextDim:'#6070a0', statBg:'#101018', statBorder:'#2a3040', bandBg:'#070709', border:'#2a3040', dark:true },
  'bronze':       { bg:'#0e0803', headerBg:'#080400', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#3a2010', accentMid:'#a05820', bodyText:'#e8d0b0', bodyTextDim:'#806040', statBg:'#120a04', statBorder:'#2a1808', bandBg:'#050200', border:'#2a1808', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#c97a10', headerText:'#ffffff', accent:'#ffffff', accentDim:'rgba(255,255,255,0.4)', accentMid:'rgba(255,255,255,0.7)', bodyText:'#1a0800', bodyTextDim:'#5a3010', statBg:'rgba(0,0,0,0.15)', statBorder:'rgba(255,255,255,0.2)', bandBg:'#c97a10', border:'rgba(255,255,255,0.25)', dark:false },
};

function truncate(s: string, n: number) { return s.length > n ? s.slice(0,n-1)+'…' : s; }
function formatDate(d: Date) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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

  const t       = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const uid     = txHash ? '0x' + txHash.slice(2,6) + '…' + txHash.slice(-4) : '0x????…????';
  const dateStr = formatDate(new Date());

  const stamp      = t.dark ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  const mark       = t.dark ? MARK_WHITE : MARK_BLACK;
  const uidColor   = t.dark ? t.accentMid : t.accentDim;
  const linksColor = t.dark ? t.accentMid : t.accentDim;

  const isCircuit  = themeKey === 'circuit-anim' || themeKey === 'circuit';
  const traceColor = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
  const traceOp    = themeKey === 'circuit-anim' ? '0.25' : '0.15';

  const dashes = Array.from({length:44},(_,i) =>
    `<rect x="${i*12+1}" y="40" width="7" height="1.5" fill="${t.accent}" opacity="0.55"/>`
  ).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="540" height="500" viewBox="0 0 540 500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="cc"><rect width="540" height="500" rx="14" ry="14"/></clipPath>
  </defs>

  <!-- Outer border + inner accent line (double border depth) -->
  <rect width="540" height="500" rx="14" ry="14" fill="${t.bg}" stroke="${t.border}" stroke-width="2"/>
  <rect x="3" y="3" width="534" height="494" rx="12" ry="12" fill="none" stroke="${t.accent}" stroke-width="0.5" opacity="0.25"/>

  <!-- Circuit traces -->
  ${isCircuit ? `
  <g clip-path="url(#cc)">
    <g stroke="${traceColor}" stroke-width="0.8" fill="none" opacity="${traceOp}">
      <polyline points="0,70 42,70 56,84 56,140"/>
      <polyline points="0,180 35,180 48,193 48,230"/>
      <polyline points="0,310 52,310 52,290 70,290"/>
      <polyline points="540,70 498,70 484,84 484,140"/>
      <polyline points="540,180 505,180 492,193 492,230"/>
      <polyline points="540,310 488,310 474,290 456,290"/>
    </g>
    <g fill="${traceColor}" opacity="0.5">
      <circle cx="56" cy="140" r="3"/><circle cx="48" cy="230" r="2.5"/>
      <circle cx="70" cy="290" r="3"/><circle cx="484" cy="140" r="3"/>
      <circle cx="492" cy="230" r="2.5"/><circle cx="456" cy="290" r="3"/>
    </g>
  </g>` : ''}

  <!-- Header -->
  <rect x="0" y="0" width="540" height="42" rx="14" ry="14" fill="${t.headerBg}"/>
  <rect x="0" y="28" width="540" height="14" fill="${t.headerBg}"/>
  ${dashes}
  <text x="22" y="26" font-family="monospace" font-size="10" font-weight="bold" fill="${t.headerText}" letter-spacing="2">THE SEALER &#183; ONCHAIN STATEMENT</text>
  <text x="518" y="26" font-family="monospace" font-size="8.5" fill="${uidColor}" text-anchor="end">UID: ${uid}</text>

  <!-- Upper: stamp col + upload placeholder -->
  <rect x="0" y="42" width="150" height="200" fill="${t.statBg}" opacity="0.3"/>
  <image href="${stamp}" x="30" y="62" width="92" height="92" preserveAspectRatio="xMidYMid meet" opacity="0.95"/>
  <text x="75" y="170" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">STATEMENT</text>
  <rect x="20" y="180" width="110" height="16" rx="8" fill="${t.statBg}" stroke="${t.accent}" stroke-width="0.7"/>
  <text x="75" y="191" font-family="monospace" font-size="6" font-weight="bold" fill="${t.accent}" text-anchor="middle">${chain} · EAS</text>

  <!-- Upload zone -->
  <rect x="158" y="50" width="366" height="184" rx="8"
    fill="${t.statBg}" stroke="${t.accentDim}" stroke-width="1.2"
    stroke-dasharray="6,4" opacity="0.6"/>
  <text x="341" y="138" font-family="monospace" font-size="9" fill="${t.accentDim}" text-anchor="middle" opacity="0.45">NO ATTACHMENT</text>
  <text x="341" y="154" font-family="monospace" font-size="7" fill="${t.accentDim}" text-anchor="middle" opacity="0.25">PNL CARD · SCREENSHOT · CHART</text>

  <!-- Divider -->
  <line x1="22" y1="248" x2="518" y2="248" stroke="${t.accentDim}" stroke-width="0.5" opacity="0.4"/>

  <!-- Statement text -->
  <text x="22" y="268" font-family="monospace" font-size="8" font-weight="bold" fill="${t.accent}" letter-spacing="4">STATEMENT</text>
  <foreignObject x="22" y="278" width="496" height="80">
    <div xmlns="http://www.w3.org/1999/xhtml"
      style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:${t.bodyTextDim};line-height:1.55;word-wrap:break-word;">
      ${esc(statement)}
    </div>
  </foreignObject>

  <!-- Stats row -->
  <rect x="22" y="380" width="496" height="56" rx="4" fill="${t.statBg}" stroke="${t.statBorder}" stroke-width="1"/>
  <rect x="187" y="380" width="1" height="56" fill="${t.statBorder}"/>
  <rect x="352" y="380" width="1" height="56" fill="${t.statBorder}"/>

  <text x="105" y="400" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">DATE ISSUED</text>
  <text x="105" y="418" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">${dateStr}</text>

  <text x="270" y="400" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">AGENT ID</text>
  <text x="270" y="418" font-family="Georgia,serif" font-size="13" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">#${agentId}</text>

  <text x="435" y="400" font-family="monospace" font-size="6.5" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">TX HASH</text>
  <text x="435" y="418" font-family="monospace" font-size="9.5" fill="${t.bodyText}" text-anchor="middle">${uid}</text>

  <!-- Footer -->
  <text x="22" y="453" font-family="monospace" font-size="7.5" font-weight="bold" fill="${t.accent}" letter-spacing="2">CRYPTOGRAPHICALLY VERIFIED &#183; ONCHAIN &#183; IMMUTABLE</text>
  <text x="518" y="447" font-family="monospace" font-size="6.5" fill="${linksColor}" text-anchor="end">EAS Attestation</text>
  <text x="518" y="458" font-family="monospace" font-size="6.5" fill="${linksColor}" text-anchor="end">basescan.org</text>

  <!-- Band -->
  <rect x="0" y="464" width="540" height="36" fill="${t.bandBg}"/>
  <rect x="0" y="464" width="540" height="1" fill="${t.statBorder}"/>
  <text x="22" y="484" font-family="monospace" font-size="7" fill="${t.accent}" opacity="0.3" letter-spacing="2">THESEALER.XYZ · AUTONOMOUS · IMMUTABLE</text>
  <image href="${mark}" x="510" y="469" width="20" height="20" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}