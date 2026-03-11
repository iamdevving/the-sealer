// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route v4
//
// Changes from v3:
//  - Wax seal PNG (70×70) in header, replaces ink SVG
//  - UID centred under commitment text (agent strip)
//  - Metric rows end at x=508 (aligns with ProofPoints block right edge)
//    ✓/✗ icons sit outside rows, right-aligned at x=528
//  - Score blocks: uniform large number font, more gap to sub-text
//  - LB POINTS renamed to PROOF POINTS
//  - Margins reduced 32→24px for less dead space
//  - Demo fallback shows FULL state (positive achieved values)
//  - "Only full state" bug: test links fixed, state derives from metrics
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE } from '@/lib/assets';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.thesealer.xyz';

const SEAL_URLS = {
  full:    `${BASE_URL}/seals/fully-achieved.png`,
  partial: `${BASE_URL}/seals/partially-achieved.png`,
  failed:  `${BASE_URL}/seals/failed-seal.png`,
};

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

// ── Scoring Engine ────────────────────────────────────────────────────────────

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
      met: ratio >= 1.0,
      over: ratio > 1.0,
      delta: m.achieved - m.target,
      defaulted,
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
  if (!m.met)  return `\u2212${fmtVal(Math.abs(m.delta), m.unit)}`;
  if (m.over)  return `+${fmtVal(m.delta, m.unit)}`;
  return 'On target';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Inline sad-face SVG for FAILED stamp ─────────────────────────────────────

