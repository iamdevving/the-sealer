// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route v9
//
// v9 changes vs v8:
//  - Header compressed: pill moved directly under title (y≈48), HDR_H=72
//  - CATEGORY aligned to same Y as THE SEALER PROTOCOL (top row, right side)
//  - Top-right: VERIFIED/CLOSED + issue date + UID — fills empty space
//  - Seal bigger (104×104), stays right of centre
//  - Score blocks: ALL use identical S_LBL_Y / S_NUM_Y / S_SUB_Y — no per-block
//    offsets. Numbers aligned by fixing a single shared baseline.
//  - Side frame: full-height left/right accent lines (not inset rect)
//  - Second separator (below col headers) definitively removed — only top rule
//  - Footer logo: mark_whiter.png at x=M, inline with THESEALER.XYZ to its right
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
    return {
      ...m, ratio, perScore,
      met: ratio >= 1.0, over: ratio > 1.0,
      delta: m.achieved - m.target, defaulted,
    };
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

function commitFontSize(len: number): number {
  if (len <= 45) return 13;
  if (len <= 65) return 12;
  if (len <= 85) return 10;
  return 9;
}

function truncateCommitment(text: string, maxChars = 105): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\u2026' : text;
}

// Tight pill width estimate for Courier Prime monospace
function pillWidth(text: string): number {
  // ~6.0px per char at font-size 6, letter-spacing 2 + 22px total padding
  return Math.ceil(text.length * 6.0) + 22;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

const TIER_FRAME_COLOR: Record<BadgeTier, string> = {
  gold:   '#c9a84c',
  silver: '#a0a8b8',
  bronze: '#cd9060',
  none:   '#c03030',
};

const THEME = {
  full: {
    hdr:        '#2d1f0e',
    accent:     '#c9a84c',
    accentDim:  '#c0a060',
    titleCol:   '#f0e8d0',
    metaLabel:  '#9a8060',
    metaDate:   '#d4b870',
    uidCol:     '#e0c880',
    agentBg:    '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg:     '#f0ebe0', footBdr:  '#e0d8c0',
    gradL:      '#1a1200', gradM:    '#c9a84c',
    frameLine:  '#c9a84c',
    scoreBg:    '#2d1f0e', scoreBdr: '#c9a84c',
    scoreNumCol:'#c9a84c',
    scoreLbl:   '#c9a870',
    pillBg:     'rgba(201,168,76,0.18)',
    pillBdr:    'rgba(201,168,76,0.6)',
    metaStatus: 'VERIFIED',
  },
  partial: {
    hdr:        '#1e2430',
    accent:     '#a8b4c0',
    accentDim:  '#b0bfcc',
    titleCol:   '#dce8f0',
    metaLabel:  '#8090a0',
    metaDate:   '#b0c4d4',
    uidCol:     '#c8dae8',
    agentBg:    '#f0f4f8', agentBdr: '#d0dce8', agentTxt: '#202c3a',
    footBg:     '#eef2f6', footBdr:  '#d0dce8',
    gradL:      '#0a1018', gradM:    '#a8b4c0',
    frameLine:  '#a0a8b8',
    scoreBg:    '#1e2430', scoreBdr: '#a8b4c0',
    scoreNumCol:'#b0bcc8',
    scoreLbl:   '#8898a8',
    pillBg:     'rgba(168,180,192,0.2)',
    pillBdr:    'rgba(168,180,192,0.6)',
    metaStatus: 'VERIFIED',
  },
  failed: {
    hdr:        '#1a0808',
    accent:     '#e05050',
    accentDim:  '#d06060',
    titleCol:   '#f0d0d0',
    metaLabel:  '#a06060',
    metaDate:   '#d08080',
    uidCol:     '#f0a0a0',
    agentBg:    '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a',
    footBg:     '#fdf0f0', footBdr:  '#e8d0d0',
    gradL:      '#1a0808', gradM:    '#8a2020',
    frameLine:  '#c03030',
    scoreBg:    '#1a0808', scoreBdr: '#8a2020',
    scoreNumCol:'#e05050',
    scoreLbl:   '#c08080',
    pillBg:     'rgba(192,48,48,0.2)',
    pillBdr:    'rgba(192,48,48,0.6)',
    metaStatus: 'CLOSED',
  },
};

const BADGE_COLOR: Record<BadgeTier, string> = {
  gold: '#c9a84c', silver: '#a0a8b8', bronze: '#cd9060', none: '#888',
};

// ── SVG Builder ───────────────────────────────────────────────────────────────

function buildSVG(p: CertificateParams, s: ScoringResult): string {
  const t  = THEME[s.state];
  const W  = 660;
  const M  = 28;

  // ── Header ────────────────────────────────────────────────────────────────────
  // Layout (all Y from SVG top, header starts at y=5 after accent bar):
  //   y=20: THE SEALER PROTOCOL (left) | CATEGORY (right) — same baseline
  //   y=38: Certificate of Achievement title
  //   y=48: pill (h=16) → bottom at y=64
  //   HDR_H=68 → header rect ends at y=73 (5+68)
  //
  // Right column (text-anchor=end at META_X):
  //   y=20: CATEGORY
  //   y=38: VERIFIED / CLOSED label
  //   y=51: issue date
  //   y=63: UID

  // Header: 86px — seal overflows top intentionally for stamp effect
  const HDR_H   = 86;
  const META_X  = W - M;

  // Seal: 116×116, top at y=-10 — sits above accent bar, prominent stamp overlapping the frame
  const HAS_SEAL   = s.state !== 'failed';
  const SEAL_W     = 116;
  const SEAL_X     = 276;
  const SEAL_TOP   = -10;
  const SEAL_CX    = SEAL_X + SEAL_W / 2;   // 334
  const SEAL_CY    = SEAL_TOP + SEAL_W / 2; // 48

  // State subtitle pill
  const subTitle =
    s.state === 'full'    ? '\u2605  FULLY ACHIEVED  \u00B7  ALL METRICS MET' :
    s.state === 'partial' ? `\u25D1  PARTIALLY ACHIEVED  \u00B7  ${s.perMetric.filter(m => m.met).length} OF ${s.perMetric.length} METRICS MET` :
                            '\u2717  FAILED  \u00B7  NO METRICS MET AT DEADLINE';
  const PILL_W = pillWidth(subTitle);
  const PILL_Y = 78;
  const PILL_H = 16;

  const CAT_TEXT = `CATEGORY: ${p.claimType.replace(/_/g, ' ').toUpperCase()}`;

  // ── Vertical layout ──────────────────────────────────────────────────────────
  const AGENT_Y   = 5 + HDR_H + 4;   // accent bar + header + gap
  const AGENT_H   = 46;
  const TABLE_Y   = AGENT_Y + AGENT_H;
  const COL_HDR_H = 22;
  const ROW_H     = 40;
  const ROWS_TOP  = TABLE_Y + COL_HDR_H;

  // ── Metric columns ────────────────────────────────────────────────────────────
  const ROW_W  = W - M - M;   // 604
  // Icon aligned with right edge of score/badge block (SX4+SW4 = W-M = 632, icon 18px from that)
  // Computed after score block constants so we use W-M-14 but clamp to inside badge block
  const CW = 196;
  const CT = 290;
  const CA = 386;
  const CD = 474;

  // ── Score blocks ──────────────────────────────────────────────────────────────
  // ALL blocks share IDENTICAL label/number/sub Y positions.
  // No per-block offsets — uniform spacing across every block.
  const GAP   = 6;
  const SW1   = 212;
  const SW23  = 114;
  const SW4   = W - M - M - SW1 - SW23 * 2 - GAP * 3;   // ≈ 136
  const SX1   = M;
  const SX2   = SX1 + SW1 + GAP;
  const SX3   = SX2 + SW23 + GAP;
  const SX4   = SX3 + SW23 + GAP;
  const SH    = 84;
  // Icon X: centred over the badge column so it aligns visually with the badge block
  const ICON_X = SX4 + SW4 / 2;   // centre of badge column ≈ 559

  const scoresY = ROWS_TOP + s.perMetric.length * ROW_H + 14;
  const svgH    = scoresY + SH + 10 + 41;

  // Shared score block positions — all identical, clean alignment
  const S_LBL_Y = scoresY + 16;   // label baseline
  const S_NUM_Y = scoresY + 52;   // number baseline (consistent across all blocks)
  const S_SUB_Y = scoresY + 70;   // sub-text baseline

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
        fill="${lblCol}" opacity="0.85">${label}</text>
  <text x="${cx}" y="${S_NUM_Y}" text-anchor="middle"
        font-family="Cormorant Garamond,serif" font-size="36" font-weight="600"
        fill="${numCol}">${numStr}</text>
  <text x="${cx}" y="${S_SUB_Y}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="6.5"
        fill="${lblCol}" opacity="0.6">${sub}</text>`;
  }

  // ── Icon: circle with check or X ─────────────────────────────────────────────
  function metricIcon(met: boolean, y: number): string {
    const cy = y + ROW_H / 2 - 1;
    const r  = 9;
    if (met) {
      return `
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="#2a7040" opacity="0.12"/>
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="none" stroke="#2a7040" stroke-width="1.5"/>
  <path d="M${ICON_X-4.5},${cy+0.5} L${ICON_X-1},${cy+4.5} L${ICON_X+5.5},${cy-5.5}"
        fill="none" stroke="#2a7040" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      return `
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="#c03030" opacity="0.08"/>
  <circle cx="${ICON_X}" cy="${cy}" r="${r}" fill="none" stroke="#c03030" stroke-width="1.5"/>
  <line x1="${ICON_X-5}" y1="${cy-5}" x2="${ICON_X+5}" y2="${cy+5}" stroke="#c03030" stroke-width="2" stroke-linecap="round"/>
  <line x1="${ICON_X+5}" y1="${cy-5}" x2="${ICON_X-5}" y2="${cy+5}" stroke="#c03030" stroke-width="2" stroke-linecap="round"/>`;
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
  <rect x="${CD-38}" y="${y+21}" width="76" height="12" rx="2" fill="none" stroke="#a0d0b0" stroke-width="0.6"/>
  <text x="${CD}" y="${y+30}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2191 Overachieved</text>` : '';

    const deltaY = m.over ? y + 17 : y + ROW_H / 2 + 3;

    return `
  <rect x="${M}" y="${y}" width="${ROW_W}" height="${ROW_H-3}" rx="3" fill="${rowBg}" stroke="${rowBdr}" stroke-width="0.6"/>
  <text x="${M+14}" y="${y+ROW_H/2+3}" font-family="Courier Prime,monospace" font-size="7.5" font-weight="700" letter-spacing="1.5" fill="#3a2a10">${esc(m.label.toUpperCase())}</text>
  <text x="${CW}"   y="${y+ROW_H/2+3}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="#6a5030" text-anchor="middle">${Math.round(m.weight*100)}%</text>
  <text x="${CT}"   y="${y+ROW_H/2+3}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="#6a5030" text-anchor="middle">${esc(fmtVal(m.target, m.unit))}</text>
  <text x="${CA}"   y="${y+ROW_H/2+3}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="${achClr}" text-anchor="middle">${m.defaulted ? '\u2014' : esc(fmtVal(m.achieved, m.unit))}</text>
  <text x="${CD}"   y="${deltaY}" font-family="Courier Prime,monospace" font-size="7.5" font-weight="700" fill="${dClr}" text-anchor="middle">${esc(fmtDelta(m))}</text>
  ${overPill}
  ${metricIcon(m.met, y)}`;
  }).join('');

  // ── FAILED stamp ─────────────────────────────────────────────────────────────
  const stampCY = ROWS_TOP + (s.perMetric.length * ROW_H) / 2;
  const stampCX = M + ROW_W / 2;
  const failedStamp = s.state === 'failed' ? `
  <g transform="translate(${stampCX},${stampCY}) rotate(-4)">
    <rect x="-124" y="-35" width="248" height="70" rx="4"
          fill="rgba(252,242,242,0.93)" stroke="#c03030" stroke-width="3.5" opacity="0.88"/>
    <image href="${SEAL_URLS.failed}" crossorigin="anonymous"
           x="-118" y="-29" width="58" height="58"
           preserveAspectRatio="xMidYMid meet" opacity="0.9"/>
    <text x="44" y="-6" text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7"
          fill="#c03030" opacity="0.86">FAILED</text>
    <text x="44" y="16" text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="6" letter-spacing="2"
          fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
  </g>` : '';

  // ── Commitment text ───────────────────────────────────────────────────────────
  const commitDisplay = truncateCommitment(p.commitmentText);
  const commitFontSz  = commitFontSize(commitDisplay.length);
  const DIVIDER_X     = 230;
  const COMMIT_X      = DIVIDER_X + 16;
  const COMMIT_W      = W - COMMIT_X - M;
  const COMMIT_CX     = COMMIT_X + COMMIT_W / 2;
  const COMMIT_MID    = AGENT_Y + AGENT_H / 2 + commitFontSz * 0.38;

  // ── Score sub-texts ───────────────────────────────────────────────────────────
  const achScoreSub =
    s.hasOverachievement ? `Base ${s.baseScore} + overachievement` :
    s.deadlineAdj !== 0  ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
    s.state === 'failed' ? 'No metrics met' : 'Clean delivery';

  const badgeSubText = p.daysEarly > 0
    ? `\u2713 ${p.daysEarly} day${p.daysEarly > 1 ? 's' : ''} early`
    : s.badgeTier !== 'none'
      ? `Committed at ${s.badgeTier.charAt(0).toUpperCase() + s.badgeTier.slice(1)} difficulty`
      : 'On time delivery';

  // ── Tier frame colour ─────────────────────────────────────────────────────────
  const gradId    = `grad_${s.state}`;
  const tierFrame = TIER_FRAME_COLOR[s.badgeTier !== 'none' ? s.badgeTier : 'none'];

  // ── Footer logo ───────────────────────────────────────────────────────────────
  const LOGO_SZ     = 18;
  const LOGO_FT_X   = M;                    // left margin
  const LOGO_FT_Y   = svgH - 46 + 14;       // centred in footer stripe
  const SITE_X      = LOGO_FT_X + LOGO_SZ + 8;   // text starts right of logo

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
  ${HAS_SEAL ? `<clipPath id="sealClip">
    <circle cx="${SEAL_CX}" cy="${SEAL_CY}" r="${SEAL_W / 2 - 1}"/>
  </clipPath>` : ''}
