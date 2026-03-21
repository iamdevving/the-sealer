// src/app/api/amendment/route.ts
//
// SVG render for an amended commitment.
// Shows:
//   - AMENDED banner in header
//   - Original statement struck-through (greyed)
//   - New/amended statement below it
//   - New difficulty score + tier
//   - Original vs new metric comparison
//   - Timestamps: committed, amended
//
// GET /api/amendment?uid={amendUID}&originalUid={commitmentUID}&theme={theme}

import { NextRequest, NextResponse } from 'next/server';
import { STAMP_COMMITTED, MARK_WHITE } from '@/lib/assets';
export const runtime = 'nodejs';

// Reuse the same theme palette as commitment/route.ts
const THEMES: Record<string, {
  bg: string; pageBg: string; border: string; accent: string; accentDim: string;
  headerBg: string; headerText: string; headerSub: string; bodyText: string;
  bodyTextDim: string; ruleLine: string; metricBg: string; metricBorder: string;
  diffBg: string; diffBorder: string; footerBg: string; dark: boolean;
  amendedBg: string; amendedBorder: string;
}> = {
  'parchment': {
    bg: '#d4c5a0', pageBg: '#faf8f2', border: '#ddd0b0', accent: '#c9a84c',
    accentDim: '#9a8050', headerBg: '#2d1f0e', headerText: '#c9a84c',
    headerSub: '#b8964a', bodyText: '#1a1208', bodyTextDim: '#6a5030',
    ruleLine: '#ddd0b0', metricBg: '#f0ebe0', metricBorder: '#ddd0b0',
    diffBg: '#f5f0e4', diffBorder: '#ddd0b0', footerBg: '#f0ebe0', dark: true,
    amendedBg: '#fff8ec', amendedBorder: '#e0a020',
  },
  'circuit-anim': {
    bg: '#04090f', pageBg: '#06111e', border: '#0d3040', accent: '#00e5ff',
    accentDim: '#2a7090', headerBg: '#04090f', headerText: '#00e5ff',
    headerSub: '#4ab8cc', bodyText: '#d0eef5', bodyTextDim: '#5a9aaa',
    ruleLine: '#0d3545', metricBg: '#04111e', metricBorder: '#0d3040',
    diffBg: '#04111e', diffBorder: '#0d3040', footerBg: '#04090f', dark: true,
    amendedBg: '#041a10', amendedBorder: '#00a050',
  },
  'base': {
    bg: '#0042cc', pageBg: '#fafbff', border: '#c0d0ff', accent: '#0052ff',
    accentDim: '#4d88ff', headerBg: '#0052ff', headerText: '#ffffff',
    headerSub: '#c0d8ff', bodyText: '#0a1a3a', bodyTextDim: '#4a6aaa',
    ruleLine: '#c0d0ff', metricBg: '#f0f4ff', metricBorder: '#c0d0ff',
    diffBg: '#f0f4ff', diffBorder: '#c0d0ff', footerBg: '#e8eeff', dark: true,
    amendedBg: '#e8f4ff', amendedBorder: '#0052ff',
  },
  'gold': {
    bg: '#0a0800', pageBg: '#faf8f0', border: '#3a2a08', accent: '#d4af37',
    accentDim: '#8b6914', headerBg: '#1a1200', headerText: '#d4af37',
    headerSub: '#c9a030', bodyText: '#1a1000', bodyTextDim: '#6a5010',
    ruleLine: '#e0d0a0', metricBg: '#f5f0e0', metricBorder: '#e0d0a0',
    diffBg: '#f5f0e0', diffBorder: '#e0d0a0', footerBg: '#f0ebe0', dark: true,
    amendedBg: '#fffbec', amendedBorder: '#d4af37',
  },
  'aurora': {
    bg: '#04030e', pageBg: '#fdfcff', border: '#e0d8f8', accent: '#7c3aed',
    accentDim: '#a78bfa', headerBg: '#04030e', headerText: '#a78bfa',
    headerSub: '#8b72e0', bodyText: '#1a1030', bodyTextDim: '#6050a0',
    ruleLine: '#e0d8f8', metricBg: '#f8f6ff', metricBorder: '#e0d8f8',
    diffBg: '#f8f6ff', diffBorder: '#e0d8f8', footerBg: '#f0ecff', dark: true,
    amendedBg: '#f5f0ff', amendedBorder: '#7c3aed',
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Params — can come from EAS UID lookup or direct query params
  let originalStatement = '';
  let newStatement      = '';
  let originalMetric    = '';
  let newMetric         = '';
  let agentId           = '????';
  let claimType         = '';
  let txHash            = '';        // original commitment tx
  let amendTxHash       = '';        // amendment tx
  let originalDifficulty = 0;
  let newDifficulty      = 0;
  let difficultyTier     = 'bronze';
  let committedDate      = formatDate(new Date());
  let amendedDate        = formatDate(new Date());
  let deadline           = '';
  const themeKey         = searchParams.get('theme') || 'parchment';

  const uid         = searchParams.get('uid');         // amendment EAS UID
  const originalUid = searchParams.get('originalUid'); // original commitment EAS UID

  if (uid && originalUid) {
    // Load both attestations from EAS
    const { fetchAttestation, fetchAttestationByTx } = await import('@/lib/eas');
    const [amendData, origData] = await Promise.all([
      fetchAttestation(uid) || fetchAttestationByTx(uid),
      fetchAttestation(originalUid) || fetchAttestationByTx(originalUid),
    ]);

    if (!amendData || !origData) {
      return new NextResponse('Attestation not found', { status: 404 });
    }

    // Original commitment
    let origParsed: Record<string, string> = {};
    try { origParsed = JSON.parse(origData.statement); } catch { origParsed = { commitment: origData.statement }; }
    originalStatement  = truncate(origParsed.commitment || origParsed.statement || 'Original commitment', CHAR_LIMIT);
    originalMetric     = origParsed.metric || '';
    claimType          = origParsed.claimType || searchParams.get('claimType') || '';
    agentId            = esc(origData.recipient.slice(0, 8));
    txHash             = origData.txHash;
    committedDate      = formatDate(new Date(origData.time * 1000));
    originalDifficulty = parseInt(origParsed.difficultyScore || '0', 10);

    // Amendment attestation
    let amendParsed: Record<string, string> = {};
    try { amendParsed = JSON.parse(amendData.statement); } catch { amendParsed = {}; }
    newStatement   = truncate(amendParsed.newCommitment || originalStatement, CHAR_LIMIT);
    newMetric      = amendParsed.newMetric || amendData.statement || '';
    amendTxHash    = amendData.txHash;
    amendedDate    = formatDate(new Date(amendData.time * 1000));
    newDifficulty  = parseInt(amendParsed.newDifficulty || amendParsed.difficulty || '0', 10);
    difficultyTier = newDifficulty >= 70 ? 'gold' : newDifficulty >= 40 ? 'silver' : 'bronze';
    // deadline comes from original commitment params
    deadline       = origParsed.deadline || '';
  } else {
    // Preview mode — direct query params
    originalStatement  = truncate(searchParams.get('originalStatement') || 'Original commitment statement', CHAR_LIMIT);
    newStatement       = truncate(searchParams.get('newStatement') || originalStatement, CHAR_LIMIT);
    originalMetric     = searchParams.get('originalMetric') || '';
    newMetric          = searchParams.get('newMetric') || '';
    agentId            = esc((searchParams.get('agentId') || '????').slice(0, 8));
    claimType          = searchParams.get('claimType') || '';
    txHash             = searchParams.get('txHash') || '';
    amendTxHash        = searchParams.get('amendTxHash') || '';
    originalDifficulty = parseInt(searchParams.get('originalDifficulty') || '0', 10);
    newDifficulty      = parseInt(searchParams.get('newDifficulty') || '0', 10);
    difficultyTier     = newDifficulty >= 70 ? 'gold' : newDifficulty >= 40 ? 'silver' : 'bronze';
    committedDate      = searchParams.get('committedDate') || formatDate(new Date());
    amendedDate        = searchParams.get('amendedDate')   || formatDate(new Date());
    deadline           = searchParams.get('deadline') || '';
  }

  const t          = THEMES[themeKey] ?? THEMES['parchment'];
  const txShort    = txHash ? '0x' + txHash.slice(2,6) + '\u2026' + txHash.slice(-4) : '0x\u2026';
  const claimLabel = CLAIM_LABELS[claimType] || esc(claimType) || 'General Commitment';
  const tierCol    = difficultyTier === 'gold'   ? '#c9a84c'
                   : difficultyTier === 'silver' ? '#8a9aaa'
                   : '#cd7f32';
  const tierLabel  = difficultyTier.charAt(0).toUpperCase() + difficultyTier.slice(1) + ' Tier';

  // ── Layout ────────────────────────────────────────────────────────────────
  const HEADER_H = 52;
  const PAD      = 28;
  const W        = 380;

  // AMENDED pill in header
  const amendedPillY = 4 + HEADER_H + 10;

  // Original statement — struck through
  const origFontSize = originalStatement.length <= 80  ? 11.5 : originalStatement.length <= 140 ? 10.5 : 9.5;
  const origLineH    = origFontSize * 1.6;
  const origMaxChars = originalStatement.length <= 80  ? 48 : originalStatement.length <= 140 ? 52 : 56;
  const origLines    = wrapText(esc(originalStatement), origMaxChars, 3);
  const origBoxH     = origLines.length * origLineH + 20;
  const ORIG_BOX_Y   = amendedPillY + 32;

  // New statement — highlighted
  const newFontSize  = newStatement.length <= 80  ? 12 : newStatement.length <= 140 ? 11 : 10;
  const newLineH     = newFontSize * 1.65;
  const newMaxChars  = newStatement.length <= 80  ? 46 : newStatement.length <= 140 ? 50 : 55;
  const newLines     = wrapText(esc(newStatement), newMaxChars, 4);
  const newBoxH      = Math.max(newLines.length, 2) * newLineH + 20;
  const NEW_BOX_Y    = ORIG_BOX_Y + origBoxH + 12;

  // Metric + difficulty in one combined box (tighter layout)
  const METRIC_Y   = NEW_BOX_Y + newBoxH + 14;
  const metricBoxH = 80;

  // Deadline row
  const DEAD_Y  = METRIC_Y + metricBoxH + 10;
  const deadlineH = deadline ? 18 : 0;

  // Bottom info row
  const BOTTOM_Y = DEAD_Y + deadlineH + 12;
  const footerY  = BOTTOM_Y + 36;
  const totalH   = footerY + 22;

  // Stamp: overlaps bottom-right of metric box — same pattern as commitment card
  const stampSize = 80;
  const stampX    = W - PAD - stampSize + 20;
  const stampY    = BOTTOM_Y - stampSize + 23;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}"
  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">

  <!-- Card shell -->
  <rect width="${W}" height="${totalH}" rx="8" ry="8" fill="${t.pageBg}"/>
  <rect width="${W}" height="${totalH}" rx="8" ry="8" fill="none" stroke="${t.border}" stroke-width="1"/>

  <!-- Accent top bar — amber/orange to signal amendment -->
  <rect x="0" y="0" width="${W}" height="4" rx="4" fill="#e09020" opacity="0.95"/>

  <!-- Header -->
  <rect x="0" y="4" width="${W}" height="${HEADER_H}" fill="${t.headerBg}"/>
  <text x="${PAD}" y="24" font-family="monospace" font-size="8" font-weight="bold"
    letter-spacing="3" fill="#e09020">AMENDED COMMITMENT</text>
  <text x="${PAD}" y="39" font-family="monospace" font-size="5.5" letter-spacing="2"
    fill="${t.headerSub}">CATEGORY: ${claimLabel.toUpperCase()}</text>
  <image href="${MARK_WHITE}" x="326" y="4" width="36" height="36" opacity="0.9"/>
  <text x="358" y="39" font-family="monospace" font-size="5" letter-spacing="1"
    fill="${t.headerSub}" text-anchor="end">TX: ${txShort}</text>
  <line x1="0" y1="${4 + HEADER_H}" x2="${W}" y2="${4 + HEADER_H}"
    stroke="${t.border}" stroke-width="0.8"/>

  <!-- AMENDED pill -->
  <rect x="${PAD}" y="${amendedPillY}" width="80" height="18" rx="3"
    fill="none" stroke="#e09020" stroke-width="1.2"/>
  <text x="${PAD + 40}" y="${amendedPillY + 12}" font-family="monospace" font-size="7"
    font-weight="bold" letter-spacing="2" fill="#e09020" text-anchor="middle">AMENDED</text>
  <text x="${PAD + 96}" y="${amendedPillY + 12}" font-family="monospace" font-size="6"
    fill="${t.accentDim}" letter-spacing="1">${amendedDate}</text>

  <!-- Original statement section label -->
  <text x="${PAD}" y="${ORIG_BOX_Y - 6}" font-family="monospace" font-size="5"
    letter-spacing="3" fill="${t.accentDim}" opacity="0.6">ORIGINAL STATEMENT</text>

  <!-- Original statement box — greyed, struck through -->
  <rect x="${PAD}" y="${ORIG_BOX_Y}" width="${W - PAD * 2}" height="${origBoxH}" rx="2"
    fill="${t.metricBg}" stroke="${t.metricBorder}" stroke-width="0.7" opacity="0.6"/>
  ${origLines.map((line, i) => `
  <text x="${PAD + 8}" y="${ORIG_BOX_Y + 14 + i * origLineH}"
    font-family="Georgia,serif" font-size="${origFontSize}" font-style="italic"
    fill="${t.bodyTextDim}" opacity="0.55"
    text-decoration="line-through">${line}</text>`).join('')}

  <!-- New statement section label -->
  <text x="${PAD}" y="${NEW_BOX_Y - 6}" font-family="monospace" font-size="5"
    letter-spacing="3" fill="#e09020">AMENDED STATEMENT</text>

  <!-- New statement box — highlighted with amber border -->
  <rect x="${PAD}" y="${NEW_BOX_Y}" width="3" height="${newBoxH}" rx="1"
    fill="#e09020" opacity="0.9"/>
  <rect x="${PAD + 3}" y="${NEW_BOX_Y}" width="${W - PAD * 2 - 3}" height="${newBoxH}"
    rx="0 2 2 0" fill="${t.amendedBg}" stroke="${t.amendedBorder}" stroke-width="0.9"/>
  ${newLines.map((line, i) => `
  <text x="${PAD + 14}" y="${NEW_BOX_Y + 14 + i * newLineH}"
    font-family="Georgia,serif" font-size="${newFontSize}" font-style="italic"
    fill="${t.bodyText}">${line}</text>`).join('')}

  <!-- Metric comparison -->
  <text x="${PAD}" y="${METRIC_Y - 4}" font-family="monospace" font-size="5"
    letter-spacing="3" fill="${t.accentDim}">THRESHOLDS</text>
  <rect x="${PAD}" y="${METRIC_Y}" width="${W - PAD * 2}" height="${metricBoxH}"
    rx="2" fill="${t.metricBg}" stroke="${t.metricBorder}" stroke-width="0.8"/>

  <!-- Before column -->
  <text x="${PAD + 10}" y="${METRIC_Y + 14}" font-family="monospace" font-size="5"
    letter-spacing="2" fill="${t.accentDim}">BEFORE</text>
  <text x="${PAD + 10}" y="${METRIC_Y + 28}" font-family="Georgia,serif" font-size="9"
    fill="${t.bodyTextDim}" opacity="0.6">${esc(truncate(originalMetric || '—', 40))}</text>

  <!-- Divider -->
  <line x1="${PAD + 10}" y1="${METRIC_Y + 36}" x2="${W - PAD - 10}" y2="${METRIC_Y + 36}"
    stroke="${t.ruleLine}" stroke-width="0.5" stroke-dasharray="3,3"/>

  <!-- Difficulty before -->
  <text x="${PAD + 10}" y="${METRIC_Y + 50}" font-family="monospace" font-size="5"
    letter-spacing="2" fill="${t.accentDim}">DIFFICULTY BEFORE</text>
  <text x="${PAD + 10}" y="${METRIC_Y + 64}" font-family="Georgia,serif" font-size="14"
    font-weight="bold" fill="${t.bodyTextDim}" opacity="0.6">${originalDifficulty}</text>

  <!-- Arrow -->
  <text x="${W / 2}" y="${METRIC_Y + 54}" font-family="monospace" font-size="16"
    fill="#e09020" text-anchor="middle" opacity="0.7">→</text>

  <!-- After column -->
  <text x="${W / 2 + 20}" y="${METRIC_Y + 14}" font-family="monospace" font-size="5"
    letter-spacing="2" fill="#e09020">AFTER</text>
  <text x="${W / 2 + 20}" y="${METRIC_Y + 28}" font-family="Georgia,serif" font-size="9"
    fill="${t.bodyText}">${esc(truncate(newMetric || '—', 40))}</text>

  <!-- Difficulty after -->
  <text x="${W / 2 + 20}" y="${METRIC_Y + 50}" font-family="monospace" font-size="5"
    letter-spacing="2" fill="${t.accentDim}">DIFFICULTY AFTER</text>
  <text x="${W / 2 + 20}" y="${METRIC_Y + 64}" font-family="Georgia,serif" font-size="14"
    font-weight="bold" fill="${tierCol}">${newDifficulty}</text>
  <text x="${W / 2 + 36}" y="${METRIC_Y + 72}" font-family="monospace" font-size="6"
    fill="${tierCol}" letter-spacing="1">${tierLabel}</text>

  <!-- Deadline -->
  ${deadline ? `
  <text x="${PAD}" y="${DEAD_Y + 11}" font-family="monospace" font-size="5.5"
    letter-spacing="3.5" fill="${t.accentDim}">DEADLINE</text>
  <text x="${PAD + 72}" y="${DEAD_Y + 11}" font-family="Georgia,serif" font-size="9.5"
    font-weight="600" fill="${t.bodyText}">${esc(deadline)}</text>
  ` : ''}

  <!-- Bottom row -->
  <line x1="${PAD}" y1="${BOTTOM_Y}" x2="${W - PAD}" y2="${BOTTOM_Y}"
    stroke="${t.ruleLine}" stroke-width="0.6" opacity="0.5"/>
  <text x="${PAD}" y="${BOTTOM_Y + 13}" font-family="monospace" font-size="5"
    letter-spacing="2.5" fill="${t.accentDim}">AGENT ID</text>
  <text x="${PAD}" y="${BOTTOM_Y + 24}" font-family="monospace" font-size="7"
    fill="${t.bodyText}">#${agentId}</text>
  <text x="190" y="${BOTTOM_Y + 13}" font-family="monospace" font-size="5"
    letter-spacing="2.5" fill="${t.accentDim}" text-anchor="middle">COMMITTED</text>
  <text x="190" y="${BOTTOM_Y + 24}" font-family="monospace" font-size="7"
    fill="${t.bodyText}" text-anchor="middle">${committedDate}</text>
  <text x="${W - PAD}" y="${BOTTOM_Y + 13}" font-family="monospace" font-size="5"
    letter-spacing="2.5" fill="${t.accentDim}" text-anchor="end">AMENDMENT ID</text>
  <text x="${W - PAD}" y="${BOTTOM_Y + 24}" font-family="monospace" font-size="6.5"
    fill="${t.bodyTextDim}" text-anchor="end">${amendTxHash ? '0x' + amendTxHash.slice(2,6) + '\u2026' + amendTxHash.slice(-4) : '0x\u2026'}</text>

  <!-- Stamp -->
  <image href="${STAMP_COMMITTED}" x="${stampX}" y="${stampY}"
    width="${stampSize}" height="${stampSize}" opacity="0.90"
    transform="rotate(8, ${stampX + stampSize / 2}, ${stampY + stampSize / 2})"/>

  <!-- Footer -->
  <rect x="0" y="${footerY}" width="${W}" height="22" fill="${t.footerBg}"/>
  <line x1="0" y1="${footerY}" x2="${W}" y2="${footerY}"
    stroke="${t.border}" stroke-width="0.8"/>
  <line x1="0.5" y1="4" x2="0.5" y2="${totalH}" stroke="${t.border}" stroke-width="1"/>
  <line x1="${W - 0.5}" y1="4" x2="${W - 0.5}" y2="${totalH}" stroke="${t.border}" stroke-width="1"/>
  <line x1="0" y1="${totalH - 0.5}" x2="${W}" y2="${totalH - 0.5}" stroke="${t.border}" stroke-width="1"/>
  <text x="${PAD}" y="${footerY + 14}" font-family="monospace" font-size="5"
    letter-spacing="1.5" fill="${t.accentDim}" opacity="0.8">THESEALER.XYZ</text>
  <text x="${W - PAD}" y="${footerY + 14}" font-family="monospace" font-size="5"
    letter-spacing="1.5" fill="${t.accentDim}" opacity="0.8" text-anchor="end">EAS · BASE · AMENDED</text>
</svg>`;

  return new NextResponse(svg, {
    status:  200,
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
  });
}