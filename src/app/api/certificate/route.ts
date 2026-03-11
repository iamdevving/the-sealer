// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route v3
// Matches HTML prototype exactly:
//  - Compact header with inline SVG ink-seal (not wax PNG)
//  - MARK_WHITE logo 20×20 top-right corner
//  - Weight column in metrics table
//  - Inline SVG sad-face in FAILED stamp (no PNG dependency)
//  - daysEarly=0 default (no pill unless explicitly passed)
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { MARK_WHITE } from '@/lib/assets';

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
  leaderboardPoints:  number;
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
  const lbPoints         = (achievementScore * p.difficultyScore) / 100;

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
    leaderboardPoints:  r1(lbPoints),
    badgeTier,
    perMetric,
    deadlineAdj:  r1(deadlineAdj),
    baseScore:    r1(baseScore),
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
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Inline ink seal SVGs (matching prototype exactly) ────────────────────────

function inkSeal(state: CertState): string {
  const id = `arc_${state}`;
  if (state === 'full') return `
    <svg width="50" height="50" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="56" fill="none" stroke="#c9a84c" stroke-width="3"/>
      <circle cx="60" cy="60" r="48" fill="none" stroke="#c9a84c" stroke-width="0.8" opacity="0.5"/>
      <path id="${id}t" d="M 12,60 A 48,48 0 0,1 108,60" fill="none"/>
      <text font-family="Courier Prime,monospace" font-size="10" font-weight="700" fill="#c9a84c" letter-spacing="2.5">
        <textPath href="#${id}t" startOffset="9%">THE SEALER PROTOCOL</textPath>
      </text>
      <path id="${id}b" d="M 18,72 A 44,44 0 0,0 102,72" fill="none"/>
      <text font-family="Courier Prime,monospace" font-size="9.5" font-weight="700" fill="#c9a84c" letter-spacing="2">
        <textPath href="#${id}b" startOffset="13%">FULLY ACHIEVED</textPath>
      </text>
      <text x="60" y="62" text-anchor="middle" font-size="14" fill="#c9a84c" opacity="0.6" font-family="serif">&#9733;</text>
    </svg>`;

  if (state === 'partial') return `
    <svg width="50" height="50" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="56" fill="none" stroke="#cd9060" stroke-width="3"/>
      <circle cx="60" cy="60" r="48" fill="none" stroke="#cd9060" stroke-width="0.8" opacity="0.5"/>
      <path id="${id}t" d="M 12,60 A 48,48 0 0,1 108,60" fill="none"/>
      <text font-family="Courier Prime,monospace" font-size="10" font-weight="700" fill="#cd9060" letter-spacing="2.5">
        <textPath href="#${id}t" startOffset="9%">THE SEALER PROTOCOL</textPath>
      </text>
      <path id="${id}b" d="M 14,72 A 46,46 0 0,0 106,72" fill="none"/>
      <text font-family="Courier Prime,monospace" font-size="9" font-weight="700" fill="#cd9060" letter-spacing="1.5">
        <textPath href="#${id}b" startOffset="8%">PARTIALLY ACHIEVED</textPath>
      </text>
      <text x="60" y="62" text-anchor="middle" font-size="14" fill="#cd9060" opacity="0.6" font-family="serif">&#9681;</text>
    </svg>`;

  // failed
  return `
    <svg width="50" height="50" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="56" fill="none" stroke="#c03030" stroke-width="3"/>
      <circle cx="60" cy="60" r="48" fill="none" stroke="#c03030" stroke-width="0.8" opacity="0.5"/>
      <path id="${id}t" d="M 12,60 A 48,48 0 0,1 108,60" fill="none"/>
      <text font-family="Courier Prime,monospace" font-size="10" font-weight="700" fill="#c03030" letter-spacing="2.5">
        <textPath href="#${id}t" startOffset="9%">THE SEALER PROTOCOL</textPath>
      </text>
      <path id="${id}b" d="M 22,74 A 42,42 0 0,0 98,74" fill="none"/>
      <text font-family="Courier Prime,monospace" font-size="9" font-weight="700" fill="#c03030" letter-spacing="2">
        <textPath href="#${id}b" startOffset="16%">COMMITMENT FAILED</textPath>
      </text>
      <circle cx="60" cy="54" r="14" fill="none" stroke="#c03030" stroke-width="1.2" opacity="0.5"/>
      <circle cx="55" cy="51" r="1.5" fill="#c03030" opacity="0.7"/>
      <circle cx="65" cy="51" r="1.5" fill="#c03030" opacity="0.7"/>
      <path d="M 54,60 Q 60,56 66,60" fill="none" stroke="#c03030" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
      <line x1="44" y1="53" x2="52" y2="54" stroke="#c03030" stroke-width="1" opacity="0.5"/>
      <line x1="44" y1="56" x2="52" y2="56" stroke="#c03030" stroke-width="1" opacity="0.5"/>
      <line x1="68" y1="54" x2="76" y2="53" stroke="#c03030" stroke-width="1" opacity="0.5"/>
      <line x1="68" y1="56" x2="76" y2="56" stroke="#c03030" stroke-width="1" opacity="0.5"/>
    </svg>`;
}