</defs>

<!-- Background -->
<rect width="${W}" height="${svgH}" fill="#faf8f0"/>

<!-- Top + bottom accent bars -->
<rect x="0" y="0"         width="${W}" height="5" fill="url(#${gradId})"/>
<rect x="0" y="${svgH-5}" width="${W}" height="5" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="${HDR_H}" fill="${t.hdr}"/>

<!-- Left header: THE SEALER PROTOCOL | Title | Pill -->
<text x="${M}" y="20"
      font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4"
      fill="${t.accent}">THE SEALER PROTOCOL</text>

<text x="${M}" y="46"
      font-family="Cormorant Garamond,serif" font-size="22" font-weight="600" letter-spacing="0.5"
      fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>

<!-- State subtitle pill -->
<rect x="${M}" y="60" width="${PILL_W}" height="${PILL_H}" rx="3"
      fill="${t.pillBg}" stroke="${t.pillBdr}" stroke-width="0.6"/>
<text x="${M+11}" y="71"
      font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2"
      fill="${t.accent}">${subTitle}</text>

<!-- Right header: CATEGORY bold + underline -->
<text x="${META_X}" y="20"
      font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2.5"
      fill="${t.accent}" text-anchor="end">${esc(CAT_TEXT)}</text>
<line x1="${META_X - Math.ceil(CAT_TEXT.length * 7.0)}" y1="24" x2="${META_X}" y2="24"
      stroke="${t.accent}" stroke-width="0.8" opacity="0.45"/>

