// src/app/api/commitment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { STAMP_COMMITTED, MARK_WHITE } from '@/lib/assets';
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
    headerSub: '#b8964a',
    bodyText: '#1a1208', bodyTextDim: '#6a5030',
    ruleLine: '#ddd0b0', metricBg: '#f0ebe0', metricBorder: '#ddd0b0',
    diffBg: '#f5f0e4', diffBorder: '#ddd0b0', footerBg: '#f0ebe0', dark: true,
  },
  'circuit-anim': {
    bg: '#04090f', pageBg: '#06111e', border: '#0d3040', accent: '#00e5ff',
    accentDim: '#2a7090', headerBg: '#04090f', headerText: '#00e5ff',
    headerSub: '#4ab8cc',
    bodyText: '#d0eef5', bodyTextDim: '#5a9aaa',
    ruleLine: '#0d3545', metricBg: '#04111e', metricBorder: '#0d3040',
    diffBg: '#04111e', diffBorder: '#0d3040', footerBg: '#04090f', dark: true,
  },
  'base': {
    bg: '#0042cc', pageBg: '#fafbff', border: '#c0d0ff', accent: '#0052ff',
    accentDim: '#4d88ff', headerBg: '#0052ff', headerText: '#ffffff',
    headerSub: '#c0d8ff',
    bodyText: '#0a1a3a', bodyTextDim: '#4a6aaa',
    ruleLine: '#c0d0ff', metricBg: '#f0f4ff', metricBorder: '#c0d0ff',
    diffBg: '#f0f4ff', diffBorder: '#c0d0ff', footerBg: '#e8eeff', dark: true,
  },
  'gold': {
    bg: '#0a0800', pageBg: '#faf8f0', border: '#3a2a08', accent: '#d4af37',
    accentDim: '#8b6914', headerBg: '#1a1200', headerText: '#d4af37',
    headerSub: '#c9a030',
    bodyText: '#1a1000', bodyTextDim: '#6a5010',
    ruleLine: '#e0d0a0', metricBg: '#f5f0e0', metricBorder: '#e0d0a0',
    diffBg: '#f5f0e0', diffBorder: '#e0d0a0', footerBg: '#f0ebe0', dark: true,
  },
  'aurora': {
    bg: '#04030e', pageBg: '#fdfcff', border: '#e0d8f8', accent: '#7c3aed',
    accentDim: '#a78bfa', headerBg: '#04030e', headerText: '#a78bfa',
    headerSub: '#8b72e0',
    bodyText: '#1a1030', bodyTextDim: '#6050a0',
    ruleLine: '#e0d8f8', metricBg: '#f8f6ff', metricBorder: '#e0d8f8',
    diffBg: '#f8f6ff', diffBorder: '#e0d8f8', footerBg: '#f0ecff', dark: true,
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

const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payment Reliability',
  defi_trading_performance: 'DeFi Trading Performance',
  code_software_delivery:   'Code / Software Delivery',
  website_app_delivery:     'Website / App Delivery',
  social_media_growth:      'Social Media Growth',
};

