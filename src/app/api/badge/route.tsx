// src/app/api/badge/route.tsx
// Achievement Badge — short certificate version.
// 240×248px. Wax seal centred. Claim-type colour accent.
// Provenance: attestation UID · agent ID · date issued.
import { NextRequest, NextResponse } from 'next/server';
import { BADGE_SEAL, MARK_WHITE, MARK_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const CLAIM_META: Record<string, { label: string; color: string }> = {
  x402_payment_reliability: { label: 'Payment Reliability', color: '#0891B2' },
  code_software_delivery:   { label: 'Software Delivery',   color: '#059669' },
  website_app_delivery:     { label: 'Website / App',       color: '#7C3AED' },
  defi_trading_performance: { label: 'DeFi Trading',        color: '#D97706' },
  social_media_growth:      { label: 'Social Growth',       color: '#EA580C' },
};

const THEMES: Record<string, {
  bg: string; headerBg: string; headerText: string;
  accent: string; accentDim: string;
  bodyText: string; bodyTextDim: string;
  statBg: string; statBorder: string;
  border: string; dark: boolean;
}> = {
  'circuit-anim': { bg:'#081420', headerBg:'#04090f', headerText:'#00e5ff', accent:'#00e5ff', accentDim:'#1a5060', bodyText:'#d0eef5', bodyTextDim:'#7ab8cc', statBg:'#0a1f32', statBorder:'#0d3545', border:'#0d3040', dark:true },
  'circuit':      { bg:'#08121e', headerBg:'#030a12', headerText:'#00bcd4', accent:'#00bcd4', accentDim:'#0d3a42', bodyText:'#cce8ee', bodyTextDim:'#5a9aa8', statBg:'#091c2a', statBorder:'#0d3040', border:'#0d3040', dark:true },
  'parchment':    { bg:'#f5f0e8', headerBg:'#8b1a1a', headerText:'#ffffff', accent:'#8b1a1a', accentDim:'#6b3a1a', bodyText:'#0d0a07', bodyTextDim:'#3a2a2a', statBg:'#ede6d4', statBorder:'#c9b882', border:'#c9b882', dark:false },
  'aurora':       { bg:'#080c1a', headerBg:'#04030e', headerText:'#a78bfa', accent:'#a78bfa', accentDim:'#7060a0', bodyText:'#ddd6fe', bodyTextDim:'#7060a0', statBg:'#0a081c', statBorder:'#201840', border:'#201840', dark:true },
  'base':         { bg:'#e8f0fe', headerBg:'#1a56db', headerText:'#ffffff', accent:'#1a56db', accentDim:'#93b4f5', bodyText:'#0d1b2a', bodyTextDim:'#3a5080', statBg:'#d0e0fc', statBorder:'#93b4f5', border:'#93b4f5', dark:false },
  'gold':         { bg:'#0e0b06', headerBg:'#070503', headerText:'#d4af37', accent:'#d4af37', accentDim:'#a08828', bodyText:'#e8ddc0', bodyTextDim:'#8a7a50', statBg:'#120e07', statBorder:'#2a2010', border:'#2a2010', dark:true },
  'silver':       { bg:'#0c0c10', headerBg:'#070709', headerText:'#c0c8d8', accent:'#c0c8d8', accentDim:'#8090a8', bodyText:'#e0e8f0', bodyTextDim:'#6070a0', statBg:'#101018', statBorder:'#2a3040', border:'#2a3040', dark:true },
  'bronze':       { bg:'#0e0803', headerBg:'#080400', headerText:'#cd7f32', accent:'#cd7f32', accentDim:'#8a5520', bodyText:'#e8d0b0', bodyTextDim:'#806040', statBg:'#120a04', statBorder:'#2a1808', border:'#2a1808', dark:true },
  'bitcoin':      { bg:'#f7931a', headerBg:'#c97a10', headerText:'#ffffff', accent:'#ffffff', accentDim:'rgba(255,255,255,0.5)', bodyText:'#1a0800', bodyTextDim:'#5a3010', statBg:'rgba(0,0,0,0.15)', statBorder:'rgba(255,255,255,0.2)', border:'rgba(255,255,255,0.3)', dark:false },
};

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}

