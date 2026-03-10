// src/app/api/commitment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { STAMP_COMMITTED, MARK_BLACK } from '@/lib/assets';
export const runtime = 'nodejs';

const THEMES: Record<string, {
  bg: string; pageBg: string; border: string; accent: string; accentDim: string;
  headerBg: string; headerText: string; headerSub: string; bodyText: string;
  bodyTextDim: string; ruleLine: string; metricBg: string; metricBorder: string;
  diffBg: string; diffBorder: string; footerBg: string; dark: boolean;
}> = {
  'parchment': {
    bg: '#d4c5a0', pageBg: '#faf8f2', border: '#ddd0b0', accent: '#c9a84c',
    accentDim: '#9a8050', headerBg: '#2d1f0e', headerText: '#c9a84c',
    headerSub: '#6a5030', bodyText: '#1a1208', bodyTextDim: '#6a5030',
    ruleLine: '#ddd0b0', metricBg: '#f0ebe0', metricBorder: '#ddd0b0',
    diffBg: '#f5f0e4', diffBorder: '#ddd0b0', footerBg: '#f0ebe0', dark: false,
  },
  'circuit-anim': {
    bg: '#04090f', pageBg: '#06111e', border: '#0d3040', accent: '#00e5ff',
    accentDim: '#1a5060', headerBg: '#04090f', headerText: '#00e5ff',
    headerSub: '#1a5060', bodyText: '#d0eef5', bodyTextDim: '#5a9aaa',
    ruleLine: '#0d3545', metricBg: '#04111e', metricBorder: '#0d3040',
    diffBg: '#04111e', diffBorder: '#0d3040', footerBg: '#04090f', dark: true,
  },
  'base': {
    bg: '#0042cc', pageBg: '#fafbff', border: '#c0d0ff', accent: '#0052ff',
    accentDim: '#4d88ff', headerBg: '#0052ff', headerText: '#ffffff',
    headerSub: '#a0c0ff', bodyText: '#0a1a3a', bodyTextDim: '#4a6aaa',
    ruleLine: '#c0d0ff', metricBg: '#f0f4ff', metricBorder: '#c0d0ff',
    diffBg: '#f0f4ff', diffBorder: '#c0d0ff', footerBg: '#e8eeff', dark: false,
  },
  'gold': {
    bg: '#0a0800', pageBg: '#faf8f0', border: '#3a2a08', accent: '#d4af37',
    accentDim: '#8b6914', headerBg: '#1a1200', headerText: '#d4af37',
    headerSub: '#6a5010', bodyText: '#1a1000', bodyTextDim: '#6a5010',
    ruleLine: '#e0d0a0', metricBg: '#f5f0e0', metricBorder: '#e0d0a0',
    diffBg: '#f5f0e0', diffBorder: '#e0d0a0', footerBg: '#f0ebe0', dark: false,
  },
  'aurora': {
    bg: '#04030e', pageBg: '#fdfcff', border: '#e0d8f8', accent: '#7c3aed',
    accentDim: '#a78bfa', headerBg: '#04030e', headerText: '#a78bfa',
    headerSub: '#4a3a80', bodyText: '#1a1030', bodyTextDim: '#6050a0',
    ruleLine: '#e0d8f8', metricBg: '#f8f6ff', metricBorder: '#e0d8f8',
    diffBg: '#f8f6ff', diffBorder: '#e0d8f8', footerBg: '#f0ecff', dark: false,
  },
};

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
    } else { cur = test; }
  }
  if (cur && lines.length < maxLines) lines.push(truncate(cur, maxChars));
  return lines;
}
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Claim type display labels
const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability:  'x402 Payment Reliability',
  defi_trading_performance:  'DeFi Trading Performance',
  code_software_delivery:    'Code / Software Delivery',
  website_app_delivery:      'Website / App Delivery',
  social_media_growth:       'Social Media Growth',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const uid_param = searchParams.get('uid');

  let commitment: string;
  let themeKey: string;
  let agentId: string;
  let txHash: string;
  let deadline: string;
  let claimType: string;
  let metrics: Array<{label: string; value: string}>;
  let difficultyScore: number;
  let difficultyTier: string;
  let issuedDate: string;

  if (uid_param) {
    const { fetchAttestation, fetchAttestationByTx } = await import('@/lib/eas');
    const data = await fetchAttestation(uid_param) || await fetchAttestationByTx(uid_param);
    if (!data) return new NextResponse('Attestation not found', { status: 404 });
    let parsed: Record<string, string> = {};
    try { parsed = JSON.parse(data.statement); } catch { parsed = { commitment: data.statement }; }
    commitment   = truncate(parsed.commitment || parsed.statement || 'No commitment text', 200);
    themeKey     = searchParams.get('theme') || 'parchment';
    agentId      = esc(data.recipient.slice(0, 8));
    txHash       = data.txHash;
    deadline     = parsed.deadline || '';
    claimType    = parsed.claimType || searchParams.get('claimType') || '';
    metrics      = parsed.metrics ? JSON.parse(parsed.metrics) : [];
    difficultyScore = parseInt(parsed.difficultyScore || '0', 10);
    difficultyTier  = parsed.difficultyTier || 'bronze';
    issuedDate   = formatDate(new Date(data.time * 1000));
  } else {
    commitment   = truncate(searchParams.get('commitment') || searchParams.get('statement') || 'I commit to achieving this goal', 200);
    themeKey     = searchParams.get('theme') || 'parchment';
    const rawId  = searchParams.get('agentId') || '????';
    agentId      = esc(rawId.startsWith('0x') ? rawId.slice(2, 10) : rawId);
    txHash       = searchParams.get('txHash') || '';
    deadline     = esc(searchParams.get('deadline') || '');
    claimType    = searchParams.get('claimType') || '';
    const rawMetrics = searchParams.get('metrics') || '';
    metrics      = rawMetrics ? JSON.parse(decodeURIComponent(rawMetrics)) : [];
    difficultyScore = parseInt(searchParams.get('difficulty') || '0', 10);
    difficultyTier  = searchParams.get('tier') || 'bronze';
    issuedDate   = formatDate(new Date());
  }

  const t = THEMES[themeKey] ?? THEMES['parchment'];
  const txShort = txHash
    ? '0x' + txHash.slice(2, 6) + '\u2026' + txHash.slice(-4)
    : '0x\u2026pending';
  const claimLabel = CLAIM_LABELS[claimType] || esc(claimType) || 'General Commitment';

  // ── Text wrapping for commitment statement ──
  const charCount  = commitment.length;
  const fontSize   = charCount <= 80 ? 13.5 : charCount <= 140 ? 12 : 10.5;
  const lineH      = fontSize + 8;
  const maxChars   = charCount <= 80 ? 44 : charCount <= 140 ? 50 : 56;
  const lines      = wrapText(esc(commitment), maxChars, 5);
  const textH      = lines.length * lineH;

  // ── Metrics grid (up to 3) ──
  const displayMetrics = metrics.slice(0, 3);
  const metricCellW = displayMetrics.length > 0 ? Math.floor(332 / Math.max(displayMetrics.length, 3)) : 110;

  const metricsGroup = displayMetrics.length > 0 ? `
    <!-- Metrics section label -->
    <text x="28" y="200" font-family="monospace" font-size="5.5" letter-spacing="3.5"
      fill="${t.accentDim}" text-anchor="start">VERIFICATION THRESHOLDS</text>
    <!-- Metric cells -->
    ${displayMetrics.map((m, i) => `
    <rect x="${28 + i * (metricCellW + 4)}" y="206" width="${metricCellW}" height="36"
      rx="2" fill="${t.metricBg}" stroke="${t.metricBorder}" stroke-width="0.8"/>
    <text x="${28 + i * (metricCellW + 4) + 8}" y="218" font-family="monospace" font-size="5"
      letter-spacing="2" fill="${t.accentDim}" text-transform="uppercase">${esc(m.label).toUpperCase()}</text>
    <text x="${28 + i * (metricCellW + 4) + 8}" y="233" font-family="Georgia,serif" font-size="13"
      font-weight="bold" fill="${t.bodyText}">${esc(m.value)}</text>
    `).join('')}
  ` : '';

  const metricsBottom = displayMetrics.length > 0 ? 248 : 210;

  // ── Difficulty score ──
  const diffPct      = Math.min(Math.max(difficultyScore, 0), 100);
  const diffBarW     = Math.round(diffPct * 140 / 100);
  const diffTierCol  = difficultyTier === 'gold' ? '#c9a84c'
                     : difficultyTier === 'silver' ? '#8a9aaa'
                     : '#cd7f32';
  const diffTierLabel = difficultyTier.charAt(0).toUpperCase() + difficultyTier.slice(1) + ' Tier';

  const difficultyGroup = `
    <!-- Difficulty section label -->
    <text x="28" y="${metricsBottom + 6}" font-family="monospace" font-size="5.5" letter-spacing="3.5"
      fill="${t.accentDim}">DIFFICULTY SCORE</text>
    <!-- Difficulty row -->
    <rect x="28" y="${metricsBottom + 12}" width="332" height="42"
      rx="2" fill="${t.diffBg}" stroke="${t.diffBorder}" stroke-width="0.8"/>
    <!-- Score number -->
    <text x="42" y="${metricsBottom + 36}" font-family="Georgia,serif" font-size="22"
      font-weight="bold" fill="${t.bodyText}">${difficultyScore}</text>
    <!-- Tier label -->
    <text x="42" y="${metricsBottom + 48}" font-family="monospace" font-size="6"
      letter-spacing="1.5" fill="${diffTierCol}">${diffTierLabel}</text>
    <!-- Desc -->
    <text x="90" y="${metricsBottom + 30}" font-family="monospace" font-size="6"
      fill="${t.bodyTextDim}" font-style="italic">Top ${100 - diffPct}% of ${claimLabel} commitments</text>
    <!-- Bar track -->
    <rect x="90" y="${metricsBottom + 36}" width="140" height="4"
      rx="2" fill="${t.ruleLine}"/>
    <!-- Bar fill -->
    <rect x="90" y="${metricsBottom + 36}" width="${diffBarW}" height="4"
      rx="2" fill="${diffTierCol}" opacity="0.85"/>
    <!-- 0 / 100 labels -->
    <text x="90" y="${metricsBottom + 47}" font-family="monospace" font-size="5"
      fill="${t.accentDim}" opacity="0.6">0</text>
    <text x="226" y="${metricsBottom + 47}" font-family="monospace" font-size="5"
      fill="${t.accentDim}" opacity="0.6" text-anchor="end">100</text>
  `;

  const diffBottom = metricsBottom + 60;

  // ── Deadline ──
  const deadlineGroup = deadline ? `
    <line x1="28" y1="${diffBottom + 2}" x2="360" y2="${diffBottom + 2}"
      stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.6"/>
    <text x="28" y="${diffBottom + 14}" font-family="monospace" font-size="5.5"
      letter-spacing="3.5" fill="${t.accentDim}">DEADLINE</text>
    <text x="96" y="${diffBottom + 14}" font-family="Georgia,serif" font-size="11"
      font-weight="bold" fill="${t.bodyText}">${esc(deadline)}</text>
  ` : '';

  const deadlineH  = deadline ? 22 : 8;
  const bottomY    = diffBottom + deadlineH + 10;

  // ── Bottom row: Agent ID | Issued | Commitment ID + stamp ──
  const bottomRow = `
    <line x1="28" y1="${bottomY}" x2="360" y2="${bottomY}"
      stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.6"/>
    <!-- Agent ID -->
    <text x="28" y="${bottomY + 12}" font-family="monospace" font-size="5"
      letter-spacing="2.5" fill="${t.accentDim}">AGENT ID</text>
    <text x="28" y="${bottomY + 22}" font-family="monospace" font-size="7"
      fill="${t.bodyText}">#${agentId}</text>
    <!-- Issued — centred -->
    <text x="190" y="${bottomY + 12}" font-family="monospace" font-size="5"
      letter-spacing="2.5" fill="${t.accentDim}" text-anchor="middle">ISSUED</text>
    <text x="190" y="${bottomY + 22}" font-family="monospace" font-size="7"
      fill="${t.bodyText}" text-anchor="middle">${issuedDate}</text>
    <!-- Commitment ID — right, stamp sits on top -->
    <text x="360" y="${bottomY + 12}" font-family="monospace" font-size="5"
      letter-spacing="2.5" fill="${t.accentDim}" text-anchor="end">COMMITMENT ID</text>
    <text x="360" y="${bottomY + 22}" font-family="monospace" font-size="6.5"
      fill="${t.bodyTextDim}" text-anchor="end">${txShort}</text>
  `;

  const bottomRowH = 32;
  const footerY    = bottomY + bottomRowH + 10;
  const totalH     = footerY + 22;

  // ── Stamp over commitment ID ──
  const stampSize = 80;
  const stampX    = 360 - stampSize + 20;
  const stampY    = bottomY - stampSize + 14;
  const stampImg  = `<image href="${STAMP_COMMITTED}" x="${stampX}" y="${stampY}"
    width="${stampSize}" height="${stampSize}" opacity="0.90"
    transform="rotate(8, ${stampX + stampSize/2}, ${stampY + stampSize/2})"/>`;

  // ── Mark logo top-right ──
  const markImg = `<image href="${MARK_BLACK}" x="330" y="18" width="22" height="22" opacity="0.55"/>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="380" height="${totalH}" viewBox="0 0 380 ${totalH}"
  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="card"><rect width="380" height="${totalH}" rx="8" ry="8"/></clipPath>
  </defs>

  <!-- Card shell -->
  <rect width="380" height="${totalH}" rx="8" ry="8"
    fill="${t.pageBg}" stroke="${t.border}" stroke-width="1"/>

  <!-- Gold top border -->
  <rect x="0" y="0" width="380" height="4" rx="8" ry="8" fill="${t.accent}" opacity="0.9"/>
  <rect x="0" y="2" width="380" height="2" fill="${t.accent}" opacity="0.9"/>

  <!-- Header -->
  <rect x="0" y="4" width="380" height="34" fill="${t.headerBg}"/>
  <text x="22" y="21" font-family="monospace" font-size="7.5" font-weight="bold"
    letter-spacing="3" fill="${t.headerText}">REGISTERED COMMITMENT</text>
  <text x="22" y="32" font-family="monospace" font-size="5.5" letter-spacing="2"
    fill="${t.headerSub}">CATEGORY: ${claimLabel.toUpperCase()}</text>
  <!-- Mark logo -->
  ${markImg}
  <!-- TX -->
  <text x="356" y="26" font-family="monospace" font-size="5.5" letter-spacing="1"
    fill="${t.headerSub}" text-anchor="end">TX: ${txShort}</text>

  <!-- Divider -->
  <line x1="0" y1="38" x2="380" y2="38" stroke="${t.border}" stroke-width="0.6"/>

  <!-- Commitment label -->
  <text x="28" y="58" font-family="monospace" font-size="5.5" letter-spacing="3.5"
    fill="${t.accentDim}">COMMITMENT STATEMENT</text>

  <!-- Goal box — left accent border -->
  <rect x="28" y="64" width="3" height="${textH + 16}" rx="1" fill="${t.accent}" opacity="0.8"/>
  <rect x="31" y="64" width="321" height="${textH + 16}" rx="0 2 2 0"
    fill="${t.metricBg}" stroke="${t.metricBorder}" stroke-width="0.8"/>

  <!-- Commitment text -->
  ${lines.map((line, i) =>
    `<text x="44" y="${82 + i * lineH}" font-family="Georgia,serif" font-size="${fontSize}"
      font-style="italic" fill="${t.bodyText}">${line}</text>`
  ).join('\n  ')}

  ${metricsGroup}
  ${difficultyGroup}
  ${deadlineGroup}
  ${bottomRow}
  ${stampImg}

  <!-- Footer -->
  <rect x="0" y="${footerY}" width="380" height="22" fill="${t.footerBg}"/>
  <line x1="0" y1="${footerY}" x2="380" y2="${footerY}"
    stroke="${t.border}" stroke-width="0.6"/>
  <text x="22" y="${footerY + 14}" font-family="monospace" font-size="5"
    letter-spacing="1.5" fill="${t.accentDim}" opacity="0.8">THESEALER.XYZ</text>
  <text x="358" y="${footerY + 14}" font-family="monospace" font-size="5"
    letter-spacing="1.5" fill="${t.accentDim}" opacity="0.8" text-anchor="end">EAS · BASE</text>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}