// src/app/api/card/route.tsx
import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE, MARK_BLACK, STAMP_STATEMENT_WHITE, STAMP_STATEMENT_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const THEMES: Record<string, {
  bg: string; headerBg: string; headerText: string;
  accent: string; accentDim: string;
  bodyText: string; bodyTextDim: string;
  statBg: string; statBorder: string;
  bandBg: string; bandText: string;
  border: string; uploadBg: string; dark: boolean;
}> = {
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', bodyText:'#d0eef5', bodyTextDim:'#7ab8cc', statBg:'#0a1f32', statBorder:'#0d3545', bandBg:'#03070d', bandText:'#00e5ff', border:'#0d3040', uploadBg:'#04090f', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', bodyText:'#cce8ee', bodyTextDim:'#5a9aa8', statBg:'#091c2a', statBorder:'#0d3040', bandBg:'#020608', bandText:'#00bcd4', border:'#0d3040', uploadBg:'#030a12', dark:true },
  'parchment':    { bg:'#f2ead8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#c9b882', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', bandBg:'#f2ead8', bandText:'#8b1a1a', border:'#c9b882', uploadBg:'#ede6d4', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#3a2a70', bodyText:'#ddd6fe', bodyTextDim:'#7060a0', statBg:'#0a081c', statBorder:'#201840', bandBg:'#04030c', bandText:'#a78bfa', border:'#201840', uploadBg:'#04030e', dark:true },
  'base':         { bg:'#eef2ff', headerBg:'#0052ff', headerText:'#ffffff', accent:'#0052ff', accentDim:'#4d88ff', bodyText:'#0a1a3a', bodyTextDim:'#2a4a8a', statBg:'#dde6ff', statBorder:'#b0c8ff', bandBg:'#0042cc', bandText:'#ffffff', border:'#b0c8ff', uploadBg:'#e4ecff', dark:false },
  'gold':         { bg:'#0d0a04', headerBg:'#1a1200', headerText:'#d4af37', accent:'#d4af37', accentDim:'#8b6914', bodyText:'#f0e0a0', bodyTextDim:'#a08020', statBg:'#140f03', statBorder:'#3a2a08', bandBg:'#0a0800', bandText:'#d4af37', border:'#3a2a08', uploadBg:'#100c02', dark:true },
  'silver':       { bg:'#0a0c10', headerBg:'#0d1018', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#4a5a80', bodyText:'#e8ecf4', bodyTextDim:'#7080a0', statBg:'#0d1018', statBorder:'#2a3448', bandBg:'#080a0e', bandText:'#c0c8d8', border:'#2a3448', uploadBg:'#0d1018', dark:true },
  'bronze':       { bg:'#0c0804', headerBg:'#120a02', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#8b4513', bodyText:'#f0c890', bodyTextDim:'#8b5a20', statBg:'#100a03', statBorder:'#3a1e08', bandBg:'#080502', bandText:'#cd7f32', border:'#3a1e08', uploadBg:'#100a03', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#d4720a', headerText:'#ffffff', accent:'#ffffff', accentDim:'#ffe8c0', bodyText:'#1a0a00', bodyTextDim:'#5a3000', statBg:'#e8820a', statBorder:'#c46000', bandBg:'#b85800', bandText:'#ffffff', border:'#c46000', uploadBg:'#e8820a', dark:true },
};

function truncate(s: string, n: number) { return s.length > n ? s.slice(0,n-1)+'...' : s; }
function formatDate(d: Date) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (test.length > maxChars && cur) { lines.push(cur); if (lines.length >= maxLines) break; cur = word; }
    else { cur = test; }
  }
  if (cur && lines.length < maxLines) lines.push(truncate(cur, maxChars));
  return lines;
}

function parchmentDecor(): string {
  return [
    '<defs>',
    '<radialGradient id="vign" cx="50%" cy="50%" r="70%">',
    '<stop offset="60%" stop-color="transparent"/>',
    '<stop offset="100%" stop-color="#8b6914" stop-opacity="0.12"/>',
    '</radialGradient>',
    '</defs>',
    '<rect x="0" y="55" width="560" height="440" fill="#e8dcc0" opacity="0.25"/>',
    '<rect x="0" y="0" width="560" height="530" fill="url(#vign)"/>',
    '<circle cx="492" cy="105" r="46" stroke="#8b1a1a" stroke-width="1.2" fill="none" opacity="0.06"/>',
    '<circle cx="492" cy="105" r="36" stroke="#8b1a1a" stroke-width="0.6" fill="none" opacity="0.05"/>',
    '<circle cx="492" cy="105" r="26" stroke="#c9b882" stroke-width="0.6" fill="none" opacity="0.07"/>',
    '<g stroke="#c9b882" stroke-width="0.8" fill="none" opacity="0.25">',
    '<path d="M 22,58 Q 22,75 35,78 Q 48,81 52,95"/>',
    '<path d="M 538,58 Q 538,75 525,78 Q 512,81 508,95"/>',
    '<path d="M 22,493 Q 22,476 35,473 Q 48,470 52,456"/>',
    '<path d="M 538,493 Q 538,476 525,473 Q 512,470 508,456"/>',
    '</g>',
    '<line x1="172" y1="58" x2="172" y2="218" stroke="#c9b882" stroke-width="0.5" opacity="0.2"/>',
    '<g stroke="#8b1a1a" stroke-width="0.3" opacity="0.025">',
    '<line x1="0" y1="55" x2="560" y2="495"/>',
    '<line x1="0" y1="200" x2="360" y2="55"/>',
    '<line x1="200" y1="495" x2="560" y2="295"/>',
    '</g>',
  ].join('');
}

function baseDecor(accent: string): string {
  return [
    '<g stroke="'+accent+'" stroke-width="0.25" opacity="0.1">',
    ...[40,80,120,160,200,240,280,320,360,400,440,480,520].map(x => `<line x1="${x}" y1="55" x2="${x}" y2="495"/>`),
    ...[95,135,175,215,255,295,335,375,415,455,495].map(y => `<line x1="22" y1="${y}" x2="538" y2="${y}"/>`),
    '</g>',
    '<g stroke="'+accent+'" stroke-width="0.5" opacity="0.15">',
    '<line x1="160" y1="55" x2="160" y2="495"/>',
    '<line x1="320" y1="55" x2="320" y2="495"/>',
    '<line x1="480" y1="55" x2="480" y2="495"/>',
    '<line x1="22"  y1="215" x2="538" y2="215"/>',
    '<line x1="22"  y1="375" x2="538" y2="375"/>',
    '</g>',
    '<g stroke="'+accent+'" stroke-width="1" opacity="0.3">',
    '<line x1="26" y1="59" x2="38" y2="59"/><line x1="32" y1="53" x2="32" y2="65"/>',
    '<line x1="522" y1="59" x2="534" y2="59"/><line x1="528" y1="53" x2="528" y2="65"/>',
    '<line x1="26" y1="489" x2="38" y2="489"/><line x1="32" y1="483" x2="32" y2="495"/>',
    '<line x1="522" y1="489" x2="534" y2="489"/><line x1="528" y1="483" x2="528" y2="495"/>',
    '</g>',
    '<rect x="0" y="55" width="3" height="440" fill="'+accent+'" opacity="0.4"/>',
    '<circle cx="498" cy="100" r="38" stroke="'+accent+'" stroke-width="1.5" fill="none" opacity="0.07"/>',
    '<circle cx="498" cy="100" r="27" stroke="'+accent+'" stroke-width="0.8" fill="none" opacity="0.05"/>',
  ].join('');
}

function goldDecor(accent: string): string {
  return [
    '<polygon points="280,75 435,225 280,375 125,225" stroke="'+accent+'" stroke-width="0.8" fill="none" opacity="0.07"/>',
    '<polygon points="280,112 392,225 280,338 168,225" stroke="'+accent+'" stroke-width="0.4" fill="none" opacity="0.05"/>',
    '<g stroke="'+accent+'" stroke-width="0.3" opacity="0.06">',
    '<line x1="280" y1="225" x2="22"  y2="58"/>',
    '<line x1="280" y1="225" x2="538" y2="58"/>',
    '<line x1="280" y1="225" x2="22"  y2="225"/>',
    '<line x1="280" y1="225" x2="538" y2="225"/>',
    '</g>',
  ].join('');
}

function silverDecor(accent: string): string {
  const hex = (cx: number, cy: number, r: number) => {
    const pts = Array.from({length:6},(_,i) => {
      const a = Math.PI/180*(60*i-30);
      return `${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    return `<polygon points="${pts}" stroke="${accent}" stroke-width="0.5" fill="none" opacity="0.08"/>`;
  };
  return [hex(50,90,28), hex(90,90,28), hex(70,114,28), hex(470,90,28), hex(510,90,28), hex(490,114,28)].join('');
}

function bronzeDecor(accent: string): string {
  return [
    '<g fill="'+accent+'" opacity="0.025">',
    '<circle cx="75"  cy="130" r="40"/><circle cx="485" cy="170" r="32"/>',
    '<circle cx="55"  cy="390" r="45"/><circle cx="505" cy="410" r="35"/>',
    '<circle cx="280" cy="290" r="55"/>',
    '</g>',
    '<g stroke="'+accent+'" stroke-width="0.5" opacity="0.1">',
    '<line x1="22" y1="83"  x2="538" y2="83"/><line x1="22" y1="87"  x2="538" y2="87"/>',
    '<line x1="22" y1="278" x2="538" y2="278"/><line x1="22" y1="282" x2="538" y2="282"/>',
    '<line x1="22" y1="468" x2="538" y2="468"/><line x1="22" y1="472" x2="538" y2="472"/>',
    '</g>',
  ].join('');
}

function bitcoinDecor(accent: string): string {
  return [
    '<g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.12">',
    '<text x="30"  y="130" font-size="55" transform="rotate(-15,30,130)">₿</text>',
    '<text x="130" y="90"  font-size="45" transform="rotate(-15,130,90)">₿</text>',
    '<text x="420" y="110" font-size="60" transform="rotate(-15,420,110)">₿</text>',
    '<text x="500" y="80"  font-size="40" transform="rotate(-15,500,80)">₿</text>',
    '<text x="30"  y="320" font-size="50" transform="rotate(-15,30,320)">₿</text>',
    '<text x="480" y="350" font-size="55" transform="rotate(-15,480,350)">₿</text>',
    '</g>',
    '<g fill="white" opacity="0.15">',
    ...[200,235,270,305,340,375,410,445,480,515].map(x => `<circle cx="${x}" cy="75" r="3.5"/>`),
    ...[218,253,288,323,358,393,428,463,498].map(x => `<circle cx="${x}" cy="95" r="2.5"/>`),
    '</g>',
    '<g stroke="white" stroke-width="0.8" opacity="0.1">',
    '<line x1="0" y1="180" x2="200" y2="55"/><line x1="0" y1="360" x2="360" y2="55"/>',
    '<line x1="100" y1="495" x2="560" y2="120"/><line x1="300" y1="495" x2="560" y2="310"/>',
    '</g>',
  ].join('');
}

function auroraDecor(accent: string): string {
  return [
    '<g opacity="0.06">',
    '<ellipse cx="100" cy="220" rx="160" ry="280" fill="#7c3aed"/>',
    '<ellipse cx="460" cy="300" rx="140" ry="240" fill="'+accent+'"/>',
    '<ellipse cx="280" cy="130" rx="220" ry="160" fill="#6d28d9"/>',
    '</g>',
    '<g fill="none" opacity="0.1">',
    '<path d="M 0,170 Q 140,130 280,170 Q 420,210 560,170" stroke="'+accent+'" stroke-width="1.2"/>',
    '<path d="M 0,195 Q 140,155 280,195 Q 420,235 560,195" stroke="#c4b5fd" stroke-width="0.8"/>',
    '<path d="M 0,350 Q 140,310 280,350 Q 420,390 560,350" stroke="#7c3aed" stroke-width="1"/>',
    '</g>',
    '<g fill="#c4b5fd">',
    '<circle cx="55"  cy="90"  r="1.5" opacity="0.5"/>',
    '<circle cx="510" cy="120" r="1"   opacity="0.4"/>',
    '<circle cx="330" cy="75"  r="1.5" opacity="0.5"/>',
    '<circle cx="70"  cy="400" r="1"   opacity="0.3"/>',
    '<circle cx="530" cy="380" r="1.5" opacity="0.4"/>',
    '</g>',
  ].join('');
}

function getDecoration(themeKey: string, accent: string): string {
  switch(themeKey) {
    case 'parchment':    return parchmentDecor();
    case 'base':         return baseDecor(accent);
    case 'gold':         return goldDecor(accent);
    case 'silver':       return silverDecor(accent);
    case 'bronze':       return bronzeDecor(accent);
    case 'bitcoin':      return bitcoinDecor(accent);
    case 'aurora':       return auroraDecor(accent);
    case 'circuit-anim':
    case 'circuit': {
      const c  = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
      const op = themeKey === 'circuit-anim' ? '0.3' : '0.18';
      return [
        '<g stroke="'+c+'" stroke-width="0.8" fill="none" opacity="'+op+'">',
        '<polyline points="0,80 50,80 64,94 64,150"/>',
        '<polyline points="0,200 40,200 54,214 54,250"/>',
        '<polyline points="0,330 55,330 55,310 75,310"/>',
        '<polyline points="560,80 510,80 496,94 496,150"/>',
        '<polyline points="560,200 520,200 506,214 506,250"/>',
        '<polyline points="560,330 505,330 491,310 471,310"/>',
        '</g>',
        '<g stroke="'+c+'" stroke-width="1.2" fill="none" opacity="0.45">',
        '<polyline points="14,516 14,490 40,490"/>',
        '<polyline points="546,516 546,490 520,490"/>',
        '</g>',
        '<g fill="'+c+'" opacity="0.6">',
        '<circle cx="64" cy="150" r="3"/><circle cx="54" cy="250" r="2.5"/>',
        '<circle cx="75" cy="310" r="3"/><circle cx="496" cy="150" r="3"/>',
        '<circle cx="506" cy="250" r="2.5"/><circle cx="471" cy="310" r="3"/>',
        '<circle cx="40" cy="490" r="2.5"/><circle cx="520" cy="490" r="2.5"/>',
        '</g>',
      ].join('');
    }
    default: return '';
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  let achievement: string;
  let themeKey: string;
  let agentId: string;
  let txHash: string;
  let chain: string;

  const uid_param = searchParams.get('uid');
  const imageUrl  = searchParams.get('imageUrl') ?? '';

  if (uid_param) {
    const { fetchAttestation, fetchAttestationByTx } = await import('@/lib/eas');
    const data = await fetchAttestation(uid_param) || await fetchAttestationByTx(uid_param);
    if (!data) return new NextResponse('Attestation not found', { status: 404 });
    achievement = truncate(data.statement, 160);
    themeKey    = searchParams.get('theme') || 'circuit-anim';
    agentId     = esc(data.recipient.slice(0,6));
    txHash      = data.txHash;
    chain       = searchParams.get('chain') || 'Base';
  } else {
    achievement = truncate(searchParams.get('statement') || searchParams.get('achievement') || 'Verified Statement', 160);
    themeKey    = searchParams.get('theme') || 'circuit-anim';
    const rawId = searchParams.get('agentId') || '????';
    agentId     = esc(rawId.startsWith('0x') ? rawId.slice(0, 8) : rawId);
    txHash      = searchParams.get('txHash') || '';
    chain       = esc(searchParams.get('chain') || 'Base');
  }

  const t       = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const uid     = txHash ? '0x' + txHash.slice(2,6) + '...' + txHash.slice(-4) : '0x????...????';
  const dateStr = formatDate(new Date());

  const charCount = achievement.length;
  const fontSize  = charCount <= 60  ? 17.5 : charCount <= 100 ? 15.5 : charCount <= 150 ? 13.5 : 12;
  const lineH     = fontSize + 11;
  const maxChars  = charCount <= 60  ? 42 : charCount <= 100 ? 48 : 54;
  const maxLines  = charCount <= 60  ? 3 : 4;
  const lines     = wrapText(esc(achievement), maxChars, maxLines);

  // Use REGISTERED STATEMENT stamp — white on dark themes, black on light themes
  const stamp = t.dark ? STAMP_STATEMENT_WHITE : STAMP_STATEMENT_BLACK;
  // Sealer mark in footer — opposite (white mark on dark, black mark on light)
  const mark  = t.dark ? MARK_WHITE : MARK_BLACK;

  const totalTextH = lines.length * lineH;
  const textStartY = Math.round(262 + (120 - totalTextH) / 2);

  const dashes = Array.from({length:46},(_,i) =>
    `<rect x="${i*12+1}" y="40" width="7" height="1.5" fill="${t.accent}" opacity="0.55"/>`
  ).join('');

  const decoration = getDecoration(themeKey, t.accent);

  const achievementLines = lines.map((line,i) =>
    `<text x="280" y="${textStartY+i*lineH}" font-family="Georgia,serif" font-size="${fontSize}" fill="${t.bodyTextDim}" font-style="italic" text-anchor="middle">${line}</text>`
  ).join('');

  let photoData = '';
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buf  = await res.arrayBuffer();
        const b64i = Buffer.from(buf).toString('base64');
        const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
        photoData  = 'data:' + mime + ';base64,' + b64i;
      }
    } catch { /* no photo */ }
  }

  // Stamp: square rounded badge, top-left corner (where wax seal used to be)
  // REGISTERED STATEMENT is a square stamp — render at 92×92
  const stampImg = `<image href="${stamp}" x="29" y="58" width="92" height="92" preserveAspectRatio="xMidYMid meet"/>`;

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg width="560" height="530" viewBox="0 0 560 530" xmlns="http://www.w3.org/2000/svg">',
    '<defs><clipPath id="cc"><rect width="560" height="530" rx="14" ry="14"/></clipPath>'+
    '<linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="transparent"/><stop offset="50%" stop-color="'+t.accentDim+'"/><stop offset="100%" stop-color="transparent"/></linearGradient></defs>',
    '<rect width="560" height="530" rx="14" ry="14" fill="'+t.bg+'" stroke="'+t.border+'" stroke-width="1"/>',
    '<g clip-path="url(#cc)">'+decoration+'</g>',
    '<rect x="0" y="0" width="560" height="42" rx="14" ry="14" fill="'+t.headerBg+'"/>',
    '<rect x="0" y="28" width="560" height="14" fill="'+t.headerBg+'"/>',
    dashes,
    '<text x="22" y="26" font-family="monospace" font-size="10.5" font-weight="bold" fill="'+t.headerText+'" letter-spacing="2.5">THE SEALER &#183; OFFICIAL CREDENTIAL</text>',
    '<text x="538" y="26" font-family="monospace" font-size="9" fill="'+t.accentDim+'" text-anchor="end">UID: '+uid+'</text>',

    // REGISTERED STATEMENT stamp — top left
    stampImg,
    '<text x="75" y="168" font-family="monospace" font-size="7" font-weight="bold" fill="'+t.accent+'" text-anchor="middle" letter-spacing="2" opacity="0.6">STATEMENT</text>',
    '<rect x="29" y="178" width="92" height="17" rx="8" fill="'+t.statBg+'" stroke="'+t.accent+'" stroke-width="0.8"/>',
    '<text x="75" y="190" font-family="monospace" font-size="7" font-weight="bold" fill="'+t.accent+'" text-anchor="middle">'+chain+' &#183; EAS</text>',

    // Photo/attachment area
    ...(photoData ? [
      '<defs><clipPath id="imgClip"><rect x="148" y="52" width="392" height="164" rx="8"/></clipPath></defs>',
      '<image href="'+photoData+'" x="148" y="52" width="392" height="164" clip-path="url(#imgClip)" preserveAspectRatio="xMidYMid slice"/>',
    ] : [
      '<rect x="148" y="52" width="392" height="164" rx="8" fill="'+t.uploadBg+'" stroke="'+t.accentDim+'" stroke-width="1.2" stroke-dasharray="7,4"/>',
      '<text x="344" y="128" font-family="monospace" font-size="9" fill="'+t.accentDim+'" text-anchor="middle" opacity="0.5">NO ATTACHMENT</text>',
      '<text x="344" y="148" font-family="monospace" font-size="7" fill="'+t.accentDim+'" text-anchor="middle" opacity="0.28">PNL CARD &#183; SCREENSHOT &#183; CHART</text>',
    ]),

    ...(['parchment','base'].includes(themeKey) ? [] : ['<rect x="22" y="228" width="516" height="1" fill="url(#dg)"/>']),
    '<text x="280" y="248" font-family="monospace" font-size="12" font-weight="bold" fill="'+t.accent+'" text-anchor="middle" letter-spacing="5">STATEMENT</text>',
    achievementLines,

    // Stats row
    '<rect x="22" y="392" width="516" height="60" rx="4" fill="'+t.statBg+'" stroke="'+t.statBorder+'" stroke-width="1"/>',
    '<rect x="196" y="392" width="1" height="60" fill="'+t.statBorder+'"/>',
    '<rect x="368" y="392" width="1" height="60" fill="'+t.statBorder+'"/>',
    '<text x="109" y="413" font-family="monospace" font-size="7" font-weight="bold" fill="'+t.accent+'" text-anchor="middle" letter-spacing="2">DATE ISSUED</text>',
    '<text x="109" y="433" font-family="Georgia,serif" font-size="13.5" font-weight="bold" fill="'+t.bodyText+'" text-anchor="middle">'+dateStr+'</text>',
    '<text x="282" y="413" font-family="monospace" font-size="7" font-weight="bold" fill="'+t.accent+'" text-anchor="middle" letter-spacing="2">AGENT ID</text>',
    '<text x="282" y="433" font-family="Georgia,serif" font-size="13.5" font-weight="bold" fill="'+t.bodyText+'" text-anchor="middle">#'+agentId+'</text>',
    '<text x="452" y="413" font-family="monospace" font-size="7" font-weight="bold" fill="'+t.accent+'" text-anchor="middle" letter-spacing="2">TX HASH</text>',
    '<text x="452" y="433" font-family="monospace" font-size="10" fill="'+t.bodyText+'" text-anchor="middle">'+uid+'</text>',

    // Footer
    '<rect x="22" y="465" width="516" height="1" fill="'+t.statBorder+'"/>',
    '<text x="22" y="483" font-family="monospace" font-size="8" font-weight="bold" fill="'+t.accent+'" letter-spacing="2">CRYPTOGRAPHICALLY VERIFIED &#183; ONCHAIN &#183; IMMUTABLE</text>',
    '<text x="538" y="476" font-family="monospace" font-size="7" fill="'+t.accentDim+'" text-anchor="end" opacity="0.6">EAS Attestation</text>',
    '<text x="538" y="487" font-family="monospace" font-size="7" fill="'+t.accentDim+'" text-anchor="end" opacity="0.6">basescan.org</text>',
    '<rect x="0" y="500" width="560" height="30" fill="'+t.bandBg+'"/>',
    '<rect x="0" y="500" width="560" height="1" fill="'+t.statBorder+'"/>',
    '<text x="22" y="520" font-family="monospace" font-size="7.5" fill="'+t.bandText+'" opacity="0.3" letter-spacing="2">THESEALER.XYZ</text>',
    '<image href="'+mark+'" x="530" y="505" width="22" height="22" preserveAspectRatio="xMidYMid meet" opacity="0.65"/>',
    '</svg>',
  ];

  return new NextResponse(parts.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}