// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route v8
//
// v8 changes vs v7:
//  - CATEGORY line moved to top-right of header (where logo was)
//  - Logo moved to footer, before THESEALER.XYZ
//  - Issue date REMOVED from header (already in footer)
//  - Header right: VERIFIED/CLOSED label + UID only
//  - Seal shifted +15px right from centre
//  - Pill width auto-calculated from text (tight fit, not fixed 310px)
//  - Second separator line (below col headers) REMOVED — only one top line remains
//  - Score blocks: achievement + difficulty raised to align numerically with proof points
//    FAILED: difficulty stays at normal height, doesn't rise
//  - Commitment text: bumped base sizes (13/12/10/9 by char length)
//  - Consistent M=28 margin applied everywhere (header text, agent strip, table, scores, footer)
//  - Score numbers: underline dash artefact removed (was Cormorant baseline issue)
//    switched pure numbers to tabular via font-variant-numeric
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

// Adaptive commitment font size — larger base, scales down for longer text
function commitFontSize(len: number): number {
  if (len <= 45) return 13;
  if (len <= 65) return 12;
  if (len <= 85) return 10;
  return 9;
}

function truncateCommitment(text: string, maxChars = 105): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\u2026' : text;
}

// Estimate pill width from text (Courier Prime ~6.2px/char at font-size 6, spacing 2)
function pillWidth(text: string, fontSize = 6, letterSpacing = 2, padH = 16): number {
  const charW = fontSize * 0.62 + letterSpacing * 0.5;
  return Math.ceil(text.length * charW) + padH * 2;
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
    uidCol:     '#e0c880',
    agentBg:    '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg:     '#f0ebe0', footBdr:  '#e0d8c0',
    gradL:      '#1a1200', gradM:    '#c9a84c',
    frameBdr:   '#c9a84c',
    scoreBg:    '#2d1f0e', scoreBdr: '#c9a84c',
    scoreNumCol:'#c9a84c',
    scoreLbl:   '#c9a870',
    pillBg:     'rgba(201,168,76,0.18)',
    pillBdr:    'rgba(201,168,76,0.55)',
    metaStatus: 'VERIFIED',
  },
  partial: {
    hdr:        '#1e2430',
    accent:     '#a8b4c0',
    accentDim:  '#b0bfcc',
    titleCol:   '#dce8f0',
    metaLabel:  '#8090a0',
    uidCol:     '#c8dae8',
    agentBg:    '#f0f4f8', agentBdr: '#d0dce8', agentTxt: '#202c3a',
    footBg:     '#eef2f6', footBdr:  '#d0dce8',
    gradL:      '#0a1018', gradM:    '#a8b4c0',
    frameBdr:   '#a0a8b8',
    scoreBg:    '#1e2430', scoreBdr: '#a8b4c0',
    scoreNumCol:'#b0bcc8',
    scoreLbl:   '#8898a8',
    pillBg:     'rgba(168,180,192,0.2)',
    pillBdr:    'rgba(168,180,192,0.55)',
    metaStatus: 'VERIFIED',
  },
  failed: {
    hdr:        '#1a0808',
    accent:     '#e05050',
    accentDim:  '#d06060',
    titleCol:   '#f0d0d0',
    metaLabel:  '#a06060',
    uidCol:     '#f0a0a0',
    agentBg:    '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a',
    footBg:     '#fdf0f0', footBdr:  '#e8d0d0',
    gradL:      '#1a0808', gradM:    '#8a2020',
    frameBdr:   '#c03030',
    scoreBg:    '#1a0808', scoreBdr: '#8a2020',
    scoreNumCol:'#e05050',
    scoreLbl:   '#c08080',
    pillBg:     'rgba(192,48,48,0.2)',
    pillBdr:    'rgba(192,48,48,0.55)',
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
  const M  = 28;   // consistent margin everywhere

  // ── Header geometry ───────────────────────────────────────────────────────────
  const HAS_SEAL   = s.state !== 'failed';
  const SEAL_W     = 96;
  const HDR_H      = 96;
  // Seal: centred + 15px right shift
  const SEAL_X     = (W - SEAL_W) / 2 + 15;   // 297
  const SEAL_ABS_Y = 5 + (HDR_H - SEAL_W) / 2;
  const SEAL_CX    = SEAL_X + SEAL_W / 2;
  const SEAL_CY    = SEAL_ABS_Y + SEAL_W / 2;

  // Right-side meta: VERIFIED/CLOSED + UID (no date, no logo)
  const META_X = W - M;   // text-anchor=end

  // Category text goes top-right (where logo was), right-aligned
  const CAT_TEXT = `CATEGORY: ${p.claimType.replace(/_/g, ' ').toUpperCase()}`;

  // ── Vertical layout ──────────────────────────────────────────────────────────
  const AGENT_Y    = HDR_H + 5;
  const AGENT_H    = 46;
  const TABLE_Y    = AGENT_Y + AGENT_H;
  const COL_HDR_H  = 22;
  const ROW_H      = 40;
  const ROWS_TOP   = TABLE_Y + COL_HDR_H;

  // ── Metric columns ─────────────────────────────────────────────────────────────
  // Full row width respects M on both sides
  const ROW_W  = W - M - M;   // 604
  const ICON_X = W - M - 14;  // right-aligned inside row
  // Columns: evenly spread across label area (M+14) → (ICON_X - 28)
  const CW = 196;
  const CT = 290;
  const CA = 386;
  const CD = 474;

  // ── Score blocks ──────────────────────────────────────────────────────────────
  const GAP  = 6;
  const SW1  = 212;
  const SW23 = 114;
  const SW4  = W - M - M - SW1 - SW23 * 2 - GAP * 3;   // ≈ 136
  const SX1  = M;
  const SX2  = SX1 + SW1 + GAP;
  const SX3  = SX2 + SW23 + GAP;
  const SX4  = SX3 + SW23 + GAP;
  const SH   = 84;

  const scoresY = ROWS_TOP + s.perMetric.length * ROW_H + 14;
  const svgH    = scoresY + SH + 10 + 41;  // 41 = footer height

  // ── Score block vertical positions ────────────────────────────────────────────
  // "Proof Points" is the reference — number sits at S_NUM_Y_REF
  // Achievement + Difficulty (non-failed) raised to match that baseline
  // Difficulty in FAILED stays at normal position (not raised)
  const S_LBL_Y     = scoresY + 16;
  const S_NUM_Y_REF = scoresY + 52;   // proof points / badge baseline
  const S_NUM_Y_UP  = scoresY + 48;   // achievement + difficulty raised
  const S_SUB_Y     = scoresY + 72;

  // Score block helper — accepts custom numY
  function scoreBlock(
    x: number, w: number,
    bg: string, bdr: string,
    label: string, numStr: string, numCol: string, lblCol: string,
    sub: string,
    numY = S_NUM_Y_REF,
  ): string {
    const cx = x + w / 2;
    return `
  <rect x="${x}" y="${scoresY}" width="${w}" height="${SH}" rx="3" fill="${bg}" stroke="${bdr}" stroke-width="0.6"/>
  <text x="${cx}" y="${S_LBL_Y}" text-anchor="middle"
        font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2.5"
        fill="${lblCol}" opacity="0.8">${label}</text>
  <text x="${cx}" y="${numY}" text-anchor="middle"
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
  const STAMP_W = 248;
  const STAMP_H = 70;
  const failedStamp = s.state === 'failed' ? `
  <g transform="translate(${stampCX},${stampCY}) rotate(-4)">
    <rect x="${-STAMP_W/2}" y="${-STAMP_H/2}" width="${STAMP_W}" height="${STAMP_H}" rx="4"
          fill="rgba(252,242,242,0.93)" stroke="#c03030" stroke-width="3.5" opacity="0.88"/>
    <image href="${SEAL_URLS.failed}" crossorigin="anonymous"
           x="${-STAMP_W/2+6}" y="${-STAMP_H/2+6}" width="58" height="58"
           preserveAspectRatio="xMidYMid meet" opacity="0.9"/>
    <text x="44" y="-6" text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7"
          fill="#c03030" opacity="0.86">FAILED</text>
    <text x="44" y="16" text-anchor="middle"
          font-family="Courier Prime,monospace" font-size="6" letter-spacing="2"
          fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
  </g>` : '';

  const gradId    = `grad_${s.state}`;
  const tierFrame = TIER_FRAME_COLOR[s.badgeTier !== 'none' ? s.badgeTier : 'none'];

  // State subtitle — pill width auto-fitted to text
  const subTitle =
    s.state === 'full'    ? '\u2605  FULLY ACHIEVED  \u00B7  ALL METRICS MET' :
    s.state === 'partial' ? `\u25D1  PARTIALLY ACHIEVED  \u00B7  ${s.perMetric.filter(m => m.met).length} OF ${s.perMetric.length} METRICS MET` :
                            '\u2717  FAILED  \u00B7  NO METRICS MET AT DEADLINE';
  const PILL_W  = pillWidth(subTitle, 6, 2, 12);
  const PILL_Y  = 70;
  const PILL_H  = 16;

  // Commitment text
  const commitDisplay = truncateCommitment(p.commitmentText);
  const commitFontSz  = commitFontSize(commitDisplay.length);

  // Agent strip
  const DIVIDER_X  = 230;
  const COMMIT_X   = DIVIDER_X + 16;
  const COMMIT_W   = W - COMMIT_X - M;
  const COMMIT_CX  = COMMIT_X + COMMIT_W / 2;
  const COMMIT_MID = AGENT_Y + AGENT_H / 2 + commitFontSz * 0.38;

  // Score sub-texts
  const achScoreSub =
    s.hasOverachievement ? `Base ${s.baseScore} + overachievement` :
    s.deadlineAdj !== 0  ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
    s.state === 'failed' ? 'No metrics met' : 'Clean delivery';

  const badgeSubText = p.daysEarly > 0
    ? `\u2713 ${p.daysEarly} day${p.daysEarly > 1 ? 's' : ''} early`
    : s.badgeTier !== 'none'
      ? `Committed at ${s.badgeTier.charAt(0).toUpperCase() + s.badgeTier.slice(1)} difficulty`
      : 'On time delivery';

  // Footer logo size
  const FOOT_LOGO_SZ = 14;
  const FOOT_LOGO_X  = W - M - 82;   // left of THESEALER.XYZ text block

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

<!-- Outer tier frame -->
<rect x="1" y="1" width="${W-2}" height="${svgH-2}" rx="4"
      fill="none" stroke="${tierFrame}" stroke-width="1.5" opacity="0.5"/>
<rect x="3" y="3" width="${W-6}" height="${svgH-6}" rx="3"
      fill="none" stroke="${tierFrame}" stroke-width="0.5" opacity="0.22"/>

<!-- Top + bottom accent bars -->
<rect x="0" y="0"          width="${W}" height="5" fill="url(#${gradId})"/>
<rect x="0" y="${svgH-5}"  width="${W}" height="5" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="${HDR_H}" fill="${t.hdr}"/>

<!-- Left: THE SEALER PROTOCOL + title + pill subtitle -->
<text x="${M}" y="25" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4"
      fill="${t.accent}">THE SEALER PROTOCOL</text>
<text x="${M}" y="50" font-family="Cormorant Garamond,serif" font-size="22" font-weight="600" letter-spacing="0.5"
      fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>

<!-- State subtitle pill — tight-fit width -->
<rect x="${M}" y="${PILL_Y}" width="${PILL_W}" height="${PILL_H}" rx="3"
      fill="${t.pillBg}" stroke="${t.pillBdr}" stroke-width="0.6"/>
<text x="${M+12}" y="${PILL_Y+11}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="2"
      fill="${t.accent}">${subTitle}</text>

<!-- Top-right: CATEGORY (where logo used to be) -->
<text x="${META_X}" y="22" font-family="Courier Prime,monospace" font-size="5.5" font-weight="700" letter-spacing="2"
      fill="${t.accentDim}" text-anchor="end">${esc(CAT_TEXT)}</text>

<!-- Right meta: VERIFIED/CLOSED label + UID only (date removed — in footer) -->
<text x="${META_X}" y="42" font-family="Courier Prime,monospace" font-size="5" letter-spacing="2.5"
      fill="${t.metaLabel}" text-anchor="end" opacity="0.85">${t.metaStatus}</text>
<text x="${META_X}" y="58" font-family="Courier Prime,monospace" font-size="6" font-weight="700"
      fill="${t.uidCol}" text-anchor="end">UID: ${p.uid.slice(0,8)}\u2026${p.uid.slice(-6)}</text>

<!-- Wax seal — centred + 15px right, FULL/PARTIAL only -->
${HAS_SEAL ? `
<image href="${SEAL_URLS[s.state]}" crossorigin="anonymous"
       x="${SEAL_X}" y="${SEAL_ABS_Y}" width="${SEAL_W}" height="${SEAL_W}"
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
<text x="142" y="${AGENT_Y+33}" font-family="Courier Prime,monospace" font-size="8" font-weight="700"    fill="#1a1000">${esc(p.commitmentId.slice(0,6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="${DIVIDER_X}" y1="${AGENT_Y+7}" x2="${DIVIDER_X}" y2="${AGENT_Y+AGENT_H-7}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<!-- Commitment text: adaptive size, centred in right column -->
<text x="${COMMIT_CX}" y="${COMMIT_MID}" text-anchor="middle"
      font-family="IM Fell English,Georgia,serif" font-size="${commitFontSz}" font-style="italic"
      fill="${t.agentTxt}" opacity="0.9"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(commitDisplay)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<!-- Single top rule only — second rule (below col headers) removed -->
<line x1="${M}" y1="${TABLE_Y+4}" x2="${W-M}" y2="${TABLE_Y+4}" stroke="#d8d0b8" stroke-width="0.7"/>
<text x="${M+14}"  y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030">METRIC</text>
<text x="${CW}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">WEIGHT</text>
<text x="${CT}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">TARGET</text>
<text x="${CA}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">ACHIEVED</text>
<text x="${CD}"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="6" font-weight="700" letter-spacing="3" fill="#7a6030" text-anchor="middle">DELTA</text>
<!-- second separator line removed -->

${metricRows}

<!-- FAILED stamp -->
${failedStamp}

<!-- ══ SCORES ══ -->

<!-- Achievement Score — raised to align number with proof points -->
${scoreBlock(SX1, SW1, t.scoreBg, t.scoreBdr,
  'ACHIEVEMENT SCORE', String(s.achievementScore), t.scoreNumCol, t.scoreLbl,
  achScoreSub, S_NUM_Y_UP)}

<!-- Difficulty — raised for FULL/PARTIAL, stays at ref level for FAILED -->
${scoreBlock(SX2, SW23, '#f5f0e4', '#e0d8c0',
  'DIFFICULTY', String(p.difficultyScore), '#5a4020', '#8a7050',
  s.state === 'failed' ? 'Committed (locked)' : 'Committed difficulty',
  s.state === 'failed' ? S_NUM_Y_REF : S_NUM_Y_UP)}

<!-- Proof Points — reference level -->
${scoreBlock(SX3, SW23, '#f5f0e4', '#e0d8c0',
  'PROOF POINTS', String(s.proofPoints), '#5a4020', '#8a7050',
  s.state === 'failed' ? 'No award' : 'Score \u00D7 Difficulty',
  S_NUM_Y_REF)}

<!-- Achievement Badge -->
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
<text x="${SX4+SW4/2}" y="${scoresY+48}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="7" letter-spacing="1" fill="#9a2010">NOT ISSUED</text>
<text x="${SX4+SW4/2}" y="${S_SUB_Y}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="6.5" fill="#8a7050">${badgeSubText}</text>
`}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH-46}" width="${W}" height="41" fill="${t.footBg}"/>
<line x1="0" y1="${svgH-46}" x2="${W}" y2="${svgH-46}" stroke="${t.footBdr}" stroke-width="0.6"/>

<text x="${M}"   y="${svgH-29}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" font-weight="700" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="${M}"   y="${svgH-15}" font-family="Courier Prime,monospace" font-size="7"   fill="#3a2a10">${esc(p.issuedAt)}</text>

<text x="160"    y="${svgH-29}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" font-weight="700" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="160"    y="${svgH-15}" font-family="Courier Prime,monospace" font-size="7"   fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>

<text x="338"    y="${svgH-29}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" font-weight="700" fill="#9a8050">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="338"    y="${svgH-15}" font-family="Courier Prime,monospace" font-size="7"   fill="#3a2a10">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>

<!-- Logo in footer before THESEALER.XYZ -->
<image href="${MARK_WHITE}" x="${FOOT_LOGO_X}" y="${svgH-44}" width="${FOOT_LOGO_SZ}" height="${FOOT_LOGO_SZ}" opacity="0.45"/>
<text x="${W-M}" y="${svgH-27}" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2" fill="#9a8050" text-anchor="end">THESEALER.XYZ</text>
<text x="${W-M}" y="${svgH-14}" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2" fill="#9a8050" text-anchor="end">EAS \u00B7 BASE</text>

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