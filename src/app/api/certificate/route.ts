// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route v6
//
// v6 fixes:
//  - Wax seal: use crossorigin <image> with absolute URL + clip-path circle
//    to avoid broken-image rendering. FULL/PARTIAL only.
//  - Commitment text: adaptive font-size based on char length (9→8→7pt)
//  - Column headers + metric labels + score labels: bolder (font-weight 700)
//  - Sub-label under metric name REMOVED (redundant with weight col)
//  - Score sub-lines: font-size 6.5 (was 5.5), score number: Cormorant 34pt
//  - Badge block: "From achievement score" moved up, daysEarly pill below it
//    without overlap
//  - Check/cross icon: pulled left to CD+80 area (not far right edge)
//    Columns rebalanced: CW=200 CT=295 CA=390 CD=475 ICON=560
//  - Icon upgraded: checkmark inside circle for met, X inside circle for not
//  - PARTIAL theme: accent=silver (#a8b4c0), so header text/lines are silver
//  - Achievement score dark block: label+sub use neutral cream, only NUMBER
//    mirrors tier colour
//  - FAILED stamp: uses wax seal PNG via <image> instead of inline SVG emoji
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
  failed:  `${BASE_URL}/seals/failed-seal.png`,
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
    return { ...m, ratio, perScore, met: ratio >= 1.0, over: ratio > 1.0,
             delta: m.achieved - m.target, defaulted };
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

// Adaptive font size for commitment text based on character length
function commitFontSize(text: string): number {
  if (text.length <= 55) return 10;
  if (text.length <= 75) return 9;
  if (text.length <= 90) return 8;
  return 7;
}

function truncateCommitment(text: string, maxChars = 100): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\u2026' : text;
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// accent      = header text colour (issuer, category, subtitle lines)
// scoreNumCol = big number in achievement score block (mirrors tier)
// scoreLbl    = label + sub-text in achievement block (neutral, not tier-coloured)

const THEME = {
  full: {
    hdr:        '#2d1f0e',
    accent:     '#c9a84c',   // gold
    accentDim:  '#b8964a',
    titleCol:   '#f0e8d0',
    metaLabel:  '#6a5030', metaVal: '#c0a870', uidCol: '#6a5030',
    agentBg:    '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg:     '#f0ebe0', footBdr: '#e0d8c0',
    gradL:      '#1a1200', gradM: '#c9a84c', frameBdr: '#c9a84c',
    scoreBg:    '#2d1f0e', scoreBdr: '#c9a84c',
    scoreNumCol:'#c9a84c',   // gold number
    scoreLbl:   '#c9a870',   // warm cream — neutral label colour in dark block
    metaStatus: 'VERIFIED',
  },
  partial: {
    hdr:        '#1e2430',   // dark slate — distinct from full
    accent:     '#a8b4c0',   // silver
    accentDim:  '#8a9aaa',
    titleCol:   '#dce8f0',
    metaLabel:  '#607080', metaVal: '#98aabb', uidCol: '#607080',
    agentBg:    '#f0f4f8', agentBdr: '#d0dce8', agentTxt: '#202c3a',
    footBg:     '#eef2f6', footBdr: '#d0dce8',
    gradL:      '#0a1018', gradM: '#a8b4c0', frameBdr: '#a8b4c0',
    scoreBg:    '#1e2430', scoreBdr: '#a8b4c0',
    scoreNumCol:'#a0a8b8',   // silver number
    scoreLbl:   '#8898a8',   // muted slate label
    metaStatus: 'VERIFIED',
  },
  failed: {
    hdr:        '#1a0808',
    accent:     '#c04040',
    accentDim:  '#8a3030',
    titleCol:   '#e8c0c0',
    metaLabel:  '#6a2020', metaVal: '#c08080', uidCol: '#6a2020',
    agentBg:    '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a',
    footBg:     '#fdf0f0', footBdr: '#e8d0d0',
    gradL:      '#1a0808', gradM: '#8a2020', frameBdr: '#8a2020',
    scoreBg:    '#1a0808', scoreBdr: '#8a2020',
    scoreNumCol:'#e05050',
    scoreLbl:   '#c08080',
    metaStatus: 'CLOSED',
  },
};

const BADGE_COLOR: Record<BadgeTier, string> = {
  gold: '#c9a84c', silver: '#a0a8b8', bronze: '#cd9060', none: '#888',
};

// ── SVG Builder ───────────────────────────────────────────────────────────────

