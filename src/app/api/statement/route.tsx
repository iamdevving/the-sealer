// src/app/api/card/route.tsx
// Statement Card — no image/attachment required.
// Top area: large centred REGISTERED STATEMENT stamp + theme deco.
// Text area: expanded, bigger font, more characters.
import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE, MARK_BLACK, STAMP_STATEMENT_WHITE, STAMP_STATEMENT_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const THEMES: Record<string, {
  bg: string; headerBg: string; headerText: string;
  accent: string; accentDim: string;
  bodyText: string; bodyTextDim: string;
  statBg: string; statBorder: string;
  bandBg: string; bandText: string;
  border: string; dark: boolean;
}> = {
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', bodyText:'#d0eef5', bodyTextDim:'#7ab8cc', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', bandText:'#00e5ff', border:'#0d3040', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', bodyText:'#cce8ee', bodyTextDim:'#5a9aa8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', bandText:'#00bcd4', border:'#0d3040', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#f2ead8', bandText:'#8b1a1a', border:'#c9b882', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', bodyText:'#ddd6fe', bodyTextDim:'#7060a0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', bandText:'#a78bfa', border:'#201840', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#4d88ff', bodyText:'#0a1a3a', bodyTextDim:'#2a4a8a', statBg:'#dde6ff', statBorder:'#b0c8ff', bandBg:'#0042cc', bandText:'#ffffff', border:'#b0c8ff', dark:false },
  'gold':         { bg:'#0d0a04', headerBg:'#1a1200', headerText:'#d4af37', accent:'#d4af37', accentDim:'#8b6914', bodyText:'#f0e0a0', bodyTextDim:'#a08020', statBg:'#140f03', statBorder:'#3a2a08', bandBg:'#0a0800', bandText:'#d4af37', border:'#3a2a08', dark:true },
  'silver':       { bg:'#0a0c10', headerBg:'#0d1018', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#4a5a80', bodyText:'#e8ecf4', bodyTextDim:'#7080a0', statBg:'#0d1018', statBorder:'#2a3448', bandBg:'#080a0e', bandText:'#c0c8d8', border:'#2a3448', dark:true },
  'bronze':       { bg:'#0c0804', headerBg:'#120a02', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#8b4513', bodyText:'#f0c890', bodyTextDim:'#8b5a20', statBg:'#100a03', statBorder:'#3a1e08', bandBg:'#080502', bandText:'#cd7f32', border:'#3a1e08', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#d4720a', headerText:'#ffffff', accent:'#ffffff', accentDim:'#ffe8c0', bodyText:'#1a0a00', bodyTextDim:'#5a3000', statBg:'#e8820a', statBorder:'#c46000', bandBg:'#b85800', bandText:'#ffffff', border:'#c46000', dark:true },
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

// ── Per-theme top-area decoration (fills space around the stamp) ──────────────

function topDeco(themeKey: string, accent: string, accentDim: string): string {
  switch (themeKey) {
    case 'circuit-anim':
    case 'circuit': {
      const c = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
      return [
        // Horizontal trace lines left
        `<g stroke="${c}" stroke-width="0.7" fill="none" opacity="0.35">`,
        `<polyline points="22,80 80,80 94,94"/>`,
        `<polyline points="22,105 65,105 79,119"/>`,
        `<polyline points="22,130 55,130"/>`,
        // Right side
        `<polyline points="538,80 480,80 466,94"/>`,
        `<polyline points="538,105 495,105 481,119"/>`,
        `<polyline points="538,130 505,130"/>`,
        `</g>`,
        // Node dots
        `<g fill="${c}" opacity="0.6">`,
        `<circle cx="94" cy="94" r="2.5"/><circle cx="79" cy="119" r="2"/>`,
        `<circle cx="466" cy="94" r="2.5"/><circle cx="481" cy="119" r="2"/>`,
        `</g>`,
        // Top corner brackets
        `<g stroke="${c}" stroke-width="1" fill="none" opacity="0.4">`,
        `<polyline points="22,55 22,68 35,68"/>`,
        `<polyline points="538,55 538,68 525,68"/>`,
        `</g>`,
      ].join('');
    }
    case 'parchment':
      return [
        `<g stroke="#c9b882" stroke-width="0.7" fill="none" opacity="0.3">`,
        `<path d="M 22,58 Q 22,75 35,78 Q 48,81 52,100"/>`,
        `<path d="M 538,58 Q 538,75 525,78 Q 512,81 508,100"/>`,
        `<path d="M 22,215 Q 22,198 35,195 Q 48,192 52,175"/>`,
        `<path d="M 538,215 Q 538,198 525,195 Q 512,192 508,175"/>`,
        `</g>`,
        `<line x1="22" y1="58" x2="538" y2="58" stroke="#c9b882" stroke-width="0.4" opacity="0.2"/>`,
        `<line x1="22" y1="215" x2="538" y2="215" stroke="#c9b882" stroke-width="0.4" opacity="0.2"/>`,
        `<g stroke="#8b1a1a" stroke-width="0.3" opacity="0.04">`,
        `<line x1="0" y1="55" x2="560" y2="220"/>`,
        `<line x1="560" y1="55" x2="0" y2="220"/>`,
        `</g>`,
      ].join('');
    case 'aurora':
      return [
        `<g opacity="0.08">`,
        `<ellipse cx="100" cy="136" rx="120" ry="90" fill="#7c3aed"/>`,
        `<ellipse cx="460" cy="136" rx="120" ry="90" fill="${accent}"/>`,
        `</g>`,
        `<g fill="none" opacity="0.12">`,
        `<path d="M 0,90 Q 140,60 280,90 Q 420,120 560,90" stroke="${accent}" stroke-width="1"/>`,
        `<path d="M 0,115 Q 140,85 280,115 Q 420,145 560,115" stroke="#c4b5fd" stroke-width="0.7"/>`,
        `<path d="M 0,180 Q 140,150 280,180 Q 420,210 560,180" stroke="${accent}" stroke-width="0.6"/>`,
        `</g>`,
        `<g fill="#c4b5fd">`,
        `<circle cx="40" cy="70" r="1.5" opacity="0.5"/><circle cx="520" cy="80" r="1" opacity="0.4"/>`,
        `<circle cx="180" cy="62" r="1" opacity="0.4"/><circle cx="390" cy="68" r="1.5" opacity="0.45"/>`,
        `</g>`,
      ].join('');
    case 'base':
      return [
        `<g stroke="${accent}" stroke-width="0.25" opacity="0.12">`,
        ...[40,80,120,160,200,240,280,320,360,400,440,480,520].map(x => `<line x1="${x}" y1="55" x2="${x}" y2="220"/>`),
        ...[75,95,115,135,155,175,195,215].map(y => `<line x1="22" y1="${y}" x2="538" y2="${y}"/>`),
        `</g>`,
        `<rect x="0" y="55" width="3" height="165" fill="${accent}" opacity="0.4"/>`,
        `<g stroke="${accent}" stroke-width="1" opacity="0.3">`,
        `<line x1="26" y1="59" x2="38" y2="59"/><line x1="32" y1="53" x2="32" y2="65"/>`,
        `<line x1="522" y1="59" x2="534" y2="59"/><line x1="528" y1="53" x2="528" y2="65"/>`,
        `</g>`,
      ].join('');
    case 'gold':
      return [
        `<polygon points="280,65 430,200 280,215 130,200" stroke="${accent}" stroke-width="0.7" fill="none" opacity="0.08"/>`,
        `<g stroke="${accent}" stroke-width="0.3" opacity="0.07">`,
        `<line x1="280" y1="136" x2="22" y2="58"/><line x1="280" y1="136" x2="538" y2="58"/>`,
        `<line x1="280" y1="136" x2="22" y2="215"/><line x1="280" y1="136" x2="538" y2="215"/>`,
        `</g>`,
        // Corner ornaments
        `<g stroke="${accent}" stroke-width="0.8" fill="none" opacity="0.2">`,
        `<path d="M 22,58 L 42,58 L 42,78"/><path d="M 538,58 L 518,58 L 518,78"/>`,
        `<path d="M 22,215 L 42,215 L 42,195"/><path d="M 538,215 L 518,215 L 518,195"/>`,
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
      return [
        hex(38,90,28), hex(78,90,28), hex(58,114,28),
        hex(482,90,28), hex(522,90,28), hex(502,114,28),
        `<line x1="22" y1="58" x2="538" y2="58" stroke="${accent}" stroke-width="0.4" opacity="0.15"/>`,
        `<line x1="22" y1="215" x2="538" y2="215" stroke="${accent}" stroke-width="0.4" opacity="0.15"/>`,
      ].join('');
    }
    case 'bronze':
      return [
        `<g fill="${accent}" opacity="0.03">`,
        `<circle cx="70" cy="110" r="55"/><circle cx="490" cy="120" r="45"/>`,
        `</g>`,
        `<g stroke="${accent}" stroke-width="0.5" opacity="0.12">`,
        `<line x1="22" y1="65" x2="538" y2="65"/><line x1="22" y1="69" x2="538" y2="69"/>`,
        `<line x1="22" y1="210" x2="538" y2="210"/><line x1="22" y1="214" x2="538" y2="214"/>`,
        `</g>`,
      ].join('');
    case 'bitcoin':
      return [
        `<g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.1">`,
        `<text x="22"  y="130" font-size="55" transform="rotate(-15,22,130)">₿</text>`,
        `<text x="440" y="110" font-size="60" transform="rotate(-15,440,110)">₿</text>`,
        `<text x="200" y="85"  font-size="40" transform="rotate(-15,200,85)">₿</text>`,
        `</g>`,
        `<g fill="white" opacity="0.12">`,
        ...[200,235,270,305,340,375,410,445,480,515].map(x => `<circle cx="${x}" cy="70" r="3"/>`),
        ...[218,253,288,323,358,393,428,463,498].map(x => `<circle cx="${x}" cy="88" r="2"/>`),
        `</g>`,
      ].join('');
    default: return '';
  }
}

function getBodyDeco(themeKey: string, accent: string): string {
  switch (themeKey) {
    case 'circuit-anim':
    case 'circuit': {
      const c = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
      const op = themeKey === 'circuit-anim' ? '0.25' : '0.15';
      return [
        `<g stroke="${c}" stroke-width="0.8" fill="none" opacity="${op}">`,
        `<polyline points="0,310 40,310 54,324 54,370"/>`,
        `<polyline points="560,310 520,310 506,324 506,370"/>`,
        `</g>`,
        `<g fill="${c}" opacity="0.5">`,
        `<circle cx="54" cy="370" r="2.5"/><circle cx="506" cy="370" r="2.5"/>`,
        `</g>`,
      ].join('');
    }
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
    statement = truncate(searchParams.get('statement') || searchParams.get('achievement') || 'Verified Statement', 300);
    themeKey  = searchParams.get('theme') || 'circuit-anim';
    const rawId = searchParams.get('agentId') || '????';
    agentId   = esc(rawId.startsWith('0x') ? rawId.slice(0, 8) : rawId);
    txHash    = searchParams.get('txHash') || '';
    chain     = esc(searchParams.get('chain') || 'Base');
  }

  const t       = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const uid     = txHash ? '0x' + txHash.slice(2,6) + '…' + txHash.slice(-4) : '0x????…????';
  const dateStr = formatDate(new Date());

  // Stamp: white on dark, black on light
  const stamp = t.dark ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  const mark  = t.dark ? MARK_WHITE : MARK_BLACK;

  // ── Text sizing — more generous now (no image area competing for space) ──────
  // Up to 300 chars, 6 lines, larger font
  const charCount = statement.length;
  const fontSize  = charCount <= 80  ? 18
                  : charCount <= 140 ? 16
                  : charCount <= 200 ? 14
                  : 12.5;
  const lineH     = fontSize + 13;
  const maxChars  = charCount <= 80  ? 44
                  : charCount <= 140 ? 50
                  : charCount <= 200 ? 56
                  : 60;
  const maxLines  = 6;
  const lines     = wrapText(esc(statement), maxChars, maxLines);

  const totalTextH = lines.length * lineH;
  // Text block sits in y 255–415 (160px tall zone)
  const textStartY = Math.round(258 + (160 - totalTextH) / 2);

  const dashes = Array.from({length:46},(_,i) =>
    `<rect x="${i*12+1}" y="40" width="7" height="1.5" fill="${t.accent}" opacity="0.55"/>`
  ).join('');

  const achievementLines = lines.map((line,i) =>
    `<text x="280" y="${textStartY + i*lineH}" font-family="Georgia,serif" font-size="${fontSize}" fill="${t.bodyTextDim}" font-style="italic" text-anchor="middle">${line}</text>`
  ).join('');

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg width="560" height="530" viewBox="0 0 560 530" xmlns="http://www.w3.org/2000/svg">`,
    `<defs>`,
    `<clipPath id="cc"><rect width="560" height="530" rx="14" ry="14"/></clipPath>`,
    `<linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="0%">`,
    `<stop offset="0%" stop-color="transparent"/>`,
    `<stop offset="50%" stop-color="${t.accentDim}"/>`,
    `<stop offset="100%" stop-color="transparent"/>`,
    `</linearGradient>`,
    `</defs>`,

    // Base card
    `<rect width="560" height="530" rx="14" ry="14" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>`,

    // Header
    `<rect x="0" y="0" width="560" height="42" rx="14" ry="14" fill="${t.headerBg}"/>`,
    `<rect x="0" y="28" width="560" height="14" fill="${t.headerBg}"/>`,
    dashes,
    `<text x="22" y="26" font-family="monospace" font-size="10.5" font-weight="bold" fill="${t.headerText}" letter-spacing="2.5">THE SEALER &#183; OFFICIAL CREDENTIAL</text>`,
    `<text x="538" y="26" font-family="monospace" font-size="9" fill="${t.accentDim}" text-anchor="end">UID: ${uid}</text>`,

    // ── TOP AREA: large centred stamp + per-theme deco ────────────────────────
    // Top area band: y 42–222 (180px)
    `<g clip-path="url(#cc)">`,
    // Subtle top area tint to separate it from body
    `<rect x="0" y="42" width="560" height="180" fill="${t.statBg}" opacity="0.35"/>`,
    topDeco(themeKey, t.accent, t.accentDim),
    `</g>`,

    // REGISTERED STATEMENT stamp — large, centred in top area
    // Square stamp: 140×140, centred at x=280, top area centre y=132
    `<image href="${stamp}" x="210" y="62" width="140" height="140" preserveAspectRatio="xMidYMid meet" opacity="0.95"/>`,

    // Thin rule separating top area from body
    `<line x1="22" y1="228" x2="538" y2="228" stroke="${t.accentDim}" stroke-width="0.5" opacity="0.4"/>`,
    `<rect x="22" y="228" width="516" height="1" fill="url(#dg)"/>`,

    // ── BODY: statement label + text ─────────────────────────────────────────
    `<text x="280" y="248" font-family="monospace" font-size="12" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="5">STATEMENT</text>`,

    achievementLines,

    // Body deco (circuit traces etc.)
    `<g clip-path="url(#cc)">${getBodyDeco(themeKey, t.accent)}</g>`,

    // ── STATS ROW ─────────────────────────────────────────────────────────────
    `<rect x="22" y="430" width="516" height="60" rx="4" fill="${t.statBg}" stroke="${t.statBorder}" stroke-width="1"/>`,
    `<rect x="196" y="430" width="1" height="60" fill="${t.statBorder}"/>`,
    `<rect x="368" y="430" width="1" height="60" fill="${t.statBorder}"/>`,

    `<text x="109" y="451" font-family="monospace" font-size="7" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">DATE ISSUED</text>`,
    `<text x="109" y="471" font-family="Georgia,serif" font-size="13.5" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">${dateStr}</text>`,

    `<text x="282" y="451" font-family="monospace" font-size="7" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">AGENT ID</text>`,
    `<text x="282" y="471" font-family="Georgia,serif" font-size="13.5" font-weight="bold" fill="${t.bodyText}" text-anchor="middle">#${agentId}</text>`,

    `<text x="452" y="451" font-family="monospace" font-size="7" font-weight="bold" fill="${t.accent}" text-anchor="middle" letter-spacing="2">TX HASH</text>`,
    `<text x="452" y="471" font-family="monospace" font-size="10" fill="${t.bodyText}" text-anchor="middle">${uid}</text>`,

    // Footer rule + provenance
    `<rect x="22" y="503" width="516" height="1" fill="${t.statBorder}"/>`,
    `<text x="22" y="521" font-family="monospace" font-size="8" font-weight="bold" fill="${t.accent}" letter-spacing="2">CRYPTOGRAPHICALLY VERIFIED &#183; ONCHAIN &#183; IMMUTABLE</text>`,
    `<text x="538" y="514" font-family="monospace" font-size="7" fill="${t.accentDim}" text-anchor="end" opacity="0.6">EAS Attestation</text>`,
    `<text x="538" y="525" font-family="monospace" font-size="7" fill="${t.accentDim}" text-anchor="end" opacity="0.6">basescan.org</text>`,

    // Band + sealer mark
    `<rect x="0" y="500" width="560" height="30" fill="${t.bandBg}"/>`,
    `<rect x="0" y="500" width="560" height="1" fill="${t.statBorder}"/>`,
    `<text x="22" y="520" font-family="monospace" font-size="7.5" fill="${t.bandText}" opacity="0.3" letter-spacing="2">THESEALER.XYZ</text>`,
    `<image href="${mark}" x="530" y="505" width="22" height="22" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>`,

    `</svg>`,
  ].join('\n');

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}