<!-- VERIFIED / CLOSED pill -->
<rect x="${META_X - 72}" y="31" width="72" height="16" rx="3"
      fill="${t.pillBg}" stroke="${t.pillBdr}" stroke-width="0.7"/>
<text x="${META_X - 36}" y="42"
      font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3"
      fill="${t.accent}" text-anchor="middle">${t.metaStatus}</text>

<!-- Date + UID -->
<text x="${META_X}" y="60"
      font-family="Courier Prime,monospace" font-size="7" font-weight="700"
      fill="${t.metaDate}" text-anchor="end">${esc(p.issuedAt)}</text>

<text x="${META_X}" y="75"
      font-family="Courier Prime,monospace" font-size="5.5" font-weight="700"
      fill="${t.uidCol}" text-anchor="end">UID: ${p.uid.slice(0,8)}\u2026${p.uid.slice(-6)}</text>

<!-- Wax seal — 104×104, right of centre, FULL/PARTIAL only -->
${HAS_SEAL ? `
<image href="${SEAL_URLS[s.state]}" crossorigin="anonymous"
       x="${SEAL_X}" y="${SEAL_TOP}" width="${SEAL_W}" height="${SEAL_W}"
       preserveAspectRatio="xMidYMid meet"
       clip-path="url(#sealClip)" opacity="0.95"/>` : ''}

