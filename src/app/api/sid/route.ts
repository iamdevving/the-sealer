// src/app/api/sid/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://thesealer.xyz';
const LOGO_URL       = `${BASE_URL}/logo-small.png`;
const STAMP_DARK_URL = `${BASE_URL}/assets/stamp-blue.png`;
const STAMP_LITE_URL = `${BASE_URL}/assets/stamp-committed.png`;

const W = 428, H = 620, PAD = 20, HDR_H = 82;
const PHOTO_W = 110, PHOTO_H = 134;
const PHOTO_X = PAD, PHOTO_Y = HDR_H + PAD;
const FX_BASE = PHOTO_X + PHOTO_W + 28;
const DIV1_Y = 300;
const DIV2_Y = 420;
const MRZ_Y = 548;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '&#x2026;' : s;
}
function truncAddr(a: string) {
  if (!a || a === '????') return '&#x2014;';
  return a.slice(0, 6) + '&#xB7;&#xB7;&#xB7;' + a.slice(-4);
}
function padMRZ(s: string, len: number) {
  return s.replace(/[^A-Z0-9]/g, '<').toUpperCase().padEnd(len, '<').slice(0, len);
}
function makeSerial(id: string, yr: string) {
  const f = id.startsWith('0x') ? id.slice(2, 6).toUpperCase() : '????';
  return 'SID-' + yr + '-' + f;
}
function pill(label: string, bg: string, br: string, col: string, w: number): string {
  return '<rect width="' + w + '" height="16" rx="8" fill="' + bg + '" opacity="0.18"/>' +
    '<rect width="' + w + '" height="16" rx="8" fill="none" stroke="' + br + '" stroke-width="0.8" opacity="0.6"/>' +
    '<text x="' + (w / 2) + '" y="11.5" font-family="monospace" font-size="7" fill="' + col + '" text-anchor="middle" letter-spacing="0.8">' + label + '</text>';
}
function buildStamp(isDark: boolean): string {
  const url = isDark ? STAMP_DARK_URL : STAMP_LITE_URL;
  return '<image href="' + url + '" x="-55" y="-55" width="110" height="110" preserveAspectRatio="xMidYMid meet" opacity="0.9"/>';
}

type Theme = { BG: string; HDR: string; INK: string; INK_DIM: string; INK_FAINT: string; MRZ_BG: string; ACCENT: string; STAMP: string; ACCENT2: string; };
const THEMES: Record<string, Theme> = {
  dark:  { BG: '#0d1117', HDR: '#0a0f1e', INK: '#c8d8f0', INK_DIM: '#5a7090', INK_FAINT: '#1e2d4a', MRZ_BG: '#070c14', ACCENT: '#3b82f6', STAMP: '#2a4a8a', ACCENT2: '#60a5fa' },
  light: { BG: '#f5f0e8', HDR: '#1a1f3a', INK: '#1a1f3a', INK_DIM: '#6b7280', INK_FAINT: '#d4c9a8', MRZ_BG: '#e8e0cc', ACCENT: '#2563eb', STAMP: '#1a2a6a', ACCENT2: '#374151' },
};