const CHAR_LIMIT = 200;
const CHAR_WARN  = 160;

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
    commitment      = truncate(parsed.commitment || parsed.statement || 'No commitment text', CHAR_LIMIT);
    themeKey        = searchParams.get('theme') || 'parchment';
    agentId         = esc(data.recipient.slice(0, 8));
    txHash          = data.txHash;
    deadline        = parsed.deadline || '';
    claimType       = parsed.claimType || searchParams.get('claimType') || '';
    metrics         = parsed.metrics ? JSON.parse(parsed.metrics) : [];
    difficultyScore = parseInt(parsed.difficultyScore || '0', 10);
    difficultyTier  = parsed.difficultyTier || 'bronze';
    issuedDate      = formatDate(new Date(data.time * 1000));
  } else {
    commitment      = truncate(searchParams.get('commitment') || searchParams.get('statement') || 'I commit to achieving this goal', CHAR_LIMIT);
    themeKey        = searchParams.get('theme') || 'parchment';
    const rawId     = searchParams.get('agentId') || '????';
    agentId         = esc(rawId.startsWith('0x') ? rawId.slice(2, 10) : rawId);
    txHash          = searchParams.get('txHash') || '';
    deadline        = esc(searchParams.get('deadline') || '');
    claimType       = searchParams.get('claimType') || '';
    const rawMetrics = searchParams.get('metrics') || '';
    metrics         = rawMetrics ? JSON.parse(decodeURIComponent(rawMetrics)) : [];
    difficultyScore = parseInt(searchParams.get('difficulty') || '0', 10);
    difficultyTier  = searchParams.get('tier') || 'bronze';
    issuedDate      = formatDate(new Date());
  }

  const t = THEMES[themeKey] ?? THEMES['parchment'];
  const txShort = txHash
    ? '0x' + txHash.slice(2, 6) + '\u2026' + txHash.slice(-4)
    : '0x\u2026pending';
  const claimLabel = CLAIM_LABELS[claimType] || esc(claimType) || 'General Commitment';

  // ── Layout constants ──
  const HEADER_H  = 46;   // taller header: logo + tx stacked
  const BOX_PAD   = 18;
  const BOX_TOP   = 4 + HEADER_H + 22;

  // ── Adaptive text sizing ──
  const charCount = commitment.length;
  const fontSize  = charCount <= 70  ? 13.5
                  : charCount <= 120 ? 12.5
                  : charCount <= 160 ? 11.5
                  : 10.5;
  const lineH     = fontSize * 1.65;
  const maxChars  = charCount <= 70  ? 42
                  : charCount <= 120 ? 46
                  : charCount <= 160 ? 52
                  : 56;
  const lines     = wrapText(esc(commitment), maxChars, 5);
  // Always render minimum 3-line height box
  const boxLines  = Math.max(lines.length, 3);
  const BOX_H     = boxLines * lineH + BOX_PAD * 2;

  const charHint = commitment.length >= CHAR_WARN
    ? `<text x="348" y="${BOX_TOP + BOX_H - 5}" font-family="monospace" font-size="5"
        fill="${t.accentDim}" opacity="0.45" text-anchor="end">${commitment.length}/${CHAR_LIMIT} chars</text>`
    : '';

  // ── Section blocks start here ──
  const SECTION_TOP = BOX_TOP + BOX_H + 14;

  // ── Metrics ──
  const displayMetrics = metrics.slice(0, 3);
  const metricCellW    = Math.floor(332 / 3);
  const METRIC_LABEL_Y = SECTION_TOP + 10;
  const METRIC_BOX_Y   = SECTION_TOP + 16;
  const METRIC_BOX_H   = 38;

  const metricsGroup = displayMetrics.length > 0 ? `
    <text x="28" y="${METRIC_LABEL_Y}" font-family="monospace" font-size="5.5"
      letter-spacing="3.5" fill="${t.accentDim}">VERIFICATION THRESHOLDS</text>
    ${displayMetrics.map((m, i) => `
    <rect x="${28 + i * (metricCellW + 4)}" y="${METRIC_BOX_Y}" width="${metricCellW}" height="${METRIC_BOX_H}"
      rx="2" fill="${t.metricBg}" stroke="${t.metricBorder}" stroke-width="0.8"/>
    <text x="${28 + i * (metricCellW + 4) + 8}" y="${METRIC_BOX_Y + 12}" font-family="monospace" font-size="5"
      letter-spacing="2" fill="${t.accentDim}">${esc(m.label).toUpperCase()}</text>
    <text x="${28 + i * (metricCellW + 4) + 8}" y="${METRIC_BOX_Y + 29}" font-family="Georgia,serif" font-size="13"
      font-weight="bold" fill="${t.bodyText}">${esc(m.value)}</text>
    `).join('')}
  ` : '';

  const metricsBottom = displayMetrics.length > 0
    ? METRIC_BOX_Y + METRIC_BOX_H + 10
    : SECTION_TOP;

  // ── Difficulty ──
  const diffPct       = Math.min(Math.max(difficultyScore, 0), 100);
  const diffTierCol   = difficultyTier === 'gold'   ? '#c9a84c'
                      : difficultyTier === 'silver' ? '#8a9aaa'
                      : '#cd7f32';
  const diffTierLabel = difficultyTier.charAt(0).toUpperCase() + difficultyTier.slice(1) + ' Tier';
  const BAR_X         = 115;   // shifted right
  const BAR_TRACK_W   = 205;
  const diffBarW      = Math.round(diffPct * BAR_TRACK_W / 100);
  const DIFF_LABEL_Y  = metricsBottom + 10;
  const DIFF_BOX_Y    = metricsBottom + 16;
  const DIFF_BOX_H    = 44;

  const difficultyGroup = `
    <text x="28" y="${DIFF_LABEL_Y}" font-family="monospace" font-size="5.5"
      letter-spacing="3.5" fill="${t.accentDim}">DIFFICULTY SCORE</text>
    <rect x="28" y="${DIFF_BOX_Y}" width="332" height="${DIFF_BOX_H}"
      rx="2" fill="${t.diffBg}" stroke="${t.diffBorder}" stroke-width="0.8"/>
    <text x="44" y="${DIFF_BOX_Y + 28}" font-family="Georgia,serif" font-size="24"
      font-weight="bold" fill="${t.bodyText}">${difficultyScore}</text>
    <text x="44" y="${DIFF_BOX_Y + 40}" font-family="monospace" font-size="6"
      letter-spacing="1.5" fill="${diffTierCol}">${diffTierLabel}</text>
    <text x="${BAR_X}" y="${DIFF_BOX_Y + 16}" font-family="monospace" font-size="6"
      fill="${t.bodyTextDim}" font-style="italic">Top ${100 - diffPct}% of ${claimLabel} commitments</text>
    <rect x="${BAR_X}" y="${DIFF_BOX_Y + 24}" width="${BAR_TRACK_W}" height="5"
      rx="2" fill="${t.ruleLine}"/>
    <rect x="${BAR_X}" y="${DIFF_BOX_Y + 24}" width="${diffBarW}" height="5"
      rx="2" fill="${diffTierCol}" opacity="0.85"/>
    <text x="${BAR_X}" y="${DIFF_BOX_Y + 38}" font-family="monospace" font-size="5"
      fill="${t.accentDim}" opacity="0.5">0</text>
    <text x="${BAR_X + BAR_TRACK_W}" y="${DIFF_BOX_Y + 38}" font-family="monospace" font-size="5"
      fill="${t.accentDim}" opacity="0.5" text-anchor="end">100</text>
  `;

  const diffBottom = DIFF_BOX_Y + DIFF_BOX_H + 10;

  // ── Deadline — no divider line before it ──
  const DEAD_Y = diffBottom;
  const deadlineGroup = deadline ? `
    <text x="28" y="${DEAD_Y + 10}" font-family="monospace" font-size="5.5"
      letter-spacing="3.5" fill="${t.accentDim}">DEADLINE</text>
    <text x="96" y="${DEAD_Y + 10}" font-family="Georgia,serif" font-size="9.5"
      font-weight="600" fill="${t.bodyText}">${esc(deadline)}</text>
  ` : '';

  const deadlineH = deadline ? 18 : 0;
  const bottomY   = DEAD_Y + deadlineH + 14;

  // ── Bottom row ──
  const bottomRow = `
    <line x1="28" y1="${bottomY}" x2="360" y2="${bottomY}"
      stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.5"/>
    <text x="28" y="${bottomY + 13}" font-family="monospace" font-size="5"
      letter-spacing="2.5" fill="${t.accentDim}">AGENT ID</text>
    <text x="28" y="${bottomY + 24}" font-family="monospace" font-size="7"
      fill="${t.bodyText}">#${agentId}</text>
    <text x="190" y="${bottomY + 13}" font-family="monospace" font-size="5"
      letter-spacing="2.5" fill="${t.accentDim}" text-anchor="middle">ISSUED</text>
    <text x="190" y="${bottomY + 24}" font-family="monospace" font-size="7"
      fill="${t.bodyText}" text-anchor="middle">${issuedDate}</text>
    <text x="360" y="${bottomY + 13}" font-family="monospace" font-size="5"
      letter-spacing="2.5" fill="${t.accentDim}" text-anchor="end">COMMITMENT ID</text>
    <text x="360" y="${bottomY + 24}" font-family="monospace" font-size="6.5"
      fill="${t.bodyTextDim}" text-anchor="end">${txShort}</text>
  `;

  const footerY = bottomY + 36;
  const totalH  = footerY + 22;

  // ── Stamp over commitment ID ──
  const stampSize = 80;
  const stampX    = 360 - stampSize + 20;
  const stampY    = bottomY - stampSize + 23;  // was 28, up 5px
  const stampImg  = `<image href="${STAMP_COMMITTED}" x="${stampX}" y="${stampY}"
    width="${stampSize}" height="${stampSize}" opacity="0.90"
    transform="rotate(8, ${stampX + stampSize / 2}, ${stampY + stampSize / 2})"/>`;

  // ── MARK_WHITE — logo in header top-right, above TX ──
  // Logo: 22px, x=340 (a bit left of edge), y=6 — TX aligns to category row y=37
  const markImg = `<image href="${MARK_WHITE}" x="326" y="4" width="36" height="36" opacity="0.9"/>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="380" height="${totalH}" viewBox="0 0 380 ${totalH}"
  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">

  <!-- Card shell — stroke only top+bottom, sides via explicit lines -->
  <rect width="380" height="${totalH}" rx="8" ry="8"
    fill="${t.pageBg}"/>

  <!-- Outer border — full rect so corners round correctly -->
  <rect width="380" height="${totalH}" rx="8" ry="8"
    fill="none" stroke="${t.border}" stroke-width="1"/>

  <!-- Accent top bar -->
  <rect x="0" y="0" width="380" height="4" rx="4" fill="${t.accent}" opacity="0.95"/>

  <!-- Header -->
  <rect x="0" y="4" width="380" height="${HEADER_H}" fill="${t.headerBg}"/>
  <text x="22" y="23" font-family="monospace" font-size="8" font-weight="bold"
    letter-spacing="3" fill="${t.headerText}">REGISTERED COMMITMENT</text>
  <text x="22" y="37" font-family="monospace" font-size="5.5" letter-spacing="2"
    fill="${t.headerSub}">CATEGORY: ${claimLabel.toUpperCase()}</text>
  ${markImg}
  <!-- TX aligned to category row -->
  <text x="358" y="37" font-family="monospace" font-size="5" letter-spacing="1"
    fill="${t.headerSub}" text-anchor="end">TX: ${txShort}</text>

  <!-- Header bottom rule -->
  <line x1="0" y1="${4 + HEADER_H}" x2="380" y2="${4 + HEADER_H}"
    stroke="${t.border}" stroke-width="0.8"/>

  <!-- Commitment statement label -->
  <text x="28" y="${BOX_TOP - 8}" font-family="monospace" font-size="5.5"
    letter-spacing="3.5" fill="${t.accentDim}">COMMITMENT STATEMENT</text>

  <!-- Statement box -->
  <rect x="28" y="${BOX_TOP}" width="3" height="${BOX_H}" rx="1"
    fill="${t.accent}" opacity="0.85"/>
  <rect x="31" y="${BOX_TOP}" width="321" height="${BOX_H}" rx="0 2 2 0"
    fill="${t.metricBg}" stroke="${t.metricBorder}" stroke-width="0.8"/>
  ${lines.map((line, i) =>
    `<text x="44" y="${BOX_TOP + BOX_PAD + i * lineH + fontSize}"
      font-family="Georgia,serif" font-size="${fontSize}"
      font-style="italic" fill="${t.bodyText}">${line}</text>`
  ).join('\n  ')}
  ${charHint}

  ${metricsGroup}
  ${difficultyGroup}
  ${deadlineGroup}
  ${bottomRow}
  ${stampImg}

  <!-- Footer -->
  <rect x="0" y="${footerY}" width="380" height="22"
    fill="${t.footerBg}"/>
  <!-- Footer top border -->
  <line x1="0" y1="${footerY}" x2="380" y2="${footerY}"
    stroke="${t.border}" stroke-width="0.8"/>
  <!-- Left side border — full height -->
  <line x1="0.5" y1="4" x2="0.5" y2="${totalH}"
    stroke="${t.border}" stroke-width="1"/>
  <!-- Right side border — full height -->
  <line x1="379.5" y1="4" x2="379.5" y2="${totalH}"
    stroke="${t.border}" stroke-width="1"/>
  <!-- Bottom border -->
  <line x1="0" y1="${totalH - 0.5}" x2="380" y2="${totalH - 0.5}"
    stroke="${t.border}" stroke-width="1"/>
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