function decoration(themeKey: string, t: typeof THEMES[string]): string {
  const isCircuit  = themeKey === 'circuit-anim' || themeKey === 'circuit';
  const traceColor = themeKey === 'circuit-anim' ? '#00e5ff' : '#00bcd4';
  const traceOp    = themeKey === 'circuit-anim' ? '0.22' : '0.13';

  if (isCircuit) return `
    <g stroke="${traceColor}" stroke-width="0.7" fill="none" opacity="${traceOp}">
      <polyline points="0,44 16,44 24,52 24,88"/>
      <polyline points="240,44 224,44 216,52 216,88"/>
      <polyline points="0,172 16,172 24,164 24,140"/>
      <polyline points="240,172 224,172 216,164 216,140"/>
    </g>
    <g fill="${traceColor}" opacity="0.45">
      <circle cx="24" cy="88" r="2.5"/><circle cx="216" cy="88" r="2.5"/>
      <circle cx="24" cy="140" r="2.5"/><circle cx="216" cy="140" r="2.5"/>
    </g>`;

  if (themeKey === 'gold') return `
    <polygon points="120,38 198,114 120,190 42,114"
      stroke="${t.accent}" stroke-width="0.6" fill="none" opacity="0.07"/>
    <polygon points="120,62 176,114 120,166 64,114"
      stroke="${t.accent}" stroke-width="0.3" fill="none" opacity="0.04"/>`;

  if (themeKey === 'silver') {
    const hex = (cx: number, cy: number, r: number) => {
      const pts = Array.from({length:6},(_,i) => {
        const a = Math.PI/180*(60*i-30);
        return `${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      return `<polygon points="${pts}" stroke="${t.accent}" stroke-width="0.5" fill="none" opacity="0.08"/>`;
    };
    return hex(26,90,20)+hex(50,90,20)+hex(190,90,20)+hex(214,90,20);
  }

  if (themeKey === 'bronze') return `
    <g fill="${t.accent}" opacity="0.022">
      <circle cx="26" cy="95" r="34"/><circle cx="214" cy="130" r="28"/>
    </g>`;

  if (themeKey === 'parchment') return `
    <g stroke="#c9b882" stroke-width="0.4" opacity="0.3">
      <line x1="8" y1="44" x2="232" y2="44"/>
      <line x1="8" y1="208" x2="232" y2="208"/>
    </g>`;

  if (themeKey === 'aurora') return `
    <radialGradient id="ag" cx="50%" cy="45%" r="50%">
      <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
    </radialGradient>
    <ellipse cx="120" cy="114" rx="88" ry="76" fill="url(#ag)"/>`;

  if (themeKey === 'base') return `
    <g stroke="${t.accent}" stroke-width="0.22" opacity="0.1">
      ${[60,120,180].map(x=>`<line x1="${x}" y1="44" x2="${x}" y2="208"/>`).join('')}
      ${[80,115,150,185].map(y=>`<line x1="8" y1="${y}" x2="232" y2="${y}"/>`).join('')}
    </g>
    <rect x="0" y="44" width="3" height="164" fill="${t.accent}" opacity="0.35"/>`;

  if (themeKey === 'bitcoin') return `
    <g font-family="Arial,sans-serif" font-weight="bold" fill="white" opacity="0.08">
      <text x="6"   y="98"  font-size="44" transform="rotate(-15,6,98)">&#x20BF;</text>
      <text x="172" y="80"  font-size="36" transform="rotate(-15,172,80)">&#x20BF;</text>
      <text x="82"  y="195" font-size="30" transform="rotate(-15,82,195)">&#x20BF;</text>
    </g>`;

  return '';
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  let themeKey: string;
  let achievement: string;
  let chain: string;
  let txHash: string;
  let agentId: string;
  let claimType: string;
  let attestationUid: string;

  const uid_param = searchParams.get('uid');
  if (uid_param) {
    const { fetchAttestation, fetchAttestationByTx } = await import('@/lib/eas');
    const data = await fetchAttestation(uid_param) || await fetchAttestationByTx(uid_param);
    if (!data) return new NextResponse('Attestation not found', { status: 404 });
    themeKey      = searchParams.get('theme') || 'circuit-anim';
    achievement   = truncate(esc(data.statement), 52);
    chain         = searchParams.get('chain') || 'Base';
    txHash        = data.txHash;
    agentId       = data.recipient.slice(0, 8);
    claimType     = data.claimType || '';
    attestationUid = uid_param;
  } else {
    themeKey      = searchParams.get('theme') || 'circuit-anim';
    achievement   = truncate(esc(searchParams.get('statement') || searchParams.get('achievement') || 'Verified Achievement'), 52);
    chain         = esc(searchParams.get('chain') || 'Base');
    txHash        = searchParams.get('txHash') || '';
    const rawId   = searchParams.get('agentId') || '????';
    agentId       = esc(rawId.startsWith('0x') ? rawId.slice(0, 8) : rawId);
    claimType     = searchParams.get('claimType') || '';
    attestationUid = searchParams.get('attestationUid') || txHash;
  }

  // Display UID — prefer attestation UID, fall back to TX hash
  const displayUid = attestationUid
    ? '0x' + attestationUid.replace('0x','').slice(0,4) + '\u2026' + attestationUid.slice(-4)
    : txHash
      ? '0x' + txHash.slice(2,4) + '\u2026' + txHash.slice(-4)
      : '0x????\u2026????';

  const t          = THEMES[themeKey] ?? THEMES['circuit-anim'];
  const mark       = t.dark ? MARK_WHITE : MARK_BLACK;
  const claimMeta  = CLAIM_META[claimType];
  // Claim colour — falls back to theme accent so unset claimType still looks fine
  // On bitcoin theme the bg is orange — use white for pill text/border to stay readable
  const rawClaimColor = claimMeta?.color ?? t.accent;
  const claimColor    = themeKey === 'bitcoin' ? 'rgba(255,255,255,0.85)' : rawClaimColor;
  const claimLabel    = claimMeta ? claimMeta.label.toUpperCase() : 'ACHIEVEMENT';
  const dateStr    = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });

  const deco = decoration(themeKey, t);
  const W = 240, H = 248;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bc"><rect width="${W}" height="${H}" rx="12" ry="12"/></clipPath>
  </defs>

  <!-- Base — outer border + inner accent line for depth -->
  <rect width="${W}" height="${H}" rx="12" ry="12" fill="${t.bg}" stroke="${t.border}" stroke-width="2"/>
  <rect x="2.5" y="2.5" width="${W-5}" height="${H-5}" rx="10" ry="10" fill="none" stroke="${t.accent}" stroke-width="0.5" opacity="0.25"/>
  <g clip-path="url(#bc)">${deco}</g>

  <!-- Header band -->
  <rect x="0" y="0" width="${W}" height="36" rx="12" ry="12" fill="${t.headerBg}"/>
  <rect x="0" y="24" width="${W}" height="12" fill="${t.headerBg}"/>
  <image href="${mark}" x="12" y="9" width="18" height="18"
    preserveAspectRatio="xMidYMid meet" opacity="0.9"/>
  <text x="132" y="22" font-family="monospace" font-size="7" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle" letter-spacing="1.5">THE SEALER · ACHIEVEMENT BADGE</text>

  <!-- Claim-type colour line — thin rule, full width, sits just below header -->
  <rect x="0" y="36" width="${W}" height="2.5" fill="${claimColor}" opacity="0.7"/>

  <!-- Claim type pill -->
  <rect x="44" y="44" width="152" height="15" rx="7.5"
    fill="${claimColor}" opacity="0.12"/>
  <rect x="44" y="44" width="152" height="15" rx="7.5"
    fill="none" stroke="${claimColor}" stroke-width="0.8" opacity="0.5"/>
  <text x="120" y="55.5" font-family="monospace" font-size="6.5" font-weight="bold"
    fill="${claimColor}" text-anchor="middle" letter-spacing="1.5">${claimLabel}</text>

  <!-- Wax seal — nested svg enforces square viewport, prevents stretch -->
  <svg x="76" y="72" width="88" height="88" viewBox="0 0 88 88">
    <image href="${BADGE_SEAL}" x="0" y="0" width="88" height="88"
      preserveAspectRatio="xMidYMid meet"/>
  </svg>

  <!-- Achievement text -->
  <text x="120" y="172" font-family="Georgia,serif" font-size="9.5" font-style="italic"
    fill="${t.bodyText}" text-anchor="middle" opacity="0.88">${achievement}</text>

  <!-- Thin separator -->
  <line x1="20" y1="182" x2="220" y2="182"
    stroke="${claimColor}" stroke-width="0.5" opacity="0.3"/>

  <!-- Stats bar -->
  <rect x="8" y="190" width="224" height="36" rx="4"
    fill="${t.statBg}" stroke="${t.statBorder}" stroke-width="0.8"/>
  <line x1="88"  y1="193" x2="88"  y2="223" stroke="${t.statBorder}" stroke-width="0.6"/>
  <line x1="164" y1="193" x2="164" y2="223" stroke="${t.statBorder}" stroke-width="0.6"/>

  <!-- Col 1: Attestation UID -->
  <text x="48" y="201" font-family="monospace" font-size="5" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle" letter-spacing="0.5" opacity="0.6">EAS UID</text>
  <text x="48" y="213" font-family="monospace" font-size="6" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle">${displayUid}</text>

  <!-- Col 2: Agent ID -->
  <text x="126" y="201" font-family="monospace" font-size="5" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle" letter-spacing="0.5" opacity="0.6">AGENT</text>
  <text x="126" y="213" font-family="monospace" font-size="6.5" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle">#${agentId}</text>

  <!-- Col 3: Date + chain -->
  <text x="202" y="201" font-family="monospace" font-size="5" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle" letter-spacing="0.5" opacity="0.6">${chain} · EAS</text>
  <text x="202" y="213" font-family="monospace" font-size="5.5"
    fill="${t.headerText}" text-anchor="middle">${dateStr}</text>

  <!-- Footer provenance line -->
  <text x="120" y="237" font-family="monospace" font-size="5" font-weight="bold"
    fill="${t.headerText}" text-anchor="middle" letter-spacing="1" opacity="0.55">
    CRYPTOGRAPHICALLY VERIFIED · ONCHAIN · IMMUTABLE
  </text>

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}