function buildSVG(p: CertificateParams, s: ScoringResult): string {
  const t   = THEME[s.state];
  const W   = 660;
  const M   = 24;

  // ── Header ───────────────────────────────────────────────────────────────────
  const HAS_SEAL = s.state !== 'failed';
  const SEAL_W   = 74;
  const SEAL_X   = W - M - SEAL_W;    // 562
  const SEAL_Y   = 9;                  // from top of header (after 5px accent bar)
  const HDR_H    = 84;
  const META_X   = HAS_SEAL ? SEAL_X - 14 : W - M;

  // ── Vertical layout ──────────────────────────────────────────────────────────
  const AGENT_Y   = HDR_H + 5;
  const AGENT_H   = 44;
  const TABLE_Y   = AGENT_Y + AGENT_H;
  const COL_HDR_H = 24;
  const ROW_H     = 38;
  const ROWS_TOP  = TABLE_Y + COL_HDR_H;

  // ── Metric columns ────────────────────────────────────────────────────────────
  // Layout: M+12 left-label | CW weight | CT target | CA achieved | CD delta | ICON_X icon
  // Row width = W - 2*M = 612px
  // Icon at x=570 (inside row, not flush to edge), giving delta col more room
  const ROW_W  = W - M - M;   // 612
  const ICON_X = 566;          // circle icon centre
  const CW = 200;
  const CT = 295;
  const CA = 392;
  const CD = 484;

  // ── Score blocks ──────────────────────────────────────────────────────────────
  const GAP  = 6;
  const SW1  = 218;
  const SW23 = 116;
  const SW4  = W - M - M - SW1 - SW23 * 2 - GAP * 3;  // ~140
  const SX1  = M;
  const SX2  = SX1 + SW1 + GAP;
  const SX3  = SX2 + SW23 + GAP;
  const SX4  = SX3 + SW23 + GAP;
  const SH   = 80;

  // Y positions inside score block
  const scoresY = ROWS_TOP + s.perMetric.length * ROW_H + 12;
  const svgH    = scoresY + SH + 10 + 36;
  const S_LBL_Y = scoresY + 15;    // section label
  const S_NUM_Y = scoresY + 52;    // big number baseline
  const S_SUB_Y = scoresY + 68;    // sub-line

  // ── Icon: filled circle with check or X ───────────────────────────────────────
  function metricIcon(met: boolean, y: number): string {
    const cy   = y + ROW_H / 2 - 1;
    const r    = 8;
    if (met) {
      // Green filled circle + white checkmark path
      return `
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="#2a7040" opacity="0.15"/>
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="none" stroke="#2a7040" stroke-width="1.4"/>
  <path d="M${ICON_X-4},${cy+0} L${ICON_X-1},${cy+4} L${ICON_X+5},${cy-5}"
        fill="none" stroke="#2a7040" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      return `
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="#c03030" opacity="0.1"/>
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="none" stroke="#c03030" stroke-width="1.4"/>
  <line x1="${ICON_X-4}" y1="${cy-4}" x2="${ICON_X+4}" y2="${cy+4}" stroke="#c03030" stroke-width="1.8" stroke-linecap="round"/>
  <line x1="${ICON_X+4}" y1="${cy-4}" x2="${ICON_X-4}" y2="${cy+4}" stroke="#c03030" stroke-width="1.8" stroke-linecap="round"/>`;
    }
  }

  // ── Metric rows ──────────────────────────────────────────────────────────────
  const metricRows = s.perMetric.map((m, i) => {
    const y      = ROWS_TOP + i * ROW_H;
    const isFail = s.state === 'failed';
    const rowBg  = m.met ? '#f2f8f0' : (isFail ? '#faf0f0' : '#fdf5f0');
    const rowBdr = m.met ? '#c8dcc0' : (isFail ? '#e0c0c0' : '#e8c8b0');
    const achClr = m.met ? (m.over ? '#1a5040' : '#2a6030') : '#8a3020';
    const dClr   = m.over ? '#1a6050' : (m.met ? '#2a6030' : '#9a2010');

    const overPill = m.over ? `
  <rect x="${CD-38}" y="${y+20}" width="76" height="12" rx="2" fill="none" stroke="#a0d0b0" stroke-width="0.6"/>
  <text x="${CD}" y="${y+29}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2191 Overachieved</text>` : '';

    // Delta: centre vertically — if over-pill shown, push delta text up more
    const deltaY = m.over ? y + 16 : y + ROW_H / 2 + 2;

    return `
  <rect x="${M}" y="${y}" width="${ROW_W}" height="${ROW_H-3}" rx="3" fill="${rowBg}" stroke="${rowBdr}" stroke-width="0.6"/>
  <text x="${M+12}" y="${y+ROW_H/2+2}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="1.5" fill="#3a2a10">${esc(m.label.toUpperCase())}</text>
  <text x="${CW}"   y="${y+ROW_H/2+3}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="#6a5030" text-anchor="middle">${Math.round(m.weight*100)}%</text>
  <text x="${CT}"   y="${y+ROW_H/2+3}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="#6a5030" text-anchor="middle">${esc(fmtVal(m.target, m.unit))}</text>
  <text x="${CA}"   y="${y+ROW_H/2+3}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="${achClr}" text-anchor="middle">${m.defaulted ? '\u2014' : esc(fmtVal(m.achieved, m.unit))}</text>
  <text x="${CD}"   y="${deltaY}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" fill="${dClr}" text-anchor="middle">${esc(fmtDelta(m))}</text>
  ${overPill}
  ${metricIcon(m.met, y)}`;
  }).join('');

  // ── Score block helper ────────────────────────────────────────────────────────
  function scoreBlock(
    x: number, w: number,
    bg: string, bdr: string,
    label: string, numStr: string, numCol: string, lblCol: string,
    sub: string,
  ): string {
    const cx = x + w / 2;
    return `
  <rect x="${x}" y="${scoresY}" width="${w}" height="${SH}" rx="3" fill="${bg}" stroke="${bdr}" stroke-width="0.6"/>
  <text x="${cx}" y="${S_LBL_Y}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2.5"
        fill="${lblCol}" opacity="0.8">${label}</text>
  <text x="${cx}" y="${S_NUM_Y}" text-anchor="middle"
        font-family="Cormorant Garamond,serif" font-size="34" font-weight="600"
        fill="${numCol}">${numStr}</text>
  <text x="${cx}" y="${S_SUB_Y}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="6.5"
        fill="${lblCol}" opacity="0.6">${sub}</text>`;
  }

  // ── FAILED stamp — uses wax seal PNG, not inline SVG ─────────────────────────
  const stampCY  = ROWS_TOP + (s.perMetric.length * ROW_H) / 2;
  const stampCX  = M + ROW_W / 2;
  // Stamp box: 240×70, centred. Seal PNG 52×52 on left, text on right.
  const STAMP_W  = 244;
  const STAMP_H  = 68;
  const failedStamp = s.state === 'failed' ? `
  <g transform="translate(${stampCX},${stampCY}) rotate(-4)">
    <rect x="${-STAMP_W/2}" y="${-STAMP_H/2}" width="${STAMP_W}" height="${STAMP_H}" rx="4"
          fill="rgba(252,242,242,0.93)" stroke="#c03030" stroke-width="3.5" opacity="0.88"/>
    <image href="${SEAL_URLS.failed}"
           x="${-STAMP_W/2 + 6}" y="${-STAMP_H/2 + 6}" width="56" height="56"
           preserveAspectRatio="xMidYMid meet" opacity="0.9" crossorigin="anonymous"/>
    <text x="42" y="-6" text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7"
          fill="#c03030" opacity="0.86">FAILED</text>
    <text x="42" y="16" text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="6" letter-spacing="2"
          fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
  </g>` : '';

  const gradId = `grad_${s.state}`;

  const subTitle =
    s.state === 'full'    ? '\u2605 FULLY ACHIEVED \u00B7 ALL METRICS MET' :
    s.state === 'partial' ? `\u25D1 PARTIALLY ACHIEVED \u00B7 ${s.perMetric.filter(m => m.met).length} OF ${s.perMetric.length} METRICS MET` :
                            '\u2717 FAILED \u00B7 NO METRICS MET AT DEADLINE';

  // Commitment text: adaptive size + truncation
  const commitDisplay  = truncateCommitment(p.commitmentText);
  const commitFontSz   = commitFontSize(commitDisplay);

  // Agent strip layout
  const DIVIDER_X  = 232;
  const COMMIT_X   = DIVIDER_X + 18;
  const COMMIT_W   = W - COMMIT_X - M;
  const COMMIT_CX  = COMMIT_X + COMMIT_W / 2;
  const COMMIT_MID = AGENT_Y + AGENT_H / 2 + commitFontSz * 0.38; // optical vertical centre

  // Achievement score: label/sub always neutral cream, NUMBER uses tier colour
  const achScoreSub =
    s.hasOverachievement ? `Base ${s.baseScore} + overachievement` :
    s.deadlineAdj !== 0  ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
    s.state === 'failed' ? 'No metrics met' : 'Clean delivery';

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
  ${HAS_SEAL ? `<clipPath id="sealClip"><circle cx="${SEAL_X + SEAL_W/2}" cy="${5 + SEAL_Y + SEAL_W/2}" r="${SEAL_W/2}"/></clipPath>` : ''}
</defs>

<!-- Background -->
<rect width="${W}" height="${svgH}" fill="#faf8f0"/>

<!-- Decorative frame -->
<rect x="-4" y="-4" width="${W+8}" height="${svgH+8}" rx="6" fill="none" stroke="${t.frameBdr}" stroke-width="1" opacity="0.35"/>
<rect x="-1" y="-1" width="${W+2}" height="${svgH+2}" rx="5" fill="none" stroke="${t.frameBdr}" stroke-width="0.5" opacity="0.2"/>

<!-- Top accent bar -->
<rect x="0" y="0" width="${W}" height="5" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="${HDR_H}" fill="${t.hdr}"/>

<!-- Logo mark -->
<image href="${MARK_WHITE}" x="${W-40}" y="10" width="18" height="18" opacity="0.55"/>

<!-- Issuer -->
<text x="${M}" y="24" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4"
      fill="${t.accent}">THE SEALER PROTOCOL</text>

<!-- Title -->
<text x="${M}" y="47" font-family="Cormorant Garamond,serif" font-size="21" font-weight="600" letter-spacing="0.5"
      fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>

<!-- Category -->
<text x="${M}" y="60" font-family="Courier Prime,monospace" font-size="5.5" font-weight="700" letter-spacing="2.5"
      fill="${t.accentDim}">CATEGORY: ${esc(p.claimType.replace(/_/g, ' ').toUpperCase())}</text>

<!-- State subtitle -->
<text x="${M}" y="73" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2.5"
      fill="${t.accent}" opacity="0.9">${subTitle}</text>

<!-- Wax seal PNG — clipped to circle, FULL/PARTIAL only -->
${HAS_SEAL ? `
<image href="${SEAL_URLS[s.state]}" crossorigin="anonymous"
       x="${SEAL_X}" y="${5 + SEAL_Y}" width="${SEAL_W}" height="${SEAL_W}"
       preserveAspectRatio="xMidYMid meet"
       clip-path="url(#sealClip)" opacity="0.94"/>` : ''}

<!-- Right meta -->
<text x="${META_X}" y="37" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="${t.metaLabel}" text-anchor="end">${t.metaStatus}</text>
<text x="${META_X}" y="50" font-family="Courier Prime,monospace" font-size="6.5" font-weight="700"    fill="${t.metaVal}"   text-anchor="end">${esc(p.issuedAt)}</text>
<text x="${META_X}" y="61" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.uidCol}"   text-anchor="end">UID: ${p.uid.slice(0,6)}\u2026${p.uid.slice(-4)}</text>