const SAD_SEAL_SVG = `<svg width="30" height="30" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" opacity="0.78">
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
    hdr: '#2d1f0e', issuer: '#c9a84c', cat: '#b8964a', titleCol: '#f0e8d0', subCol: '#c9a84c',
    metaLabel: '#6a5030', metaVal: '#c0a870', uidCol: '#6a5030',
    agentBg: '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg: '#f0ebe0', footBdr: '#e0d8c0',
    accentL: '#1a1200', accentM: '#c9a84c', frameBdr: '#c9a84c',
    scoreBg: '#2d1f0e', scoreBdr: '#c9a84c', scoreNum: '#c9a84c', scoreLbl: '#c9a84c',
    metaStatus: 'VERIFIED',
  },
  partial: {
    hdr: '#2d1f0e', issuer: '#c9a84c', cat: '#b8964a', titleCol: '#f0e8d0', subCol: '#6a9aaa',
    metaLabel: '#6a5030', metaVal: '#c0a870', uidCol: '#6a5030',
    agentBg: '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg: '#f0ebe0', footBdr: '#e0d8c0',
    accentL: '#0a0a12', accentM: '#7a9aaa', frameBdr: '#7a9aaa',
    scoreBg: '#0a1a28', scoreBdr: '#6a9aaa', scoreNum: '#cd9060', scoreLbl: '#6a9aaa',
    metaStatus: 'VERIFIED',
  },
  failed: {
    hdr: '#1a0808', issuer: '#c04040', cat: '#8a3030', titleCol: '#e8c0c0', subCol: '#c04040',
    metaLabel: '#6a2020', metaVal: '#c08080', uidCol: '#6a2020',
    agentBg: '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a',
    footBg: '#fdf0f0', footBdr: '#e8d0d0',
    accentL: '#1a0808', accentM: '#8a2020', frameBdr: '#8a2020',
    scoreBg: '#1a0808', scoreBdr: '#8a2020', scoreNum: '#e05050', scoreLbl: '#c04040',
    metaStatus: 'CLOSED',
  },
};

const BADGE_COLOR: Record<BadgeTier, string> = {
  gold: '#c9a84c', silver: '#a0a8b0', bronze: '#cd9060', none: '#888',
};

// ── SVG Builder ───────────────────────────────────────────────────────────────

function buildSVG(p: CertificateParams, s: ScoringResult): string {
  const t = THEME[s.state];

  // ── Layout ──────────────────────────────────────────────────────────────────
  // Reduced margins: L/R = 24 (was 32)
  const M   = 24;   // left/right margin
  const W   = 660;

  // Header: compact, same height all states — wax seal 70×70 floated right
  const HDR_H    = 84;
  const AGENT_Y  = HDR_H + 5;      // 5px accent bar
  const AGENT_H  = 42;
  const TABLE_Y  = AGENT_Y + AGENT_H;
  const COL_HDR_H = 24;
  const ROW_H    = 38;
  const ROWS_TOP = TABLE_Y + COL_HDR_H;

  // Score blocks: 4 across from M to W-M (636px wide, gap=6)
  // Achievement=230w, Difficulty=118w, ProofPoints=118w, Badge=remaining
  const SX1 = M;          // achievement block left
  const SW1 = 222;
  const SX2 = SX1 + SW1 + 6;   // 252 — difficulty
  const SW2 = 118;
  const SX3 = SX2 + SW2 + 6;   // 376 — proof points
  const SW3 = 118;
  const SX4 = SX3 + SW3 + 6;   // 500 — badge
  const SW4 = W - M - SX4;     // ~136

  // Metric rows: left=M, right=SX4+SW3 (aligns with right edge of ProofPoints)
  // ✓/✗ icons sit outside row at x=SX4+SW3+14 centered
  const ROW_R  = SX3 + SW3;      // right edge of metric row rect = 494
  const ROW_W  = ROW_R - M;      // width of metric row rect
  const ICON_X = SX4 + SW4 / 2;  // centred in badge block = ~568

  // Column X centres within metric rows (M=24 to ROW_R=494)
  const CW = 192;   // Weight
  const CT = 280;   // Target
  const CA = 376;   // Achieved
  const CD = 454;   // Delta

  // ── Metric rows ─────────────────────────────────────────────────────────────
  const metricRows = s.perMetric.map((m, i) => {
    const y      = ROWS_TOP + i * ROW_H;
    const isFail = s.state === 'failed';
    const rowBg  = m.met ? '#f2f8f0' : (isFail ? '#faf0f0' : '#fdf5f0');
    const rowBdr = m.met ? '#c8dcc0' : (isFail ? '#e0c0c0' : '#e8c8b0');
    const achClr = m.met ? (m.over ? '#1a5040' : '#2a6030') : '#8a3020';
    const dClr   = m.over ? '#1a6050' : (m.met ? '#2a6030' : '#9a2010');
    const iconClr = m.met ? '#2a7040' : '#c03030';
    // Refined check/cross paths instead of unicode glyphs
    const iconMark = m.met
      ? `<path d="M${ICON_X-5},${y+18} L${ICON_X-1},${y+23} L${ICON_X+6},${y+13}" fill="none" stroke="${iconClr}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<line x1="${ICON_X-5}" y1="${y+13}" x2="${ICON_X+5}" y2="${y+23}" stroke="${iconClr}" stroke-width="1.8" stroke-linecap="round"/>
         <line x1="${ICON_X+5}" y1="${y+13}" x2="${ICON_X-5}" y2="${y+23}" stroke="${iconClr}" stroke-width="1.8" stroke-linecap="round"/>`;

    const overPill = m.over ? `
  <rect x="${CD-36}" y="${y+21}" width="72" height="11" rx="2" fill="none" stroke="#a0d0b0" stroke-width="0.6"/>
  <text x="${CD}" y="${y+30}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2191 Overachieved</text>` : '';

    return `
  <rect x="${M}" y="${y}" width="${ROW_W}" height="${ROW_H-3}" rx="3" fill="${rowBg}" stroke="${rowBdr}" stroke-width="0.6"/>
  <text x="${M+12}"  y="${y+13}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="1.5" fill="#3a2a10">${esc(m.label.toUpperCase())}</text>
  <text x="${M+12}"  y="${y+24}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${Math.round(m.weight * 100)}% weight</text>
  <text x="${CW}" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="#6a5030" text-anchor="middle">${Math.round(m.weight*100)}%</text>
  <text x="${CT}" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="#6a5030" text-anchor="middle">${esc(fmtVal(m.target, m.unit))}</text>
  <text x="${CA}" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="13" font-weight="600" fill="${achClr}" text-anchor="middle">${m.defaulted ? '\u2014' : esc(fmtVal(m.achieved, m.unit))}</text>
  <text x="${CD}" y="${y+18}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" fill="${dClr}" text-anchor="middle">${esc(fmtDelta(m))}</text>
  ${overPill}
  ${iconMark}`;
  }).join('');

  // ── Scores ───────────────────────────────────────────────────────────────────
  const scoresY = ROWS_TOP + s.perMetric.length * ROW_H + 12;
  const SH      = 72;   // score block height (taller for breathing room)
  const svgH    = scoresY + SH + 10 + 36;   // +10 gap before footer

  // Sub-text Y: fixed distance from bottom of block
  const SLY  = scoresY + 14;   // label Y
  const SNY  = scoresY + 50;   // number Y (big score)
  const SSY  = scoresY + 63;   // sub-text Y

  // ── FAILED stamp ─────────────────────────────────────────────────────────────
  const stampCY = ROWS_TOP + (s.perMetric.length * ROW_H) / 2 + 4;
  const failedStamp = s.state === 'failed' ? `
  <g transform="translate(${M + ROW_W / 2},${stampCY}) rotate(-4)">
    <rect x="-112" y="-30" width="224" height="64" rx="3" fill="rgba(250,240,240,0.9)" stroke="#c03030" stroke-width="3.5" opacity="0.84"/>
    <g transform="translate(-74,1)">${SAD_SEAL_SVG}</g>
    <text x="28" y="-6"  text-anchor="middle" font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7" fill="#c03030" opacity="0.84">FAILED</text>
    <text x="28" y="14"  text-anchor="middle" font-family="Courier Prime,monospace" font-size="6"  letter-spacing="2" fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
  </g>` : '';

  // ── Gradient ─────────────────────────────────────────────────────────────────
  const gradId = `grad_${s.state}`;

  // ── Seal position in header ──────────────────────────────────────────────────
  // Wax seal PNG 70×70, right-aligned inside header, vertically centred
  const SEAL_W = 70;
  const SEAL_X = W - M - SEAL_W;        // = 566
  const SEAL_Y = 5 + (HDR_H - SEAL_W) / 2;  // vertically centred in header

  // Meta text X — to the left of the seal with a gap
  const META_X = SEAL_X - 10;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${svgH}" viewBox="0 0 ${W} ${svgH}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <style>@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&amp;family=Courier+Prime:wght@400;700&amp;family=IM+Fell+English:ital@0;1&amp;display=swap');</style>
  <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%"   stop-color="${t.accentL}"/>
    <stop offset="30%"  stop-color="${t.accentM}"/>
    <stop offset="65%"  stop-color="${t.accentM}" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="${t.accentL}"/>
  </linearGradient>