// Inline sad-face SVG for FAILED stamp (no PNG dependency)
const SAD_SEAL_SVG = `
  <svg width="28" height="28" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" opacity="0.75">
    <circle cx="20" cy="20" r="18" fill="none" stroke="#c03030" stroke-width="2"/>
    <circle cx="13" cy="16" r="2" fill="#c03030"/>
    <circle cx="27" cy="16" r="2" fill="#c03030"/>
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
    metaLabel: '#6a5030', metaVal: '#c0a870', uid: '#6a5030',
    agentBg: '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg: '#f0ebe0', footBdr: '#e0d8c0',
    accentL: '#1a1200', accentM: '#c9a84c', frameBdr: '#c9a84c',
    scoreBg: '#2d1f0e', scoreBdr: '#c9a84c', scoreValCol: '#c9a84c', scoreLbl: '#c9a84c',
    metaStatus: 'VERIFIED',
  },
  partial: {
    hdr: '#2d1f0e', issuer: '#c9a84c', cat: '#b8964a', titleCol: '#f0e8d0', subCol: '#6a9aaa',
    metaLabel: '#6a5030', metaVal: '#c0a870', uid: '#6a5030',
    agentBg: '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#3a2a10',
    footBg: '#f0ebe0', footBdr: '#e0d8c0',
    accentL: '#0a0a12', accentM: '#7a9aaa', frameBdr: '#7a9aaa',
    scoreBg: '#0a1a28', scoreBdr: '#6a9aaa', scoreValCol: '#cd9060', scoreLbl: '#6a9aaa',
    metaStatus: 'VERIFIED',
  },
  failed: {
    hdr: '#1a0808', issuer: '#c04040', cat: '#8a3030', titleCol: '#e8c0c0', subCol: '#c04040',
    metaLabel: '#6a2020', metaVal: '#c08080', uid: '#6a2020',
    agentBg: '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a',
    footBg: '#fdf0f0', footBdr: '#e8d0d0',
    accentL: '#1a0808', accentM: '#8a2020', frameBdr: '#8a2020',
    scoreBg: '#1a0808', scoreBdr: '#8a2020', scoreValCol: '#e05050', scoreLbl: '#c04040',
    metaStatus: 'CLOSED',
  },
};

const BADGE_COLOR: Record<BadgeTier, string> = {
  gold: '#c9a84c', silver: '#a0a8b0', bronze: '#cd9060', none: '#666',
};

// ── SVG Builder ───────────────────────────────────────────────────────────────

function buildSVG(p: CertificateParams, s: ScoringResult): string {
  const W = 660;
  const t = THEME[s.state];

  // ── Layout constants ──
  const HDR_H     = 78;   // compact header, same for all states
  const AGENT_Y   = HDR_H + 5;   // +5 for accent bar
  const AGENT_H   = 42;
  const TABLE_Y   = AGENT_Y + AGENT_H;
  const COL_HDR_H = 24;
  const ROW_H     = 38;
  const ROWS_TOP  = TABLE_Y + COL_HDR_H;

  // Column X centres: Metric=label, Weight=190, Target=280, Achieved=380, Delta=480, Status=630
  const CW = 190, CT = 280, CA = 380, CD = 480, CS = 630;

  // ── Metric rows ──
  const metricRows = s.perMetric.map((m, i) => {
    const y      = ROWS_TOP + i * ROW_H;
    const isFail = s.state === 'failed';
    const rowBg  = m.met ? '#f2f8f0' : (isFail ? '#faf0f0' : '#fdf5f0');
    const rowBdr = m.met ? '#c8dcc0' : (isFail ? '#e0c0c0' : '#e8c8b0');
    const achClr = m.met ? (m.over ? '#1a5040' : '#2a6030') : '#8a3020';
    const dClr   = m.over ? '#1a6050' : (m.met ? '#2a6030' : '#9a2010');
    const stClr  = m.met ? '#2a7040' : '#c03030';

    return `
  <rect x="32" y="${y}" width="596" height="${ROW_H-3}" rx="3" fill="${rowBg}" stroke="${rowBdr}" stroke-width="0.6"/>
  <text x="44"  y="${y+13}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="1.5" fill="#3a2a10">${esc(m.label.toUpperCase())}</text>
  <text x="44"  y="${y+24}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${s.state === 'failed' ? '' : 'Primary signal'}</text>
  <text x="${CW}" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="11" font-weight="600" fill="#6a5030" text-anchor="middle">${Math.round(m.weight*100)}%</text>
  <text x="${CT}" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="#6a5030" text-anchor="middle">${esc(fmtVal(m.target, m.unit))}</text>
  <text x="${CA}" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="${achClr}" text-anchor="middle">${m.defaulted ? '\u2014' : esc(fmtVal(m.achieved, m.unit))}</text>
  <text x="${CD}" y="${y+18}" font-family="Courier Prime,monospace" font-size="7" font-weight="700" fill="${dClr}" text-anchor="middle">${esc(fmtDelta(m))}</text>
  ${m.over ? `<rect x="${CD-38}" y="${y+21}" width="76" height="11" rx="2" fill="none" stroke="#a0d0b0" stroke-width="0.6"/>
  <text x="${CD}" y="${y+30}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2191 Overachieved</text>` : ''}
  <text x="${CS}" y="${y+22}" font-family="Courier Prime,monospace" font-size="11" fill="${stClr}" text-anchor="middle">${m.met ? '\u2713' : '\u2717'}</text>`;
  }).join('');

  // ── Scores row ──
  const scoresY = ROWS_TOP + s.perMetric.length * ROW_H + 14;
  const svgH    = scoresY + 70 + 36;

  // ── FAILED stamp — inline SVG face + text, no PNG ──
  // Positioned centred over metric table area
  const stampCY = ROWS_TOP + (s.perMetric.length * ROW_H) / 2;
  const failedStamp = s.state === 'failed' ? `
  <g transform="translate(310,${stampCY}) rotate(-4)">
    <rect x="-110" y="-28" width="220" height="60" rx="3" fill="rgba(250,240,240,0.85)" stroke="#c03030" stroke-width="3.5" opacity="0.82"/>
    <g transform="translate(-72,2)">${SAD_SEAL_SVG}</g>
    <text x="26"  y="-4"  text-anchor="middle" font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7" fill="#c03030" opacity="0.82">FAILED</text>
    <text x="26"  y="16"  text-anchor="middle" font-family="Courier Prime,monospace" font-size="6" letter-spacing="2" fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
  </g>` : '';

  // ── Gradient ──
  const gradId = `grad_${s.state}`;

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

<!-- Outer frame -->
<rect x="-4" y="-4" width="${W+8}" height="${svgH+8}" rx="6" fill="none" stroke="${t.frameBdr}" stroke-width="1" opacity="0.4"/>
<rect x="-1" y="-1" width="${W+2}" height="${svgH+2}" rx="5" fill="none" stroke="${t.frameBdr}" stroke-width="0.5" opacity="0.25"/>

<!-- Top accent bar -->
<rect x="0" y="0" width="${W}" height="5" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="${HDR_H}" fill="${t.hdr}"/>

<!-- Issuer -->
<text x="32" y="22" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4" fill="${t.issuer}">THE SEALER PROTOCOL</text>

<!-- Title + ink seal inline (seal floated right of title text) -->
<text x="32" y="45" font-family="Cormorant Garamond,serif" font-size="20" font-weight="600" letter-spacing="1" fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>
<g transform="translate(350,18)">${inkSeal(s.state)}</g>

<!-- Category -->
<text x="32" y="58" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2.5" fill="${t.cat}">CATEGORY: ${esc(p.claimType.replace(/_/g,' ').toUpperCase())}</text>

<!-- State subtitle -->
<text x="32" y="71" font-family="Courier Prime,monospace" font-size="6" letter-spacing="3" fill="${t.subCol}" opacity="0.85">${
  s.state === 'full'    ? '\u2605 FULLY ACHIEVED \u00B7 ALL METRICS MET' :
  s.state === 'partial' ? `\u25D1 PARTIALLY ACHIEVED \u00B7 ${s.perMetric.filter(m=>m.met).length} OF ${s.perMetric.length} METRICS MET` :
                          '\u2717 FAILED \u00B7 NO METRICS MET AT DEADLINE'
}</text>

<!-- Logo mark top-right (above meta labels) -->
<image href="${MARK_WHITE}" x="${W-50}" y="10" width="20" height="20" opacity="0.7"/>

<!-- Right meta -->
<text x="${W-32}" y="38" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="${t.metaLabel}" text-anchor="end">${t.metaStatus}</text>
<text x="${W-32}" y="50" font-family="Courier Prime,monospace" font-size="6.5" fill="${t.metaVal}"   text-anchor="end">${esc(p.issuedAt)}</text>
<text x="${W-32}" y="62" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.uid}"       text-anchor="end">UID: ${p.uid.slice(0,6)}\u2026${p.uid.slice(-4)}</text>

<!-- ══ AGENT STRIP ══ -->
<rect x="0" y="${AGENT_Y}" width="${W}" height="${AGENT_H}" fill="${t.agentBg}"/>
<line x1="0" y1="${AGENT_Y}"         x2="${W}" y2="${AGENT_Y}"         stroke="${t.agentBdr}" stroke-width="0.6"/>
<line x1="0" y1="${AGENT_Y+AGENT_H}" x2="${W}" y2="${AGENT_Y+AGENT_H}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="32"  y="${AGENT_Y+13}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" fill="#9a8050">AGENT ID</text>
<text x="32"  y="${AGENT_Y+28}" font-family="Courier Prime,monospace" font-size="8"  font-weight="700" fill="#1a1000">${esc(p.agentId.slice(0,6))}\u2026${esc(p.agentId.slice(-4))}</text>

<line x1="130" y1="${AGENT_Y+6}" x2="130" y2="${AGENT_Y+AGENT_H-6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="142" y="${AGENT_Y+13}" font-family="Courier Prime,monospace" font-size="5"  letter-spacing="2.5" fill="#9a8050">COMMITMENT ID</text>
<text x="142" y="${AGENT_Y+28}" font-family="Courier Prime,monospace" font-size="7"  font-weight="700" fill="#1a1000">${esc(p.commitmentId.slice(0,6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="262" y1="${AGENT_Y+6}" x2="262" y2="${AGENT_Y+AGENT_H-6}" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="274" y="${AGENT_Y+24}" font-family="IM Fell English,Georgia,serif" font-size="9" font-style="italic"
      fill="${t.agentTxt}" opacity="0.85"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(p.commitmentText.length > 80 ? p.commitmentText.slice(0,80)+'\u2026' : p.commitmentText)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<line x1="32" y1="${TABLE_Y+4}"   x2="${W-32}" y2="${TABLE_Y+4}"   stroke="#e0d8c0" stroke-width="0.6"/>
<text x="44"    y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050">METRIC</text>
<text x="${CW}" y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">WEIGHT</text>
<text x="${CT}" y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">TARGET</text>
<text x="${CA}" y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">ACHIEVED</text>
<text x="${CD}" y="${TABLE_Y+17}" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">DELTA</text>
<line x1="32" y1="${TABLE_Y+COL_HDR_H-2}" x2="${W-32}" y2="${TABLE_Y+COL_HDR_H-2}" stroke="#e0d8c0" stroke-width="0.6"/>

${metricRows}

<!-- FAILED stamp (over metric rows) -->
${failedStamp}

<!-- ══ SCORES ROW ══ -->
<!-- Achievement — dark panel -->
<rect x="32"  y="${scoresY}" width="222" height="66" rx="3" fill="${t.scoreBg}" stroke="${t.scoreBdr}" stroke-width="0.6"/>
<text x="44"  y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="${t.scoreLbl}" opacity="0.7">ACHIEVEMENT SCORE</text>
<text x="44"  y="${scoresY+48}" font-family="Cormorant Garamond,serif" font-size="36" font-weight="700" fill="${t.scoreValCol}">${s.achievementScore}</text>
<text x="44"  y="${scoresY+61}" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.scoreLbl}" opacity="0.6">${
  s.hasOverachievement ? `Base ${s.baseScore} + overachievement bonus` :
  s.deadlineAdj !== 0  ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
  s.state === 'failed' ? 'No metrics met' :
                         'Clean delivery'
}</text>

<!-- Difficulty -->
<rect x="262" y="${scoresY}" width="118" height="66" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="274" y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">DIFFICULTY</text>
<text x="274" y="${scoresY+48}" font-family="Cormorant Garamond,serif" font-size="36" font-weight="600" fill="#6a5030">${p.difficultyScore}</text>
<text x="274" y="${scoresY+61}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${s.state === 'failed' ? 'Committed difficulty (locked)' : 'Committed difficulty'}</text>

<!-- LB Points -->
<rect x="388" y="${scoresY}" width="118" height="66" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="400" y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">LB POINTS</text>
<text x="400" y="${scoresY+48}" font-family="Cormorant Garamond,serif" font-size="36" font-weight="600" fill="#6a5030">${s.leaderboardPoints}</text>
<text x="400" y="${scoresY+61}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${s.state === 'failed' ? 'No award' : 'Achievement \u00D7 Difficulty'}</text>

<!-- Badge -->
<rect x="514" y="${scoresY}" width="114" height="66" rx="3" fill="#f5f0e4" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="571" y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="middle">${s.state === 'failed' ? 'BADGE' : 'ACHIEVEMENT BADGE'}</text>
${s.badgeTier !== 'none' ? `
  <rect x="530" y="${scoresY+24}" width="82" height="18" rx="2" fill="${BADGE_COLOR[s.badgeTier]}" opacity="0.15" stroke="${BADGE_COLOR[s.badgeTier]}" stroke-width="0.6"/>
  <text x="571" y="${scoresY+36}" font-family="Courier Prime,monospace" font-size="8" font-weight="700" letter-spacing="2" fill="${BADGE_COLOR[s.badgeTier]}" text-anchor="middle">${s.badgeTier.toUpperCase()}</text>
  <text x="571" y="${scoresY+54}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a7050" text-anchor="middle">From achievement score</text>
