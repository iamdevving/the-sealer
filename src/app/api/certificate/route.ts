// src/app/api/certificate/route.ts
//
// Achievement Certificate — landscape SVG  660 × 430 px
// Light theme (#faf8f4). 3px claim-type coloured top border.
// Wax seal (BADGE_SEAL) in right column. Sealer mark (MARK_BLACK) top-left.
// Commitment text quoted with left accent border.
// Metrics grid (up to 6 cells, 3×2). Timeline row. Accent-coloured footer.
//
// Query params:
//   claimType       x402_payment_reliability | code_software_delivery |
//                   website_app_delivery | defi_trading_performance | social_media_growth
//   commitmentText  full commitment text
//   metrics         JSON: [{label,value,accent?}]  — up to 6 items
//   committedDate   Unix timestamp (s)
//   deadline        Unix timestamp (s)
//   achievedDate    Unix timestamp (s)
//   daysEarly       signed integer (negative = late)
//   agentId         full 0x… address
//   sid             SealerID contract address
//   txHash          EAS attestation tx hash
//   uid             EAS attestation UID (overrides txHash for display)
//   difficulty      0–100 integer (omit to hide from footer)
//   amended         'true' if commitment was amended
//   originalText    original commitment text before amendment

import { NextRequest, NextResponse } from 'next/server';
import { BADGE_SEAL, MARK_BLACK } from '@/lib/assets';

export const runtime = 'nodejs';

// ── Claim-type colour palette ─────────────────────────────────────────────────
const CLAIM_COLOURS: Record<string, string> = {
  x402_payment_reliability: '#0891B2',
  code_software_delivery:   '#059669',
  website_app_delivery:     '#7C3AED',
  defi_trading_performance: '#D97706',
  social_media_growth:      '#EA580C',
};

const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 · Payment Reliability',
  code_software_delivery:   'Code · Software Delivery',
  website_app_delivery:     'Website · App Delivery',
  defi_trading_performance: 'DeFi · Trading Performance',
  social_media_growth:      'Social · Media Growth',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shortHash(h: string): string {
  if (!h) return '0x????…????';
  const c = h.startsWith('0x') ? h : '0x' + h;
  return c.slice(0, 6) + '\u2026' + c.slice(-4);
}

