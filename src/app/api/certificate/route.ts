// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route v5
//
// v5 fixes:
//  - Issuer + category lines use accent colour (not grey)
//  - Agent strip: divider pushed right, commitment text auto-truncates
//    to two display lengths based on char count, centred in its column
//  - Metric rows: full width W-M; icons right-aligned inside row
//  - Columns rebalanced across full row width
//  - Score blocks: all text+number centred in block (text-anchor middle)
//    Numbers use Courier Prime so decimal sizes stay consistent
//  - Wax seal PNG in header for FULL + PARTIAL; FAILED = no seal, plain header
//  - FAILED stamp retains inline sad-seal SVG
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE } from '@/lib/assets';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.thesealer.xyz';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetricResult {
  label:    string;
  weight:   number;
  target:   number;
  achieved: number;
  unit?:    string;
}

interface CertificateParams {
  agentId:         string;
  commitmentId:    string;
  commitmentText:  string;
  claimType:       string;
  metrics:         MetricResult[];
  difficultyScore: number;
  deadlineDays:    number;
  daysEarly:       number;
  closedEarly:     boolean;
  issuedAt:        string;
  periodStart:     string;
  periodEnd:       string;
  uid:             string;
}

type BadgeTier = 'gold' | 'silver' | 'bronze' | 'none';
type CertState = 'full' | 'partial' | 'failed';

const SEAL_URLS: Record<CertState, string> = {
  full:    `${BASE_URL}/seals/fully-achieved.png`,
  partial: `${BASE_URL}/seals/partially-achieved.png`,
  failed:  '',
};

interface PerMetricResult extends MetricResult {
  ratio:     number;
  perScore:  number;
  met:       boolean;
  over:      boolean;
  delta:     number;
  defaulted: boolean;
}