</defs>

<!-- Background -->
<rect width="${W}" height="${svgH}" fill="#faf8f0"/>

<!-- Outer decorative frame -->
<rect x="-4" y="-4" width="${W+8}" height="${svgH+8}" rx="6" fill="none" stroke="${t.frameBdr}" stroke-width="1" opacity="0.4"/>
<rect x="-1" y="-1" width="${W+2}" height="${svgH+2}" rx="5" fill="none" stroke="${t.frameBdr}" stroke-width="0.5" opacity="0.25"/>

<!-- Top accent bar -->
<rect x="0" y="0" width="${W}" height="5" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="${HDR_H}" fill="${t.hdr}"/>

<!-- Logo mark — top right, above seal -->
<image href="${MARK_WHITE}" x="${W-42}" y="9" width="18" height="18" opacity="0.65"/>

<!-- Issuer -->
<text x="${M}" y="22" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4" fill="${t.issuer}">THE SEALER PROTOCOL</text>

<!-- Title -->
<text x="${M}" y="44" font-family="Cormorant Garamond,serif" font-size="20" font-weight="600" letter-spacing="1" fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>

<!-- Wax seal PNG — right side, all states -->
<image href="${SEAL_URLS[s.state]}" x="${SEAL_X}" y="${SEAL_Y}" width="${SEAL_W}" height="${SEAL_W}" opacity="0.92" preserveAspectRatio="xMidYMid meet"/>

<!-- Category -->
<text x="${M}" y="57" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2.5" fill="${t.cat}">CATEGORY: ${esc(p.claimType.replace(/_/g, ' ').toUpperCase())}</text>