` : `
  <text x="571" y="${scoresY+40}" font-family="Courier Prime,monospace" font-size="7" fill="#9a2010" text-anchor="middle" letter-spacing="1">NOT ISSUED</text>
`}
${p.daysEarly > 0 ? `
  <rect x="527" y="${scoresY+49}" width="88" height="13" rx="2" fill="#f0f8f0" stroke="#80b890" stroke-width="0.6"/>
  <text x="571" y="${scoresY+59}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2713 ${p.daysEarly} days early</text>` : ''}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH-36}" width="${W}" height="36" fill="${t.footBg}"/>
<line x1="0" y1="${svgH-36}" x2="${W}" y2="${svgH-36}" stroke="${t.footBdr}" stroke-width="0.6"/>

<text x="32"  y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="32"  y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.issuedAt)}</text>
<text x="150" y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="150" y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>
<text x="310" y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="310" y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>
<text x="${W-32}" y="${svgH-20}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">THESEALER.XYZ</text>
<text x="${W-32}" y="${svgH-10}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">EAS \u00B7 BASE</text>

</svg>`;
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  let metrics: MetricResult[] = [];
  try { metrics = JSON.parse(p.get('metrics') ?? '[]'); } catch { metrics = []; }

  // Demo fallback — shows a meaningful full certificate when no metrics passed
  if (metrics.length === 0) {
    metrics = [
      { label: 'Success Rate',   weight: 0.60, target: 97,  achieved: 99.2, unit: '%' },
      { label: 'Payment Volume', weight: 0.25, target: 500, achieved: 820,  unit: '$' },
      { label: 'Active Window',  weight: 0.15, target: 30,  achieved: 30 },
    ];
  }

  const params: CertificateParams = {
    agentId:         p.get('agentId')       ?? '0x000000000000dead',
    commitmentId:    p.get('commitmentId')  ?? '0x000000000000dead',
    commitmentText:  p.get('commitment')    ?? 'I commit to demonstrating reliable agent performance.',
    claimType:       p.get('claimType')     ?? 'unknown',
    metrics,
    difficultyScore: Number(p.get('difficulty')   ?? 68),
    deadlineDays:    Number(p.get('deadlineDays') ?? 30),
    daysEarly:       Number(p.get('daysEarly')    ?? 0),  // 0 = no pill shown
    closedEarly:     p.get('closedEarly') === 'true',
    issuedAt:    p.get('issuedAt')    ?? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    periodStart: p.get('periodStart') ?? '',
    periodEnd:   p.get('periodEnd')   ?? '',
    uid:         p.get('uid')         ?? '0x' + '0'.repeat(64),
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