interface ScoringResult {
  state:              CertState;
  achievementScore:   number;
  proofPoints:        number;
  badgeTier:          BadgeTier;
  perMetric:          PerMetricResult[];
  deadlineAdj:        number;
  baseScore:          number;
  hasOverachievement: boolean;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

const EXP_OVER  = 0.7;
const EXP_UNDER = 1.5;

function deadlineMultiplier(days: number): number {
  if (days <= 7)  return 1.0;
  if (days <= 30) return 1.0 + (0.15 * (days - 7) / 23);
  if (days <= 90) return 1.15 + (0.20 * (days - 30) / 60);
  return 1.35;
}

function r1(n: number): number { return Math.round(n * 10) / 10; }

function computeScoring(p: CertificateParams): ScoringResult {
  const dlMult   = deadlineMultiplier(p.deadlineDays);
  const bonusCap = 10 * Math.pow(1.0 / dlMult, 3);

  const perMetric: PerMetricResult[] = p.metrics.map(m => {
    const defaulted = m.achieved === 0 && p.closedEarly;
    const ratio     = defaulted ? 0 : m.achieved / m.target;
    const exp       = ratio >= 1.0 ? EXP_OVER : EXP_UNDER;
    const perScore  = defaulted ? 0 : Math.pow(ratio, exp);
    return { ...m, ratio, perScore, met: ratio >= 1.0, over: ratio > 1.0, delta: m.achieved - m.target, defaulted };
  });

  const baseScore = 100 * perMetric.reduce((s, m) => s + m.weight * m.perScore, 0);

  const earlyBonus = perMetric
    .filter(m => !m.defaulted && m.met && p.daysEarly > 0)
    .reduce((s, m) => s + m.weight * (p.daysEarly / p.deadlineDays) * bonusCap, 0);

  const defaultPenalty = perMetric
    .filter(m => m.defaulted)
    .reduce((s, m) => s + m.weight * 5, 0);

  const deadlineAdj      = earlyBonus - defaultPenalty;
  const achievementScore = Math.max(0, baseScore + deadlineAdj);
  const proofPoints      = (achievementScore * p.difficultyScore) / 100;

  const metCount = perMetric.filter(m => m.met).length;
  const state: CertState =
    metCount === 0              ? 'failed'  :
    metCount < perMetric.length ? 'partial' : 'full';

  const badgeTier: BadgeTier =
    achievementScore < 40 ? 'none'   :
    achievementScore < 70 ? 'bronze' :
    achievementScore < 90 ? 'silver' : 'gold';

  return {
    state,
    achievementScore:   r1(achievementScore),
    proofPoints:        r1(proofPoints),
    badgeTier,
    perMetric,
    deadlineAdj:        r1(deadlineAdj),
    baseScore:          r1(baseScore),
    hasOverachievement: perMetric.some(m => m.over),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVal(val: number, unit?: string): string {
  if (!unit)        return String(r1(val));
  if (unit === '$') return `$${Math.round(val).toLocaleString()}`;
  if (unit === '%') return `${r1(val)}%`;
  return `${r1(val)} ${unit}`;
}

function fmtDelta(m: PerMetricResult): string {
  if (m.defaulted) return 'Defaulted';
  if (!m.met)      return `\u2212${fmtVal(Math.abs(m.delta), m.unit)}`;
  if (m.over)      return `+${fmtVal(m.delta, m.unit)}`;
  return 'On target';
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Truncate commitment text to fit single line in agent strip
function truncateCommitment(text: string, maxChars = 90): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\u2026' : text;
}

// ── Inline sad-face SVG (FAILED stamp only) ───────────────────────────────────

const SAD_SEAL = `<svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" opacity="0.8">
  <circle cx="20" cy="20" r="18" fill="none" stroke="#c03030" stroke-width="2"/>
  <circle cx="13" cy="16" r="2"  fill="#c03030"/>
  <circle cx="27" cy="16" r="2"  fill="#c03030"/>
  <path d="M 13,27 Q 20,22 27,27" fill="none" stroke="#c03030" stroke-width="1.8" stroke-linecap="round"/>
  <line x1="2"  y1="19" x2="11" y2="20" stroke="#c03030" stroke-width="1" opacity="0.6"/>
  <line x1="2"  y1="22" x2="11" y2="22" stroke="#c03030" stroke-width="1" opacity="0.6"/>
  <line x1="29" y1="20" x2="38" y2="19" stroke="#c03030" stroke-width="1" opacity="0.6"/>
  <line x1="29" y1="22" x2="38" y2="22" stroke="#c03030" stroke-width="1" opacity="0.6"/>
</svg>`;

// ── Theme ─────────────────────────────────────────────────────────────────────

const THEME = {
  full: {
    hdr:       '#2d1f0e',
    accent:    '#c9a84c',
    accentDim: '#b8964a',
    titleCol:  '#f0e8d0',
    metaLabel: '#6a5030', metaVal: '#c0a870', uidCol: '#6a5030',
    agentBg:   '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg:    '#f0ebe0', footBdr:  '#e0d8c0',
    gradL:     '#1a1200', gradM:    '#c9a84c', frameBdr: '#c9a84c',
    scoreBg:   '#2d1f0e', scoreBdr: '#c9a84c', scoreNum: '#c9a84c', scoreLbl: '#c9a84c',
    metaStatus:'VERIFIED',
    subCol:    '#c9a84c',
  },
  partial: {
    hdr:       '#2d1f0e',
    accent:    '#c9a84c',
    accentDim: '#b8964a',
    titleCol:  '#f0e8d0',
    metaLabel: '#6a5030', metaVal: '#c0a870', uidCol: '#6a5030',
    agentBg:   '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg:    '#f0ebe0', footBdr:  '#e0d8c0',
    gradL:     '#0a0a12', gradM:    '#7a9aaa', frameBdr: '#7a9aaa',
    scoreBg:   '#0a1a28', scoreBdr: '#6a9aaa', scoreNum: '#cd9060', scoreLbl: '#6a9aaa',
    metaStatus:'VERIFIED',
    subCol:    '#6a9aaa',
  },
  failed: {
    hdr:       '#1a0808',
    accent:    '#c04040',
    accentDim: '#8a3030',
    titleCol:  '#e8c0c0',
    metaLabel: '#6a2020', metaVal: '#c08080', uidCol: '#6a2020',
    agentBg:   '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a',
    footBg:    '#fdf0f0', footBdr:  '#e8d0d0',
    gradL:     '#1a0808', gradM:    '#8a2020', frameBdr: '#8a2020',
    scoreBg:   '#1a0808', scoreBdr: '#8a2020', scoreNum: '#e05050', scoreLbl: '#c04040',
    metaStatus:'CLOSED',
    subCol:    '#c04040',
  },
};

const BADGE_COLOR: Record<BadgeTier, string> = {
  gold: '#c9a84c', silver: '#a0a8b0', bronze: '#cd9060', none: '#888',
};

// ── SVG Builder ───────────────────────────────────────────────────────────────

function buildSVG(p: CertificateParams, s: ScoringResult): string {
  const t   = THEME[s.state];
  const W   = 660;
  const M   = 24;   // left/right margin

  // ── Header layout ────────────────────────────────────────────────────────────
  // FULL/PARTIAL: wax seal PNG 76×76 on right, meta left of seal
  // FAILED: no seal, meta right-aligned to W-M
  const HAS_SEAL = s.state !== 'failed';
  const SEAL_W   = 76;
  const SEAL_X   = W - M - SEAL_W;               // = 560
  const SEAL_Y   = 5 + 4;                         // 4px from top of header
  const HDR_H    = SEAL_W + 8;                    // header height = seal + padding = 84
  const META_X   = HAS_SEAL ? SEAL_X - 12 : W - M;

  // ── Vertical layout ──────────────────────────────────────────────────────────
  const AGENT_Y  = HDR_H + 5;
  const AGENT_H  = 42;
  const TABLE_Y  = AGENT_Y + AGENT_H;
  const COL_HDR_H = 24;
  const ROW_H    = 38;
  const ROWS_TOP = TABLE_Y + COL_HDR_H;

  // ── Score block geometry ─────────────────────────────────────────────────────
  // 4 blocks, gap=6, from M to W-M (total = 612px)
  const GAP  = 6;
  const SW1  = 220;                            // Achievement (wider, dark)
  const SW23 = 116;                            // Difficulty + ProofPoints
  const SW4  = W - M - M - SW1 - SW23 * 2 - GAP * 3;  // Badge (remaining ≈ 138)
  const SX1  = M;
  const SX2  = SX1 + SW1 + GAP;
  const SX3  = SX2 + SW23 + GAP;
  const SX4  = SX3 + SW23 + GAP;
  const SH   = 76;                             // block height — generous

  // ── Metric rows: full width, icon inside row on far right ────────────────────
  const ROW_W   = W - M - M;    // 612px full width
  const ICON_X  = W - M - 14;  // icon centre, right-aligned inside row

  // Column centres — distributed across full row width (M..W-M), icon area excluded
  // Usable label area: M+12 .. ICON_X-30
  // Metric label: left-aligned from M+12
  // Weight: 202, Target: 298, Achieved: 400, Delta: 510
  const CW = 205;
  const CT = 302;
  const CA = 404;
  const CD = 508;

  // ── Metric rows ──────────────────────────────────────────────────────────────
  const metricRows = s.perMetric.map((m, i) => {
    const y      = ROWS_TOP + i * ROW_H;
    const isFail = s.state === 'failed';
    const rowBg  = m.met ? '#f2f8f0' : (isFail ? '#faf0f0' : '#fdf5f0');
    const rowBdr = m.met ? '#c8dcc0' : (isFail ? '#e0c0c0' : '#e8c8b0');
    const achClr = m.met ? (m.over ? '#1a5040' : '#2a6030') : '#8a3020';
    const dClr   = m.over ? '#1a6050' : (m.met ? '#2a6030' : '#9a2010');
    const iconClr = m.met ? '#2a7040' : '#c03030';

    // Refined SVG check / cross, centred at ICON_X
    const iconMark = m.met
      ? `<path d="M${ICON_X-6},${y+ROW_H/2-1} L${ICON_X-1},${y+ROW_H/2+5} L${ICON_X+7},${y+ROW_H/2-7}"
           fill="none" stroke="${iconClr}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<line x1="${ICON_X-6}" y1="${y+ROW_H/2-6}" x2="${ICON_X+6}" y2="${y+ROW_H/2+6}" stroke="${iconClr}" stroke-width="2" stroke-linecap="round"/>
         <line x1="${ICON_X+6}" y1="${y+ROW_H/2-6}" x2="${ICON_X-6}" y2="${y+ROW_H/2+6}" stroke="${iconClr}" stroke-width="2" stroke-linecap="round"/>`;

    const overPill = m.over ? `
  <rect x="${CD-38}" y="${y+20}" width="76" height="12" rx="2" fill="none" stroke="#a0d0b0" stroke-width="0.6"/>
  <text x="${CD}" y="${y+29}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2191 Overachieved</text>` : '';

    return `
  <rect x="${M}" y="${y}" width="${ROW_W}" height="${ROW_H-3}" rx="3" fill="${rowBg}" stroke="${rowBdr}" stroke-width="0.6"/>
  <text x="${M+12}" y="${y+13}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="1.5" fill="#3a2a10">${esc(m.label.toUpperCase())}</text>
  <text x="${M+12}" y="${y+25}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${Math.round(m.weight*100)}% weight</text>
  <text x="${CW}"   y="${y+22}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="#6a5030" text-anchor="middle">${Math.round(m.weight*100)}%</text>
  <text x="${CT}"   y="${y+22}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="#6a5030" text-anchor="middle">${esc(fmtVal(m.target, m.unit))}</text>
  <text x="${CA}"   y="${y+22}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="${achClr}" text-anchor="middle">${m.defaulted ? '\u2014' : esc(fmtVal(m.achieved, m.unit))}</text>
  <text x="${CD}"   y="${y+17}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" fill="${dClr}" text-anchor="middle">${esc(fmtDelta(m))}</text>
  ${overPill}
  ${iconMark}`;
  }).join('');

  // ── Score block helper: centred layout ───────────────────────────────────────
  const scoresY = ROWS_TOP + s.perMetric.length * ROW_H + 12;
  const svgH    = scoresY + SH + 10 + 36;

  // All score blocks: label at top, number centred, sub at bottom — all middle-anchored
  function scoreBlock(
    x: number, w: number,
    bg: string, bdr: string,
    label: string, numStr: string, numCol: string, lblCol: string,
    sub: string,
  ): string {
    const cx = x + w / 2;
    return `
  <rect x="${x}" y="${scoresY}" width="${w}" height="${SH}" rx="3" fill="${bg}" stroke="${bdr}" stroke-width="0.6"/>
  <text x="${cx}" y="${scoresY + 14}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3"
        fill="${lblCol}" opacity="0.75">${label}</text>
  <text x="${cx}" y="${scoresY + 50}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="30" font-weight="700"
        fill="${numCol}">${numStr}</text>
  <text x="${cx}" y="${scoresY + 65}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="5.5"
        fill="${lblCol}" opacity="0.55">${sub}</text>`;
  }

  // ── FAILED stamp ─────────────────────────────────────────────────────────────
  const stampCY  = ROWS_TOP + (s.perMetric.length * ROW_H) / 2 + 4;
  const stampCX  = M + ROW_W / 2;
  const failedStamp = s.state === 'failed' ? `
  <g transform="translate(${stampCX},${stampCY}) rotate(-4)">
    <rect x="-116" y="-32" width="232" height="66" rx="3"
          fill="rgba(250,240,240,0.92)" stroke="#c03030" stroke-width="3.5" opacity="0.86"/>
    <g transform="translate(-77,1)">${SAD_SEAL}</g>
    <text x="26" y="-7"  text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7"
          fill="#c03030" opacity="0.84">FAILED</text>
    <text x="26" y="14"  text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="6" letter-spacing="2"
          fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
  </g>` : '';

  const gradId = `grad_${s.state}`;

  // Sub-title text per state
  const subTitle =
    s.state === 'full'    ? '\u2605 FULLY ACHIEVED \u00B7 ALL METRICS MET' :
    s.state === 'partial' ? `\u25D1 PARTIALLY ACHIEVED \u00B7 ${s.perMetric.filter(m => m.met).length} OF ${s.perMetric.length} METRICS MET` :
                            '\u2717 FAILED \u00B7 NO METRICS MET AT DEADLINE';

  // Commitment text — adaptive truncation
  const commitDisplay = truncateCommitment(p.commitmentText);

  // Agent strip: divider at x=232 (gives ~400px for commitment text)
  const DIVIDER_X = 232;
  const COMMIT_X  = DIVIDER_X + 18;
  const COMMIT_W  = W - COMMIT_X - M;
  const COMMIT_CX = COMMIT_X + COMMIT_W / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${svgH}" viewBox="0 0 ${W} ${svgH}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <style>@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&amp;family=Courier+Prime:wght@400;700&amp;family=IM+Fell+English:ital@0;1&amp;display=swap');</style>
  <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%"   stop-color="${t.gradL}"/>
    <stop offset="30%"  stop-color="${t.gradM}"/>
    <stop offset="65%"  stop-color="${t.gradM}" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="${t.gradL}"/>
  </linearGradient>
</defs>

<!-- Background -->
<rect width="${W}" height="${svgH}" fill="#faf8f0"/>

<!-- Decorative frame -->
<rect x="-4" y="-4" width="${W+8}" height="${svgH+8}" rx="6" fill="none" stroke="${t.frameBdr}" stroke-width="1" opacity="0.4"/>
<rect x="-1" y="-1" width="${W+2}" height="${svgH+2}" rx="5" fill="none" stroke="${t.frameBdr}" stroke-width="0.5" opacity="0.25"/>

<!-- Top accent bar -->
<rect x="0" y="0" width="${W}" height="5" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="${HDR_H}" fill="${t.hdr}"/>

<!-- Logo mark top-right corner -->
<image href="${MARK_WHITE}" x="${W-40}" y="10" width="18" height="18" opacity="0.6"/>

<!-- Issuer — accent colour -->
<text x="${M}" y="23" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4"
      fill="${t.accent}">THE SEALER PROTOCOL</text>

<!-- Title -->
<text x="${M}" y="45" font-family="Cormorant Garamond,serif" font-size="20" font-weight="600" letter-spacing="1"
      fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>

<!-- Wax seal — FULL/PARTIAL only -->
${HAS_SEAL ? `<image href="${SEAL_URLS[s.state]}" x="${SEAL_X}" y="${SEAL_Y}" width="${SEAL_W}" height="${SEAL_W}" opacity="0.93" preserveAspectRatio="xMidYMid meet"/>` : ''}

<!-- Category — accent dim colour -->
<text x="${M}" y="58" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2.5"
      fill="${t.accentDim}">CATEGORY: ${esc(p.claimType.replace(/_/g, ' ').toUpperCase())}</text>

<!-- State subtitle — accent colour -->
<text x="${M}" y="71" font-family="Courier Prime,monospace" font-size="6" letter-spacing="3"
      fill="${t.accent}" opacity="0.85">${subTitle}</text>

<!-- Right meta (left of seal for FULL/PARTIAL, right-flush for FAILED) -->
<text x="${META_X}" y="36" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="${t.metaLabel}" text-anchor="end">${t.metaStatus}</text>
<text x="${META_X}" y="48" font-family="Courier Prime,monospace" font-size="6.5" fill="${t.metaVal}"   text-anchor="end">${esc(p.issuedAt)}</text>
<text x="${META_X}" y="59" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.uidCol}"    text-anchor="end">UID: ${p.uid.slice(0,6)}\u2026${p.uid.slice(-4)}</text>

<!-- ══ AGENT STRIP ══ -->
<rect x="0" y="${AGENT_Y}" width="${W}" height="${AGENT_H}" fill="${t.agentBg}"/>
<line x1="0" y1="${AGENT_Y}"            x2="${W}" y2="${AGENT_Y}"            stroke="${t.agentBdr}" stroke-width="0.6"/>
<line x1="0" y1="${AGENT_Y + AGENT_H}"  x2="${W}" y2="${AGENT_Y + AGENT_H}"  stroke="${t.agentBdr}" stroke-width="0.6"/>

<!-- Agent ID -->
<text x="${M}"   y="${AGENT_Y + 13}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" fill="#9a8050">AGENT ID</text>
<text x="${M}"   y="${AGENT_Y + 28}" font-family="Courier Prime,monospace" font-size="8"  font-weight="700"    fill="#1a1000">${esc(p.agentId.slice(0,6))}\u2026${esc(p.agentId.slice(-4))}</text>

<line x1="122" y1="${AGENT_Y + 6}" x2="122" y2="${AGENT_Y + AGENT_H - 6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<!-- Commitment ID -->
<text x="134"  y="${AGENT_Y + 13}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" fill="#9a8050">COMMITMENT ID</text>
<text x="134"  y="${AGENT_Y + 28}" font-family="Courier Prime,monospace" font-size="7"  font-weight="700"    fill="#1a1000">${esc(p.commitmentId.slice(0,6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="${DIVIDER_X}" y1="${AGENT_Y + 6}" x2="${DIVIDER_X}" y2="${AGENT_Y + AGENT_H - 6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<!-- Commitment text — centred in remaining width, auto-truncated -->
<text x="${COMMIT_CX}" y="${AGENT_Y + 24}" text-anchor="middle"
      font-family="IM Fell English,Georgia,serif" font-size="9" font-style="italic"
      fill="${t.agentTxt}" opacity="0.85"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(commitDisplay)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<line x1="${M}" y1="${TABLE_Y + 4}"              x2="${W-M}" y2="${TABLE_Y + 4}"              stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${M+12}"   y="${TABLE_Y + 17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050">METRIC</text>
<text x="${CW}"     y="${TABLE_Y + 17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">WEIGHT</text>
<text x="${CT}"     y="${TABLE_Y + 17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">TARGET</text>
<text x="${CA}"     y="${TABLE_Y + 17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">ACHIEVED</text>
<text x="${CD}"     y="${TABLE_Y + 17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">DELTA</text>
<line x1="${M}" y1="${TABLE_Y + COL_HDR_H - 2}" x2="${W-M}" y2="${TABLE_Y + COL_HDR_H - 2}" stroke="#e0d8c0" stroke-width="0.6"/>

${metricRows}

<!-- FAILED stamp -->
${failedStamp}

<!-- ══ SCORES ══ -->
${scoreBlock(SX1, SW1, t.scoreBg, t.scoreBdr, 'ACHIEVEMENT SCORE', String(s.achievementScore), t.scoreNum, t.scoreLbl,
  s.hasOverachievement ? `Base ${s.baseScore} + overachievement` :
  s.deadlineAdj !== 0  ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
  s.state === 'failed' ? 'No metrics met' : 'Clean delivery'
)}

${scoreBlock(SX2, SW23, '#f5f0e4', '#e0d8c0', 'DIFFICULTY', String(p.difficultyScore), '#6a5030', '#9a8050',
  s.state === 'failed' ? 'Committed (locked)' : 'Committed difficulty'
)}

${scoreBlock(SX3, SW23, '#f5f0e4', '#e0d8c0', 'PROOF POINTS', String(s.proofPoints), '#6a5030', '#9a8050',
  s.state === 'failed' ? 'No award' : 'Score \u00D7 Difficulty'
)}

<!-- Badge block — centred content -->
<rect x="${SX4}" y="${scoresY}" width="${SW4}" height="${SH}" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${SX4 + SW4/2}" y="${scoresY + 14}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050">ACHIEVEMENT BADGE</text>
${s.badgeTier !== 'none' ? `
<rect x="${SX4 + 12}" y="${scoresY + 22}" width="${SW4 - 24}" height="20" rx="2"
      fill="${BADGE_COLOR[s.badgeTier]}" fill-opacity="0.14" stroke="${BADGE_COLOR[s.badgeTier]}" stroke-width="0.7"/>
<text x="${SX4 + SW4/2}" y="${scoresY + 35}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="9" font-weight="700" letter-spacing="2"
      fill="${BADGE_COLOR[s.badgeTier]}">${s.badgeTier.toUpperCase()}</text>
<text x="${SX4 + SW4/2}" y="${scoresY + 57}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" fill="#9a7050">From achievement score</text>
` : `
<text x="${SX4 + SW4/2}" y="${scoresY + 42}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="7" letter-spacing="1" fill="#9a2010">NOT ISSUED</text>
`}
${p.daysEarly > 0 ? `
<rect x="${SX4 + 12}" y="${scoresY + 56}" width="${SW4 - 24}" height="13" rx="2" fill="#f0f8f0" stroke="#80b890" stroke-width="0.6"/>
<text x="${SX4 + SW4/2}" y="${scoresY + 66}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030">\u2713 ${p.daysEarly} days early</text>` : ''}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH - 36}" width="${W}" height="36" fill="${t.footBg}"/>
<line x1="0" y1="${svgH - 36}" x2="${W}" y2="${svgH - 36}" stroke="${t.footBdr}" stroke-width="0.6"/>
<text x="${M}"  y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="${M}"  y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.issuedAt)}</text>
<text x="150"   y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="150"   y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>
<text x="320"   y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="320"   y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>
<text x="${W-M}" y="${svgH-20}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">THESEALER.XYZ</text>
<text x="${W-M}" y="${svgH-10}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">EAS \u00B7 BASE</text>

</svg>`;
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  let metrics: MetricResult[] = [];
  try { metrics = JSON.parse(sp.get('metrics') ?? '[]'); } catch { metrics = []; }

  if (metrics.length === 0) {
    metrics = [
      { label: 'Success Rate',   weight: 0.60, target: 97,  achieved: 99.2, unit: '%' },
      { label: 'Payment Volume', weight: 0.25, target: 500, achieved: 820,  unit: '$' },
      { label: 'Active Window',  weight: 0.15, target: 30,  achieved: 30 },
    ];
  }

  const params: CertificateParams = {
    agentId:         sp.get('agentId')      ?? '0x4386606286eEA12150386f0CFc55959F30de00D1',
    commitmentId:    sp.get('commitmentId') ?? '0xdeadbeef00000000',
    commitmentText:  sp.get('commitment')   ?? 'I commit to maintaining reliable agent performance across all transactions.',
    claimType:       sp.get('claimType')    ?? 'x402_payment_reliability',
    metrics,
    difficultyScore: Number(sp.get('difficulty')   ?? 68),
    deadlineDays:    Number(sp.get('deadlineDays') ?? 30),
    daysEarly:       Number(sp.get('daysEarly')    ?? 0),
    closedEarly:     sp.get('closedEarly') === 'true',
    issuedAt:    sp.get('issuedAt')    ?? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    periodStart: sp.get('periodStart') ?? 'Feb 9 2026',
    periodEnd:   sp.get('periodEnd')   ?? 'Mar 11 2026',
    uid:         sp.get('uid')         ?? '0x' + '0'.repeat(64),
  };

  const score = computeScoring(params);
  const svg   = buildSVG(params, score);

  return new NextResponse(svg, {
    headers: {
      'Content-Type':  'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}