<!-- State subtitle -->
<text x="${M}" y="70" font-family="Courier Prime,monospace" font-size="6" letter-spacing="3" fill="${t.subCol}" opacity="0.85">${
  s.state === 'full'    ? '\u2605 FULLY ACHIEVED \u00B7 ALL METRICS MET' :
  s.state === 'partial' ? `\u25D1 PARTIALLY ACHIEVED \u00B7 ${s.perMetric.filter(m => m.met).length} OF ${s.perMetric.length} METRICS MET` :
                          '\u2717 FAILED \u00B7 NO METRICS MET AT DEADLINE'
}</text>

<!-- Right meta — between logo and seal -->
<text x="${META_X}" y="35" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="${t.metaLabel}" text-anchor="end">${t.metaStatus}</text>
<text x="${META_X}" y="47" font-family="Courier Prime,monospace" font-size="6.5" fill="${t.metaVal}"   text-anchor="end">${esc(p.issuedAt)}</text>
<text x="${META_X}" y="58" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.uidCol}"    text-anchor="end">UID: ${p.uid.slice(0, 6)}\u2026${p.uid.slice(-4)}</text>

<!-- ══ AGENT STRIP ══ -->
<rect x="0" y="${AGENT_Y}" width="${W}" height="${AGENT_H}" fill="${t.agentBg}"/>
<line x1="0" y1="${AGENT_Y}"          x2="${W}" y2="${AGENT_Y}"          stroke="${t.agentBdr}" stroke-width="0.6"/>
<line x1="0" y1="${AGENT_Y + AGENT_H}" x2="${W}" y2="${AGENT_Y + AGENT_H}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="${M}"   y="${AGENT_Y + 13}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" fill="#9a8050">AGENT ID</text>
<text x="${M}"   y="${AGENT_Y + 28}" font-family="Courier Prime,monospace" font-size="8"  font-weight="700" fill="#1a1000">${esc(p.agentId.slice(0, 6))}\u2026${esc(p.agentId.slice(-4))}</text>