<!-- ══ AGENT STRIP ══ -->
<rect x="0" y="${AGENT_Y}" width="${W}" height="${AGENT_H}" fill="${t.agentBg}"/>
<line x1="0" y1="${AGENT_Y}"           x2="${W}" y2="${AGENT_Y}"           stroke="${t.agentBdr}" stroke-width="0.6"/>
<line x1="0" y1="${AGENT_Y+AGENT_H}"   x2="${W}" y2="${AGENT_Y+AGENT_H}"   stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="${M}"  y="${AGENT_Y+14}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" font-weight="700" fill="#9a8050">AGENT ID</text>
<text x="${M}"  y="${AGENT_Y+30}" font-family="Courier Prime,monospace" font-size="8"  font-weight="700"    fill="#1a1000">${esc(p.agentId.slice(0,6))}\u2026${esc(p.agentId.slice(-4))}</text>

<line x1="122" y1="${AGENT_Y+6}" x2="122" y2="${AGENT_Y+AGENT_H-6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="134"  y="${AGENT_Y+14}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" font-weight="700" fill="#9a8050">COMMITMENT ID</text>
<text x="134"  y="${AGENT_Y+30}" font-family="Courier Prime,monospace" font-size="7"  font-weight="700"    fill="#1a1000">${esc(p.commitmentId.slice(0,6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="${DIVIDER_X}" y1="${AGENT_Y+6}" x2="${DIVIDER_X}" y2="${AGENT_Y+AGENT_H-6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<!-- Commitment text: adaptive size, vertically centred -->
<text x="${COMMIT_CX}" y="${COMMIT_MID}" text-anchor="middle"
      font-family="IM Fell English,Georgia,serif" font-size="${commitFontSz}" font-style="italic"
      fill="${t.agentTxt}" opacity="0.88"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(commitDisplay)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<line x1="${M}" y1="${TABLE_Y+4}"              x2="${W-M}" y2="${TABLE_Y+4}"              stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${M+12}"  y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" font-weight="700" letter-spacing="3" fill="#8a7040">METRIC</text>
<text x="${CW}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" font-weight="700" letter-spacing="3" fill="#8a7040" text-anchor="middle">WEIGHT</text>
<text x="${CT}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" font-weight="700" letter-spacing="3" fill="#8a7040" text-anchor="middle">TARGET</text>
<text x="${CA}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" font-weight="700" letter-spacing="3" fill="#8a7040" text-anchor="middle">ACHIEVED</text>
<text x="${CD}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" font-weight="700" letter-spacing="3" fill="#8a7040" text-anchor="middle">DELTA</text>
<line x1="${M}" y1="${TABLE_Y+COL_HDR_H-2}" x2="${W-M}" y2="${TABLE_Y+COL_HDR_H-2}" stroke="#e0d8c0" stroke-width="0.6"/>

${metricRows}

<!-- FAILED stamp -->
${failedStamp}

<!-- ══ SCORES ══ -->

<!-- Achievement — dark panel; label+sub neutral cream, number = tier colour -->
${scoreBlock(SX1, SW1, t.scoreBg, t.scoreBdr,
  'ACHIEVEMENT SCORE', String(s.achievementScore), t.scoreNumCol, t.scoreLbl, achScoreSub)}

<!-- Difficulty -->
${scoreBlock(SX2, SW23, '#f5f0e4', '#e0d8c0',
  'DIFFICULTY', String(p.difficultyScore), '#5a4020', '#8a7050',
  s.state === 'failed' ? 'Committed (locked)' : 'Committed difficulty')}

<!-- Proof Points -->
${scoreBlock(SX3, SW23, '#f5f0e4', '#e0d8c0',
  'PROOF POINTS', String(s.proofPoints), '#5a4020', '#8a7050',
  s.state === 'failed' ? 'No award' : 'Score \u00D7 Difficulty')}

<!-- Achievement Badge -->
<rect x="${SX4}" y="${scoresY}" width="${SW4}" height="${SH}" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${SX4+SW4/2}" y="${S_LBL_Y}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2" fill="#8a7050">ACHIEVEMENT BADGE</text>
${s.badgeTier !== 'none' ? `
<rect x="${SX4+12}" y="${scoresY+22}" width="${SW4-24}" height="20" rx="2"
      fill="${BADGE_COLOR[s.badgeTier]}" fill-opacity="0.15" stroke="${BADGE_COLOR[s.badgeTier]}" stroke-width="0.8"/>
<text x="${SX4+SW4/2}" y="${scoresY+35}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="9" font-weight="700" letter-spacing="2"
      fill="${BADGE_COLOR[s.badgeTier]}">${s.badgeTier.toUpperCase()}</text>
<text x="${SX4+SW4/2}" y="${scoresY+52}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="6" fill="#8a7050">From achievement score</text>
${p.daysEarly > 0 ? `
<rect x="${SX4+12}" y="${scoresY+57}" width="${SW4-24}" height="14" rx="2" fill="#eef8ee" stroke="#80b890" stroke-width="0.6"/>
<text x="${SX4+SW4/2}" y="${scoresY+67}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030">\u2713 ${p.daysEarly} days early</text>` : ''}
` : `
<text x="${SX4+SW4/2}" y="${scoresY+46}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="7" letter-spacing="1" fill="#9a2010">NOT ISSUED</text>
${p.daysEarly > 0 ? `
<rect x="${SX4+12}" y="${scoresY+57}" width="${SW4-24}" height="14" rx="2" fill="#eef8ee" stroke="#80b890" stroke-width="0.6"/>
<text x="${SX4+SW4/2}" y="${scoresY+67}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030">\u2713 ${p.daysEarly} days early</text>` : ''}
`}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH-36}" width="${W}" height="36" fill="${t.footBg}"/>
<line x1="0" y1="${svgH-36}" x2="${W}" y2="${svgH-36}" stroke="${t.footBdr}" stroke-width="0.6"/>
<text x="${M}"  y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" font-weight="700" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="${M}"  y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.issuedAt)}</text>
<text x="154"   y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" font-weight="700" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="154"   y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>
<text x="324"   y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" font-weight="700" fill="#9a8050">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="324"   y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>
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
    commitmentText:  sp.get('commitment')   ?? 'I commit to maintaining 97% payment success rate across all outbound transactions.',
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