<!-- ══ AGENT STRIP ══ -->
<rect x="0" y="${AGENT_Y}" width="${W}" height="${AGENT_H}" fill="${t.agentBg}"/>
<line x1="0" y1="${AGENT_Y}"          x2="${W}" y2="${AGENT_Y}"          stroke="${t.agentBdr}" stroke-width="0.6"/>
<line x1="0" y1="${AGENT_Y+AGENT_H}"  x2="${W}" y2="${AGENT_Y+AGENT_H}"  stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="${M}"  y="${AGENT_Y+15}" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2.5" font-weight="700" fill="#9a8050">AGENT ID</text>
<text x="${M}"  y="${AGENT_Y+33}" font-family="Courier Prime,monospace" font-size="8.5" font-weight="700" fill="#1a1000">${esc(p.agentId.slice(0,6))}\u2026${esc(p.agentId.slice(-4))}</text>

<line x1="130" y1="${AGENT_Y+7}" x2="130" y2="${AGENT_Y+AGENT_H-7}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="142" y="${AGENT_Y+15}" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2.5" font-weight="700" fill="#9a8050">COMMITMENT ID</text>
<text x="142" y="${AGENT_Y+33}" font-family="Courier Prime,monospace" font-size="8" font-weight="700" fill="#1a1000">${esc(p.commitmentId.slice(0,6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="${DIVIDER_X}" y1="${AGENT_Y+7}" x2="${DIVIDER_X}" y2="${AGENT_Y+AGENT_H-7}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="${COMMIT_CX}" y="${COMMIT_MID}" text-anchor="middle"
      font-family="IM Fell English,Georgia,serif" font-size="${commitFontSz}" font-style="italic"
      fill="${t.agentTxt}" opacity="0.9"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(commitDisplay)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<!-- Single top rule only — NO second rule below col headers -->
<line x1="${M}" y1="${TABLE_Y+4}" x2="${W-M}" y2="${TABLE_Y+4}" stroke="#d0c8b0" stroke-width="0.7"/>
<text x="${M+14}" y="${TABLE_Y+16}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030">METRIC</text>
<text x="${CW}"   y="${TABLE_Y+16}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">WEIGHT</text>
<text x="${CT}"   y="${TABLE_Y+16}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">TARGET</text>
<text x="${CA}"   y="${TABLE_Y+16}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">ACHIEVED</text>
<text x="${CD}"   y="${TABLE_Y+16}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">DELTA</text>
<!-- !! Second separator intentionally omitted — rows start immediately below -->

${metricRows}

${failedStamp}

<!-- ══ SCORES ══ -->
<!-- All four blocks share identical S_LBL_Y / S_NUM_Y / S_SUB_Y for perfect alignment -->

${scoreBlock(SX1, SW1, t.scoreBg, t.scoreBdr,
  'ACHIEVEMENT SCORE', String(s.achievementScore), t.scoreNumCol, t.scoreLbl, achScoreSub)}

${scoreBlock(SX2, SW23, '#f5f0e4', '#e0d8c0',
  'DIFFICULTY', String(p.difficultyScore), '#5a4020', '#8a7050',
  s.state === 'failed' ? 'Committed (locked)' : 'Committed difficulty')}

${scoreBlock(SX3, SW23, '#f5f0e4', '#e0d8c0',
  'PROOF POINTS', String(s.proofPoints), '#5a4020', '#8a7050',
  s.state === 'failed' ? 'No award' : 'Score \u00D7 Difficulty')}

<!-- Badge block — same top/bottom positions as score blocks -->
<rect x="${SX4}" y="${scoresY}" width="${SW4}" height="${SH}" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${SX4+SW4/2}" y="${S_LBL_Y}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2" fill="#8a7050">ACHIEVEMENT BADGE</text>
${s.badgeTier !== 'none' ? `
<rect x="${SX4+12}" y="${scoresY+23}" width="${SW4-24}" height="22" rx="2"
      fill="${BADGE_COLOR[s.badgeTier]}" fill-opacity="0.15" stroke="${BADGE_COLOR[s.badgeTier]}" stroke-width="0.8"/>
<text x="${SX4+SW4/2}" y="${scoresY+37}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="10" font-weight="700" letter-spacing="2"
      fill="${BADGE_COLOR[s.badgeTier]}">${s.badgeTier.toUpperCase()}</text>
<text x="${SX4+SW4/2}" y="${S_SUB_Y}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="6.5" fill="#8a7050">${badgeSubText}</text>
` : `
<text x="${SX4+SW4/2}" y="${scoresY+46}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="7" letter-spacing="1" fill="#9a2010">NOT ISSUED</text>
<text x="${SX4+SW4/2}" y="${S_SUB_Y}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="6.5" fill="#8a7050">${badgeSubText}</text>
`}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH-46}" width="${W}" height="41" fill="${t.footBg}"/>
<line x1="0" y1="${svgH-46}" x2="${W}" y2="${svgH-46}" stroke="${t.footBdr}" stroke-width="0.6"/>

<!-- Logo: left side, inline with THESEALER.XYZ to its right — uses base64 asset, always renders -->
<image href="${MARK_WHITE}"
       x="${LOGO_FT_X}" y="${LOGO_FT_Y}" width="${LOGO_SZ}" height="${LOGO_SZ}"
       preserveAspectRatio="xMidYMid meet" opacity="0.55"/>
<text x="${SITE_X}" y="${svgH-27}" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2" fill="#9a8050">THESEALER.XYZ</text>
<text x="${SITE_X}" y="${svgH-14}" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2" fill="#9a8050">EAS \u00B7 BASE</text>

<text x="160"  y="${svgH-29}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" font-weight="700" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="160"  y="${svgH-15}" font-family="Courier Prime,monospace" font-size="7"   fill="#3a2a10">${esc(p.issuedAt)}</text>

<text x="310"  y="${svgH-29}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" font-weight="700" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="310"  y="${svgH-15}" font-family="Courier Prime,monospace" font-size="7"   fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>

<text x="${W-M}" y="${svgH-29}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" font-weight="700" fill="#9a8050" text-anchor="end">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="${W-M}" y="${svgH-15}" font-family="Courier Prime,monospace" font-size="7"   fill="#3a2a10" text-anchor="end">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>
<!-- Professional border frame drawn last — sits on top of all content, full perimeter -->
<rect x="0" y="0" width="${W}" height="${svgH}"
      fill="none" stroke="${tierFrame}" stroke-width="4" opacity="0.55"/>
<rect x="3" y="3" width="${W-6}" height="${svgH-6}"
      fill="none" stroke="${tierFrame}" stroke-width="0.8" opacity="0.2"/>

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