function formatDate(ts: number | null): string {
  if (!ts) return '\u2014';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (lines.length >= maxLines - 1) {
        current = word + ' \u2026';
        break;
      }
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

// ── Layout constants ──────────────────────────────────────────────────────────
const W         = 660;
const H         = 430;
const HDR_H     = 44;
const SEAL_CX   = 576;
const SEAL_CY   = 210;
const SEAL_SIZE = 108;

const BG        = '#faf8f4';
const FOOTER_BG = '#f4f1eb';
const BORDER    = 'rgba(0,0,0,0.06)';
const LABEL_CLR = '#aaaaaa';
const BODY_CLR  = '#1a1a1a';
const MONO      = "'Courier New',Courier,monospace";
const SERIF     = "Georgia,'Times New Roman',serif";

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;

  const claimType      = sp.get('claimType') || 'x402_payment_reliability';
  const commitmentText = sp.get('commitmentText') || 'No commitment text provided.';
  const amended        = sp.get('amended') === 'true';
  const originalText   = sp.get('originalText') || '';
  const daysEarly      = parseInt(sp.get('daysEarly') || '0', 10);
  const agentId        = sp.get('agentId') || '0x????';
  const sid            = sp.get('sid')     || '\u2014';
  const txHash         = sp.get('txHash')  || '';
  const uid            = sp.get('uid')     || txHash;
  const difficultyRaw  = sp.get('difficulty');
  const difficulty     = difficultyRaw !== null ? parseInt(difficultyRaw, 10) : null;

  const committedDate = sp.get('committedDate') ? parseInt(sp.get('committedDate')!, 10) : null;
  const deadline      = sp.get('deadline')      ? parseInt(sp.get('deadline')!, 10)      : null;
  const achievedDate  = sp.get('achievedDate')  ? parseInt(sp.get('achievedDate')!, 10)  : null;

  let metricsRaw: Array<{ label: string; value: string; accent?: boolean }> = [];
  try { metricsRaw = JSON.parse(sp.get('metrics') || '[]'); } catch { /**/ }

  // ── Derived values ─────────────────────────────────────────────────────────
  const accent    = CLAIM_COLOURS[claimType] || '#0891B2';
  const claimLbl  = esc(CLAIM_LABELS[claimType] || claimType);
  const shortAttn = shortHash(uid || txHash);
  const shortAgt  = agentId.startsWith('0x')
    ? agentId.slice(0, 10) + '\u2026' + agentId.slice(-4) : esc(agentId);
  const shortSid  = sid.startsWith('0x')
    ? sid.slice(0, 10) + '\u2026' + sid.slice(-4) : esc(sid);

  // ── Commitment text ────────────────────────────────────────────────────────
  const CMT_Y     = HDR_H + 28;
  const cmtLines  = wrapText(commitmentText, 66, 4);
  const cmtLineH  = 21;
  const cmtTextH  = cmtLines.length * cmtLineH;
  const cmtBlockH = cmtTextH + 16;

  const cmtTspans = cmtLines.map((line, i) =>
    `<tspan x="46" dy="${i === 0 ? 0 : cmtLineH}">${esc(line)}</tspan>`
  ).join('');

  // Optional amended block
  const origLines     = amended ? wrapText(originalText, 60, 3) : [];
  const amendedBlockH = amended ? origLines.length * 14 + 22 : 0;
  const amendedBlock  = amended ? `
  <rect x="28" y="${CMT_Y + cmtBlockH + 8}" width="472" height="${amendedBlockH}"
    rx="2" fill="rgba(0,0,0,0.022)" stroke="${BORDER}" stroke-width="0.8"/>
  <text x="34" y="${CMT_Y + cmtBlockH + 20}" font-family="${MONO}" font-size="7"
    fill="${LABEL_CLR}" letter-spacing="1.5">AMENDED — ORIGINAL COMMITMENT:</text>
  ${origLines.map((l, i) =>
    `<text x="34" y="${CMT_Y + cmtBlockH + 32 + i * 14}" font-family="${SERIF}"
      font-size="10.5" font-style="italic" fill="${BODY_CLR}" opacity="0.45">${esc(l)}</text>`
  ).join('')}` : '';

  const afterCmt = CMT_Y + cmtBlockH + amendedBlockH + (amended ? 14 : 0);

  // ── Metrics grid  3×2 ─────────────────────────────────────────────────────
  const metricsY = afterCmt + 16;
  const CELL_W   = Math.floor(472 / 3);
  const CELL_H   = 36;
  const metrics  = [...metricsRaw.slice(0, 6)];
  while (metrics.length < 6) metrics.push({ label: '', value: '' });

  const metricCells = metrics.map((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx  = 28 + col * CELL_W;
    const cy  = metricsY + row * CELL_H;
    return `
    <text x="${cx + 8}" y="${cy + 13}" font-family="${MONO}" font-size="7.5"
      letter-spacing="1.5" fill="${LABEL_CLR}">${esc(m.label.toUpperCase())}</text>
    <text x="${cx + 8}" y="${cy + 28}" font-family="${MONO}" font-size="13" font-weight="600"
      fill="${m.accent ? accent : BODY_CLR}">${esc(m.value)}</text>`;
  }).join('');

  const metricGrid = `
  <rect x="28" y="${metricsY}" width="472" height="${CELL_H * 2}"
    rx="3" fill="${BG}" stroke="${BORDER}" stroke-width="0.8"/>
  <line x1="28" y1="${metricsY + CELL_H}" x2="500" y2="${metricsY + CELL_H}"
    stroke="${BORDER}" stroke-width="0.8"/>
  ${[1, 2].map(c =>
    `<line x1="${28 + c * CELL_W}" y1="${metricsY}" x2="${28 + c * CELL_W}"
      y2="${metricsY + CELL_H * 2}" stroke="${BORDER}" stroke-width="0.8"/>`
  ).join('')}
  ${metricCells}`;

  // ── Timeline ──────────────────────────────────────────────────────────────
  const timelineY = metricsY + CELL_H * 2 + 14;
  const TML_H     = 40;
  const TML_COL_W = Math.floor(472 / 4);

  const tlItems = [
    { label: 'Commitment Date', value: formatDate(committedDate) },
    { label: 'Deadline',        value: formatDate(deadline)      },
    { label: 'Achieved',        value: formatDate(achievedDate)  },
  ];

  const timelineRow = `
  <rect x="28" y="${timelineY}" width="472" height="${TML_H}"
    rx="3" stroke="${BORDER}" stroke-width="0.8" fill="rgba(0,0,0,0.018)"/>
  ${tlItems.map((item, i) => `
    <text x="${28 + i * TML_COL_W + 10}" y="${timelineY + 14}"
      font-family="${MONO}" font-size="7.5" letter-spacing="1.5" fill="${LABEL_CLR}">
      ${esc(item.label.toUpperCase())}</text>
    <text x="${28 + i * TML_COL_W + 10}" y="${timelineY + 30}"
      font-family="${MONO}" font-size="11" font-weight="600" fill="${BODY_CLR}">
      ${esc(item.value)}</text>
    ${i < 2
      ? `<line x1="${28 + (i + 1) * TML_COL_W}" y1="${timelineY + 5}"
             x2="${28 + (i + 1) * TML_COL_W}" y2="${timelineY + TML_H - 5}"
           stroke="${BORDER}" stroke-width="0.8"/>`
      : ''}
  `).join('')}
  <!-- Delta cell -->
  <rect x="${28 + 3 * TML_COL_W}" y="${timelineY}" width="${TML_COL_W}" height="${TML_H}"
    fill="${accent}" opacity="0.08" stroke="${BORDER}" stroke-width="0.8"/>
  <line x1="${28 + 3 * TML_COL_W}" y1="${timelineY}" x2="${28 + 3 * TML_COL_W}"
    y2="${timelineY + TML_H}" stroke="${accent}" stroke-width="0.6" opacity="0.35"/>
  <text x="${28 + 3 * TML_COL_W + TML_COL_W / 2}" y="${timelineY + 14}"
    font-family="${MONO}" font-size="7.5" letter-spacing="1.5" fill="${accent}" text-anchor="middle">
    ${daysEarly > 0 ? 'DAYS EARLY' : daysEarly < 0 ? 'DAYS LATE' : 'ON TIME'}
  </text>
  <text x="${28 + 3 * TML_COL_W + TML_COL_W / 2}" y="${timelineY + 31}"
    font-family="${MONO}" font-size="15" font-weight="700" fill="${accent}" text-anchor="middle">
    ${Math.abs(daysEarly) > 0 ? Math.abs(daysEarly) : '\u2014'}
  </text>`;

  // ── Footer ────────────────────────────────────────────────────────────────
  // 4 cells normally; 5 cells when difficulty is provided.
  const footerY   = H - 40;
  const footCells = [
    { label: 'Agent',           value: shortAgt  },
    { label: 'SID',             value: shortSid  },
    { label: 'EAS Attestation', value: shortAttn },
    { label: 'Network',         value: 'Base \u00B7 EAS' },
    ...(difficulty !== null
      ? [{ label: 'Difficulty', value: `${difficulty}/100` }]
      : []),
  ];
  const FOOT_COL_W = Math.floor(W / footCells.length);

  const footer = `
  <line x1="0" y1="${footerY}" x2="${W}" y2="${footerY}" stroke="${BORDER}" stroke-width="0.8"/>
  <rect x="0" y="${footerY}" width="${W}" height="${H - footerY}" fill="${FOOTER_BG}" rx="0"/>
  ${footCells.map((c, i) => `
    ${i > 0
      ? `<line x1="${i * FOOT_COL_W}" y1="${footerY + 5}"
             x2="${i * FOOT_COL_W}" y2="${H - 5}"
           stroke="${BORDER}" stroke-width="0.8"/>`
      : ''}
    <text x="${i * FOOT_COL_W + 14}" y="${footerY + 14}" font-family="${MONO}"
      font-size="7" letter-spacing="2" fill="${accent}" opacity="0.7">
      ${esc(c.label.toUpperCase())}</text>
    <text x="${i * FOOT_COL_W + 14}" y="${footerY + 28}" font-family="${MONO}"
      font-size="9" font-weight="600" fill="${accent}">${esc(c.value)}</text>
  `).join('')}`;

  // ── Seal column ───────────────────────────────────────────────────────────
  const sealCol = `
  <line x1="510" y1="${HDR_H + 14}" x2="510" y2="${footerY - 8}"
    stroke="${BORDER}" stroke-width="0.8"/>
  <image href="${BADGE_SEAL}"
    x="${SEAL_CX - SEAL_SIZE / 2}" y="${SEAL_CY - SEAL_SIZE / 2}"
    width="${SEAL_SIZE}" height="${SEAL_SIZE}"
    preserveAspectRatio="xMidYMid meet"
    style="filter:drop-shadow(0 3px 10px rgba(0,0,0,0.18))"/>
  <text x="${SEAL_CX}" y="${SEAL_CY + SEAL_SIZE / 2 + 16}" font-family="${MONO}"
    font-size="7.5" font-weight="600" letter-spacing="2"
    fill="${LABEL_CLR}" text-anchor="middle">OFFICIAL</text>
  <text x="${SEAL_CX}" y="${SEAL_CY + SEAL_SIZE / 2 + 28}" font-family="${MONO}"
    font-size="7.5" font-weight="600" letter-spacing="2"
    fill="${LABEL_CLR}" text-anchor="middle">SEAL</text>`;

  // ── Full SVG ──────────────────────────────────────────────────────────────
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">

  <!-- Card background -->
  <rect width="${W}" height="${H}" rx="4" ry="4" fill="${BG}"
    stroke="rgba(0,0,0,0.08)" stroke-width="1"/>

  <!-- Claim-type accent border — top 3 px -->
  <rect x="0" y="0" width="${W}" height="3" fill="${accent}"/>

  <!-- Header strip -->
  <line x1="0" y1="${HDR_H}" x2="${W}" y2="${HDR_H}" stroke="${BORDER}" stroke-width="0.8"/>

  <!-- Sealer mark -->
  <image href="${MARK_BLACK}" x="22" y="10" width="24" height="24"
    preserveAspectRatio="xMidYMid meet" opacity="0.85"/>

  <!-- Wordmark -->
  <text x="52" y="25" font-family="${MONO}" font-size="11" font-weight="600"
    letter-spacing="2" fill="${BODY_CLR}">The Sealer</text>

  <!-- Header right: claim type -->
  <text x="${W - 140}" y="20" font-family="${MONO}" font-size="9" font-weight="600"
    fill="${accent}" text-anchor="start" letter-spacing="1.5">${claimLbl}</text>

  <!-- ACHIEVED pill -->
  <rect x="${W - 122}" y="27" width="94" height="13" rx="6.5"
    fill="rgba(0,0,0,0)" stroke="${accent}" stroke-width="0.8"/>
  <circle cx="${W - 116}" cy="33.5" r="2.8" fill="${accent}"/>
  <text x="${W - 109}" y="37.5" font-family="${MONO}" font-size="7.5" font-weight="600"
    fill="${accent}" letter-spacing="2">ACHIEVED</text>

  <!-- COMMITMENT label -->
  <text x="28" y="${CMT_Y + 2}" font-family="${MONO}" font-size="8" font-weight="600"
    letter-spacing="2.5" fill="${LABEL_CLR}">COMMITMENT${amended ? ' (AMENDED)' : ''}</text>

  <!-- Left accent rule -->
  <rect x="28" y="${CMT_Y + 9}" width="2.5" height="${cmtTextH + 4}" fill="${accent}"/>

  <!-- Commitment text -->
  <text x="46" y="${CMT_Y + 9 + 17}" font-family="${SERIF}" font-size="14.5"
    font-style="italic" font-weight="500" fill="${BODY_CLR}">
    ${cmtTspans}
  </text>

  ${amendedBlock}

  <!-- VERIFIED METRICS label -->
  <text x="28" y="${metricsY - 7}" font-family="${MONO}" font-size="8" font-weight="600"
    letter-spacing="2.5" fill="${LABEL_CLR}">VERIFIED METRICS</text>

  ${metricGrid}

  ${timelineRow}

  ${sealCol}

  ${footer}

</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}