<line x1="122" y1="${AGENT_Y + 6}" x2="122" y2="${AGENT_Y + AGENT_H - 6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="134"  y="${AGENT_Y + 13}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" fill="#9a8050">COMMITMENT ID</text>
<text x="134"  y="${AGENT_Y + 28}" font-family="Courier Prime,monospace" font-size="7"  font-weight="700" fill="#1a1000">${esc(p.commitmentId.slice(0, 6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="254" y1="${AGENT_Y + 6}" x2="254" y2="${AGENT_Y + AGENT_H - 6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<!-- Commitment text — centred vertically in strip -->
<text x="${W / 2}" y="${AGENT_Y + 24}" text-anchor="middle"
      font-family="IM Fell English,Georgia,serif" font-size="9" font-style="italic"
      fill="${t.agentTxt}" opacity="0.85"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(p.commitmentText.length > 76 ? p.commitmentText.slice(0, 76) + '\u2026' : p.commitmentText)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<line x1="${M}" y1="${TABLE_Y + 4}"            x2="${W - M}" y2="${TABLE_Y + 4}"            stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${M + 12}" y="${TABLE_Y + 17}"        font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050">METRIC</text>
<text x="${CW}"     y="${TABLE_Y + 17}"        font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">WEIGHT</text>
<text x="${CT}"     y="${TABLE_Y + 17}"        font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">TARGET</text>
<text x="${CA}"     y="${TABLE_Y + 17}"        font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">ACHIEVED</text>
<text x="${CD}"     y="${TABLE_Y + 17}"        font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">DELTA</text>
<line x1="${M}" y1="${TABLE_Y + COL_HDR_H - 2}" x2="${W - M}" y2="${TABLE_Y + COL_HDR_H - 2}" stroke="#e0d8c0" stroke-width="0.6"/>

${metricRows}

<!-- FAILED stamp -->
${failedStamp}

<!-- ══ SCORES ROW ══ -->

<!-- Achievement score — dark panel -->
<rect x="${SX1}" y="${scoresY}" width="${SW1}" height="${SH}" rx="3" fill="${t.scoreBg}" stroke="${t.scoreBdr}" stroke-width="0.6"/>
<text x="${SX1 + 12}" y="${SLY}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="${t.scoreLbl}" opacity="0.7">ACHIEVEMENT SCORE</text>
<text x="${SX1 + 12}" y="${SNY}" font-family="Cormorant Garamond,serif" font-size="32" font-weight="700" fill="${t.scoreNum}">${s.achievementScore}</text>
<text x="${SX1 + 12}" y="${SSY}" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.scoreLbl}" opacity="0.55">${
  s.hasOverachievement ? `Base ${s.baseScore} + overachievement bonus` :
  s.deadlineAdj !== 0  ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
  s.state === 'failed' ? 'No metrics met' :
                         'Clean delivery'
}</text>

<!-- Difficulty -->
<rect x="${SX2}" y="${scoresY}" width="${SW2}" height="${SH}" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${SX2 + 12}" y="${SLY}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">DIFFICULTY</text>
<text x="${SX2 + 12}" y="${SNY}" font-family="Cormorant Garamond,serif" font-size="32" font-weight="600" fill="#6a5030">${p.difficultyScore}</text>
<text x="${SX2 + 12}" y="${SSY}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${s.state === 'failed' ? 'Committed (locked)' : 'Committed difficulty'}</text>

<!-- Proof Points (was LB Points) -->
<rect x="${SX3}" y="${scoresY}" width="${SW3}" height="${SH}" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${SX3 + 12}" y="${SLY}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">PROOF POINTS</text>
<text x="${SX3 + 12}" y="${SNY}" font-family="Cormorant Garamond,serif" font-size="32" font-weight="600" fill="#6a5030">${s.proofPoints}</text>
<text x="${SX3 + 12}" y="${SSY}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${s.state === 'failed' ? 'No award' : 'Score \u00D7 Difficulty'}</text>

<!-- Badge -->
<rect x="${SX4}" y="${scoresY}" width="${SW4}" height="${SH}" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="${SX4 + SW4 / 2}" y="${SLY}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="middle">ACHIEVEMENT BADGE</text>
${s.badgeTier !== 'none' ? `
<rect x="${SX4 + 10}" y="${scoresY + 22}" width="${SW4 - 20}" height="20" rx="2"
      fill="${BADGE_COLOR[s.badgeTier]}" fill-opacity="0.15"
      stroke="${BADGE_COLOR[s.badgeTier]}" stroke-width="0.7"/>
<text x="${SX4 + SW4 / 2}" y="${scoresY + 35}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="9" font-weight="700" letter-spacing="2"
      fill="${BADGE_COLOR[s.badgeTier]}">${s.badgeTier.toUpperCase()}</text>
<text x="${SX4 + SW4 / 2}" y="${SSY}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" fill="#9a7050">From achievement score</text>
` : `
<text x="${SX4 + SW4 / 2}" y="${scoresY + 42}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="7" letter-spacing="1" fill="#9a2010">NOT ISSUED</text>
`}
${p.daysEarly > 0 ? `
<rect x="${SX4 + 10}" y="${scoresY + 52}" width="${SW4 - 20}" height="13" rx="2" fill="#f0f8f0" stroke="#80b890" stroke-width="0.6"/>
<text x="${SX4 + SW4 / 2}" y="${scoresY + 62}" text-anchor="middle"
      font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030">\u2713 ${p.daysEarly} days early</text>` : ''}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH - 36}" width="${W}" height="36" fill="${t.footBg}"/>
<line x1="0" y1="${svgH - 36}" x2="${W}" y2="${svgH - 36}" stroke="${t.footBdr}" stroke-width="0.6"/>

<text x="${M}"   y="${svgH - 22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="${M}"   y="${svgH - 10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.issuedAt)}</text>

<text x="150"    y="${svgH - 22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="150"    y="${svgH - 10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>

<text x="320"    y="${svgH - 22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="320"    y="${svgH - 10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>

<text x="${W - M}" y="${svgH - 20}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">THESEALER.XYZ</text>
<text x="${W - M}" y="${svgH - 10}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">EAS \u00B7 BASE</text>

</svg>`;
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  let metrics: MetricResult[] = [];
  try { metrics = JSON.parse(sp.get('metrics') ?? '[]'); } catch { metrics = []; }

  // Demo fallback — renders FULL state so the no-params URL looks good
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