export async function GET(req: NextRequest) {
  const p          = new URL(req.url).searchParams;
  const agentId    = esc(p.get('agentId')    || '????');
  const name       = esc(p.get('name')       || 'UNNAMED AGENT');
  const owner      = esc(p.get('owner')      || '');
  const chain      = esc(p.get('chain')      || 'Base');
  const entityType = esc(p.get('entityType') || 'UNKNOWN');
  const firstSeen  = esc(p.get('firstSeen')  || '-');
  const imageUrl   = p.get('imageUrl') || '';
  const llm        = esc(p.get('llm')  || '');
  const socials    = (p.get('social') || '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 4);
  const tags       = (p.get('tags')   || '').split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 6);
  const themeName  = p.get('theme') === 'light' ? 'light' : 'dark';
  const isDark     = themeName === 'dark';
  const year       = new Date().getFullYear().toString();
  const issueDate  = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const ser        = makeSerial(agentId, year);
  const T          = THEMES[themeName];
  const ENTITY_LBL = entityType === 'AI_AGENT' ? 'AI AGENT' : entityType === 'HUMAN' ? 'HUMAN' : 'UNKNOWN';
  const eAccent    = entityType === 'AI_AGENT' ? T.ACCENT : entityType === 'HUMAN' ? '#9ca3af' : '#f59e0b';
  const FX         = FX_BASE;

  const solanaLogo = '<g transform="scale(0.18) translate(-50 -44)"><path d="M100.48 69.38L83.81 86.8c-.36.38-.8.68-1.29.89-.49.21-1.01.31-1.54.31H1.94c-.38 0-.75-.11-1.06-.31-.32-.2-.56-.49-.71-.83-.15-.34-.18-.71-.11-1.07.06-.36.23-.7.48-.97L17.21 67.41c.36-.38.8-.68 1.29-.89.49-.21 1.01-.31 1.54-.31h79.03c.38 0 .75.11 1.06.31.32.2.56.49.71.83.15.34.18.71.11 1.07-.06.36-.23.7-.48.97zM83.81 34.3c-.36-.38-.8-.68-1.29-.89-.49-.21-1.01-.31-1.54-.31H1.94c-.38 0-.75.11-1.06.31-.32.2-.56.49-.71.83-.15.34-.18.71-.11 1.07.06.36.23.7.48.97l16.69 17.42c.36.38.8.68 1.29.89.49.21 1.01.31 1.54.31h79.03c.38 0 .75-.11 1.06-.31.32-.2.56-.49.71-.83.15-.34.18-.71.11-1.07-.06-.36-.23-.7-.48-.97L83.81 34.3zM1.94 21.79h79.03c.53 0 1.05-.11 1.54-.31.49-.21.93-.51 1.29-.89L100.48 3.17c.26-.27.43-.61.49-.97.06-.36.02-.73-.11-1.07-.15-.34-.39-.62-.71-.83C99.82.11 99.44 0 99.06 0H20.03c-.53 0-1.05.11-1.54.31-.49.21-.93.51-1.29.89L.52 18.62c-.26.27-.43.61-.49.97-.06.36-.02.73.11 1.07.15.34.39.62.71.83.32.2.69.31 1.09.31z" fill="url(#solGradID)"/><defs><linearGradient id="solGradID" x1="8.5" y1="90" x2="89" y2="-3" gradientUnits="userSpaceOnUse"><stop offset="0.08" stop-color="#9945FF"/><stop offset="0.5" stop-color="#5497D5"/><stop offset="0.97" stop-color="#19FB9B"/></linearGradient></defs></g>';
  const baseLogo   = '<g transform="scale(0.18) translate(-50 -44)"><rect width="111" height="111" rx="20" fill="#0052FF"/><path d="M55.5 24C38.1 24 24 38.1 24 55.5S38.1 87 55.5 87c16 0 29.2-11.7 31.1-27.2H64v9.3h-8.4V55.5h31.6C87.1 38.7 73 24 55.5 24z" fill="white"/></g>';
  const chainLogo  = chain === 'Solana' ? solanaLogo : baseLogo;

  let photoData = '';
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buf  = await res.arrayBuffer();
        const b64i = Buffer.from(buf).toString('base64');
        const mime = res.headers.get('content-type') || 'image/png';
        photoData  = 'data:' + mime + ';base64,' + b64i;
      }
    } catch { /* no photo */ }
  }

  const photoSVG = photoData
    ? '<image href="' + photoData + '" x="' + PHOTO_X + '" y="' + PHOTO_Y + '" width="' + PHOTO_W + '" height="' + PHOTO_H + '" clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice"/>'
    : '<rect x="' + PHOTO_X + '" y="' + PHOTO_Y + '" width="' + PHOTO_W + '" height="' + PHOTO_H + '" rx="4" fill="' + T.INK_FAINT + '"/>'
      + '<image href="' + LOGO_URL + '" x="' + (PHOTO_X + 25) + '" y="' + (PHOTO_Y + 30) + '" width="60" height="60" opacity="0.15" preserveAspectRatio="xMidYMid meet"/>';

  const fl = (t: string, y: number) =>
    '<text x="' + FX + '" y="' + y + '" font-family="monospace" font-size="6" fill="' + T.INK_DIM + '" letter-spacing="1.5">' + t + '</text>';
  const fv = (t: string, y: number, sz = 9) =>
    '<text x="' + FX + '" y="' + y + '" font-family="monospace" font-size="' + sz + '" fill="' + T.INK + '" letter-spacing="0.5">' + t + '</text>';

  let sec2 = '';
  let px = PAD, py = DIV1_Y + 16;
  if (socials.length > 0) {
    sec2 += '<text x="' + PAD + '" y="' + py + '" font-family="monospace" font-size="6" fill="' + T.INK_DIM + '" letter-spacing="1.5">SOCIAL</text>';
    py += 14;
    for (const s of socials) {
      const w = Math.min(Math.max(s.length * 7 + 16, 64), 130);
      if (px + w > W - PAD) { px = PAD; py += 22; }
      sec2 += '<g transform="translate(' + px + ',' + py + ')">' + pill(trunc(s, 16), T.ACCENT, T.ACCENT, T.ACCENT, w) + '</g>';
      px += w + 8;
    }
    px = PAD; py += 26;
  }
  if (tags.length > 0) {
    sec2 += '<text x="' + PAD + '" y="' + py + '" font-family="monospace" font-size="6" fill="' + T.INK_DIM + '" letter-spacing="1.5">SPECIALIZATION</text>';
    py += 14;
    for (const t of tags) {
      const w = Math.min(Math.max(t.length * 7 + 16, 64), 120);
      if (px + w > W - PAD) { px = PAD; py += 22; }
      sec2 += '<g transform="translate(' + px + ',' + py + ')">' + pill(trunc(t, 14), '#14b8a6', '#14b8a6', '#14b8a6', w) + '</g>';
      px += w + 8;
    }
    px = PAD; py += 26;
  }
  if (llm) {
    sec2 += '<text x="' + PAD + '" y="' + py + '" font-family="monospace" font-size="6" fill="' + T.INK_DIM + '" letter-spacing="1.5">PREFERRED MODEL</text>';
    py += 14;
    const w = Math.min(Math.max(llm.length * 7 + 16, 80), 180);
    sec2 += '<g transform="translate(' + PAD + ',' + py + ')">' + pill(trunc(llm, 22), '#a855f7', '#a855f7', '#a855f7', w) + '</g>';
  }

  const stamp  = buildStamp(isDark);
  const mrzL1  = ('AGENT<' + padMRZ(name.replace(/ /g, '<'), 19) + '<<<<<<<<<<<<<<<<<<<<').slice(0, 44);
  const mrzL2  = (padMRZ(agentId.replace('0x', ''), 20) + '<<' + padMRZ(chain, 5) + '<' + padMRZ(entityType.replace('_', ''), 8) + '<' + year + '<<').slice(0, 44);
  const safeMrzL1 = mrzL1.replace(/</g, '&lt;');
  const safeMrzL2 = mrzL2.replace(/</g, '&lt;');

  const guil = '<pattern id="guil" x="0" y="0" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 Q10 0 20 10 Q30 20 40 10" fill="none" stroke="' + T.INK_FAINT + '" stroke-width="0.5"/><path d="M0 16 Q10 6 20 16 Q30 26 40 16" fill="none" stroke="' + T.INK_FAINT + '" stroke-width="0.25" opacity="0.5"/></pattern>';

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs>' + guil +
    '<clipPath id="photoClip"><rect x="' + PHOTO_X + '" y="' + PHOTO_Y + '" width="' + PHOTO_W + '" height="' + PHOTO_H + '" rx="4"/></clipPath>' +
    '<clipPath id="cardClip"><rect x="0" y="0" width="' + W + '" height="' + H + '" rx="12"/></clipPath>' +
    '</defs>' +
    '<g clip-path="url(#cardClip)">' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + T.BG + '"/>' +
    '<rect x="0" y="' + HDR_H + '" width="' + W + '" height="' + (H - HDR_H) + '" fill="url(#guil)" opacity="0.5"/>' +
    '<rect x="0" y="0" width="' + W + '" height="' + HDR_H + '" fill="' + T.HDR + '"/>' +
    '<rect x="0" y="0" width="' + W + '" height="' + HDR_H + '" fill="url(#guil)" opacity="0.12"/>' +
    '<image href="' + LOGO_URL + '" x="' + (PAD + 2) + '" y="8" width="24" height="24" opacity="0.85" preserveAspectRatio="xMidYMid meet"/>' +
    '<text x="' + (PAD + 20) + '" y="21" font-family="monospace" font-size="7" fill="#fff" opacity="0.6" letter-spacing="1.2">THE SEALER PROTOCOL &#xB7; ONCHAIN IDENTITY REGISTRY</text>' +
    '<text x="' + (W - PAD) + '" y="21" font-family="monospace" font-size="6" fill="#fff" opacity="0.35" text-anchor="end" letter-spacing="1">ISSUED ' + issueDate + '</text>' +
    '<text x="' + PAD + '" y="54" font-family="Georgia, serif" font-size="24" fill="#fff" letter-spacing="3">SEALER ID</text>' +
    '<g transform="translate(' + (W - PAD - 10) + ', 43)">' + chainLogo + '</g>' +
    '<text x="' + PAD + '" y="70" font-family="monospace" font-size="6.5" fill="#fff" opacity="0.3" letter-spacing="2">AGENT IDENTITY DOCUMENT &#xB7; ERC-8004</text>' +
    '<rect x="0" y="' + HDR_H + '" width="' + W + '" height="2.5" fill="' + T.ACCENT + '" opacity="0.9"/>' +
    photoSVG +
    '<rect x="' + PHOTO_X + '" y="' + PHOTO_Y + '" width="' + PHOTO_W + '" height="' + PHOTO_H + '" rx="4" fill="none" stroke="' + T.INK_FAINT + '" stroke-width="0.8"/>' +
    '<rect x="' + PHOTO_X + '" y="' + (PHOTO_Y + PHOTO_H + 6) + '" width="' + PHOTO_W + '" height="18" rx="3" fill="' + eAccent + '" opacity="0.12"/>' +
    '<rect x="' + PHOTO_X + '" y="' + (PHOTO_Y + PHOTO_H + 6) + '" width="' + PHOTO_W + '" height="18" rx="3" fill="none" stroke="' + eAccent + '" stroke-width="0.8" opacity="0.5"/>' +
    '<text x="' + (PHOTO_X + PHOTO_W / 2) + '" y="' + (PHOTO_Y + PHOTO_H + 19) + '" font-family="monospace" font-size="7.5" fill="' + eAccent + '" text-anchor="middle" letter-spacing="2">' + ENTITY_LBL + '</text>' +
    fl('NAME', PHOTO_Y + 14) +
    '<text x="' + FX + '" y="' + (PHOTO_Y + 27) + '" font-family="Georgia, serif" font-size="13" fill="' + T.INK + '">' + trunc(name, 18) + '</text>' +
    fl('AGENT ID', PHOTO_Y + 47) +
    fv(truncAddr(agentId), PHOTO_Y + 60) +
    fl('OWNER', PHOTO_Y + 78) +
    fv(owner ? truncAddr(owner) : '&#x2014;', PHOTO_Y + 91) +
    fl('PRIMARY CHAIN', PHOTO_Y + 109) +
    fv(chain.toUpperCase(), PHOTO_Y + 121) +
    fl('FIRST SEEN', PHOTO_Y + 139) +
    fv(firstSeen, PHOTO_Y + 152) +
    '<rect x="0" y="' + DIV1_Y + '" width="' + W + '" height="1" fill="' + T.INK_FAINT + '" opacity="0.6"/>' +
    sec2 +
    '<text x="' + (W - PAD) + '" y="' + (DIV2_Y + 8) + '" font-family="monospace" font-size="9" fill="' + T.ACCENT + '" text-anchor="end" letter-spacing="2">' + ser + '</text>' +
    '<g transform="translate(' + (W - PAD - 60) + ',' + (DIV2_Y + 67) + ') rotate(-12)">' + stamp + '</g>' +
    '<rect x="0" y="' + MRZ_Y + '" width="' + W + '" height="' + (H - MRZ_Y) + '" fill="' + T.MRZ_BG + '"/>' +
    '<line x1="0" y1="' + MRZ_Y + '" x2="' + W + '" y2="' + MRZ_Y + '" stroke="' + T.INK_FAINT + '" stroke-width="0.8"/>' +
    '<text x="' + PAD + '" y="' + (MRZ_Y + 13) + '" font-family="monospace" font-size="5.5" fill="' + T.INK_DIM + '" letter-spacing="1">MACHINE READABLE ZONE</text>' +
    '<text x="' + PAD + '" y="' + (MRZ_Y + 32) + '" font-family="monospace" font-size="9" fill="' + T.INK + '" letter-spacing="1.8">' + safeMrzL1 + '</text>' +
    '<text x="' + PAD + '" y="' + (MRZ_Y + 50) + '" font-family="monospace" font-size="9" fill="' + T.INK + '" letter-spacing="1.8">' + safeMrzL2 + '</text>' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="12" fill="none" stroke="' + T.INK_FAINT + '" stroke-width="1"/>' +
    '</g>' +
    '</svg>';

  return new NextResponse(svg, {
    headers: {
      'Content-Type':  'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}