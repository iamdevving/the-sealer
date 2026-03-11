// src/app/api/certificate/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Sealer Protocol — Certificate SVG Route
// States: FULL | PARTIAL | FAILED
// Seal PNGs: /public/seals/{fully-achieved,partially-achieved,failed-seal}.png
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.thesealer.xyz';

const SEAL_URLS = {
  full:    `${BASE_URL}/seals/fully-achieved.png`,
  partial: `${BASE_URL}/seals/partially-achieved.png`,
  failed:  `${BASE_URL}/seals/failed-seal.png`,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetricResult {
  label:    string;   // "Success Rate"
  weight:   number;   // 0.60  (normalised, sum = 1.0)
  target:   number;   // 97
  achieved: number;   // 99.2
  unit?:    string;   // "%", "$", "days"
}

interface CertificateParams {
  agentId:         string;
  commitmentId:    string;
  commitmentText:  string;
  claimType:       string;
  metrics:         MetricResult[];
  difficultyScore: number;   // 0–100 from commitment NFT
  deadlineDays:    number;   // total window length
  daysEarly:       number;   // negative = closed late
  closedEarly:     boolean;
  issuedAt:        string;   // "March 10, 2026"
  periodStart:     string;
  periodEnd:       string;
  uid:             string;   // EAS attestation UID (full 66-char hex)
}

type BadgeTier  = 'gold' | 'silver' | 'bronze' | 'none';
type CertState  = 'full' | 'partial' | 'failed';

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

function computeScoring(p: CertificateParams): ScoringResult {
  const dlMult   = deadlineMultiplier(p.deadlineDays);
  const bonusCap = 10 * Math.pow(1.0 / dlMult, 3);   // inverse cubic anti-sandbagging

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
  const leaderboardPoints = (achievementScore * p.difficultyScore) / 100;

  const metCount = perMetric.filter(m => m.met).length;
  const state: CertState =
    metCount === 0                ? 'failed'  :
    metCount < perMetric.length   ? 'partial' : 'full';

  const badgeTier: BadgeTier =
    achievementScore < 40 ? 'none'   :
    achievementScore < 70 ? 'bronze' :
    achievementScore < 90 ? 'silver' : 'gold';

  return {
    state,
    achievementScore:   r1(achievementScore),
    leaderboardPoints:  r1(leaderboardPoints),
    badgeTier,
    perMetric,
    deadlineAdj:  r1(deadlineAdj),
    baseScore:    r1(baseScore),
    hasOverachievement: perMetric.some(m => m.over),
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtVal(val: number, unit?: string): string {
  if (!unit)        return String(r1(val));
  if (unit === '$') return `$${Math.round(val).toLocaleString()}`;
  if (unit === '%') return `${r1(val)}%`;
  return `${val} ${unit}`;
}

function fmtDelta(m: PerMetricResult): string {
  if (m.defaulted) return 'Defaulted';
  if (!m.met) return `\u2212${fmtVal(Math.abs(m.delta), m.unit)}`;
  if (m.over) return `+${fmtVal(m.delta, m.unit)}`;
  return 'On target';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Theme ─────────────────────────────────────────────────────────────────────

const THEME = {
  full:    { hdr: '#2d1f0e', accent: '#c9a84c', issuer: '#c9a84c', cat: '#b8964a', titleCol: '#f0e8d0', subCol: '#c9a84c', metaLabel: '#6a5030', metaVal: '#c0a870', uid: '#6a5030', agentBg: '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#4a3a10', footBg: '#f0ebe0', footBdr: '#e0d8c0', accentGrad: '#c9a84c', frameBdr: '#c9a84c' },
  partial: { hdr: '#2d1f0e', accent: '#c9a84c', issuer: '#c9a84c', cat: '#b8964a', titleCol: '#f0e8d0', subCol: '#6a9aaa', metaLabel: '#6a5030', metaVal: '#c0a870', uid: '#6a5030', agentBg: '#f5f0e4', agentBdr: '#e0d8c0', agentTxt: '#4a3a10', footBg: '#f0ebe0', footBdr: '#e0d8c0', accentGrad: '#7a9aaa', frameBdr: '#7a9aaa' },
  failed:  { hdr: '#1a0808', accent: '#c04040', issuer: '#c04040', cat: '#8a3030', titleCol: '#e8c0c0', subCol: '#c04040', metaLabel: '#6a2020', metaVal: '#c08080', uid: '#6a2020', agentBg: '#fdf5f5', agentBdr: '#e8d0d0', agentTxt: '#4a1a1a', footBg: '#fdf0f0', footBdr: '#e8d0d0', accentGrad: '#8a2020', frameBdr: '#8a2020' },
};

const BADGE_COLOR: Record<BadgeTier, string> = {
  gold: '#c9a84c', silver: '#a0a8b0', bronze: '#cd9060', none: '#666',
};

// ── SVG Builder ───────────────────────────────────────────────────────────────

function buildSVG(p: CertificateParams, s: ScoringResult): string {
  const W   = 660;
  const t   = THEME[s.state];

  // ── Metric rows ──
  const ROW_H    = 38;
  const ROWS_TOP = 200;
  const metricRows = s.perMetric.map((m, i) => {
    const y      = ROWS_TOP + i * ROW_H;
    const isFail = s.state === 'failed';
    const bg     = m.met ? '#f0f8f0' : (isFail ? '#fdf0f0' : '#fdf5f0');
    const bdr    = m.met ? '#c0d8b0' : (isFail ? '#e8c0c0' : '#e0c0b0');
    const achClr = m.met ? (m.over ? '#1a5040' : '#2a6030') : '#8a3020';
    const dClr   = m.over ? '#1a6050' : (m.met ? '#2a6030' : '#9a2010');

    return `
    <rect x="32" y="${y}" width="596" height="${ROW_H - 2}" rx="3" fill="${bg}" stroke="${bdr}" stroke-width="0.6"/>
    <text x="44"  y="${y+12}" font-family="Courier Prime,monospace" font-size="7"  font-weight="700" letter-spacing="1.5" fill="#3a2a10">${esc(m.label.toUpperCase())}</text>
    <text x="44"  y="${y+24}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">${Math.round(m.weight * 100)}% weight</text>
    <text x="230" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="#6a5030" text-anchor="middle">${esc(fmtVal(m.target, m.unit))}</text>
    <text x="370" y="${y+22}" font-family="Cormorant Garamond,serif" font-size="14" font-weight="600" fill="${achClr}" text-anchor="middle">${m.defaulted ? '\u2014' : esc(fmtVal(m.achieved, m.unit))}</text>
    <text x="490" y="${y+18}" font-family="Courier Prime,monospace" font-size="7"  font-weight="700" fill="${dClr}" text-anchor="middle">${esc(fmtDelta(m))}</text>
    ${m.over ? `<rect x="452" y="${y+22}" width="76" height="11" rx="2" fill="none" stroke="#a0d0b0" stroke-width="0.6"/>
    <text x="490" y="${y+30}" font-family="Courier Prime,monospace" font-size="5.5" fill="#1a5030" text-anchor="middle">\u2191 Overachieved</text>` : ''}
    <text x="635" y="${y+22}" font-family="Courier Prime,monospace" font-size="11" fill="${m.met ? '#2a7040' : '#9a2010'}" text-anchor="middle">${m.met ? '\u2713' : '\u2717'}</text>`;
  }).join('');

  // ── Scores row ──
  const scoresY  = ROWS_TOP + s.perMetric.length * ROW_H + 12;
  const svgH     = scoresY + 70 + 36; // scores block + footer

  // ── FAILED stamp — sad seal PNG + FAILED text ──
  const failedStamp = s.state === 'failed' ? `
    <g transform="translate(330,${scoresY - 16}) rotate(-4)">
      <rect x="-108" y="-26" width="216" height="52" rx="3" fill="none" stroke="#c03030" stroke-width="3" opacity="0.82"/>
      <image href="${SEAL_URLS.failed}" x="-102" y="-22" width="40" height="40" opacity="0.85"/>
      <text x="14" y="-4"  text-anchor="middle" font-family="Courier Prime,monospace" font-size="22" font-weight="700" letter-spacing="7" fill="#c03030" opacity="0.82">FAILED</text>
      <text x="14" y="14" text-anchor="middle" font-family="Courier Prime,monospace" font-size="6"  letter-spacing="2" fill="#c03030" opacity="0.65">${esc(p.issuedAt.toUpperCase())} \u00B7 NO METRICS MET</text>
    </g>` : '';

  // ── Accent gradient def ──
  const gradId = `ag_${s.state}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${svgH}" viewBox="0 0 ${W} ${svgH}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <style>@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&amp;family=Courier+Prime:wght@400;700&amp;family=IM+Fell+English:ital@0;1&amp;display=swap');</style>
  <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%"   stop-color="#1a1200"/>
    <stop offset="30%"  stop-color="${t.accentGrad}"/>
    <stop offset="60%"  stop-color="${t.accentGrad}" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="#1a1200"/>
  </linearGradient>
</defs>

<!-- Background -->
<rect width="${W}" height="${svgH}" fill="#faf8f0"/>

<!-- Outer decorative frame -->
<rect x="-4" y="-4" width="${W+8}" height="${svgH+8}" rx="6" fill="none" stroke="${t.frameBdr}" stroke-width="1" opacity="0.4"/>
<rect x="-1" y="-1" width="${W+2}" height="${svgH+2}" rx="5" fill="none" stroke="${t.frameBdr}" stroke-width="0.5" opacity="0.25"/>

<!-- Top accent bar -->
<rect x="0" y="0" width="${W}" height="5" rx="0" fill="url(#${gradId})"/>

<!-- ══ HEADER ══ -->
<rect x="0" y="5" width="${W}" height="110" fill="${t.hdr}"/>

<!-- Issuer -->
<text x="32" y="22" font-family="Courier Prime,monospace" font-size="7" font-weight="700" letter-spacing="4" fill="${t.issuer}">THE SEALER PROTOCOL</text>

<!-- Title row: title + seal PNG inline -->
<text x="32" y="50" font-family="Cormorant Garamond,serif" font-size="20" font-weight="600" letter-spacing="1" fill="${t.titleCol}">${s.state === 'failed' ? 'Commitment Record' : 'Certificate of Achievement'}</text>
<image href="${SEAL_URLS[s.state]}" x="390" y="14" width="90" height="90" opacity="0.9"/>

<!-- Category strip -->
<text x="32" y="65" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2.5" fill="${t.cat}">CATEGORY: ${esc(p.claimType.replace(/_/g, ' ').toUpperCase())}</text>

<!-- State subtitle -->
<text x="32" y="79" font-family="Courier Prime,monospace" font-size="6" letter-spacing="3" fill="${t.subCol}" opacity="0.85">${
  s.state === 'full'    ? '\u2605 FULLY ACHIEVED \u00B7 ALL METRICS MET' :
  s.state === 'partial' ? `\u25D1 PARTIALLY ACHIEVED \u00B7 ${s.perMetric.filter(m=>m.met).length} OF ${s.perMetric.length} METRICS MET` :
                          '\u2717 FAILED \u00B7 NO METRICS MET AT DEADLINE'
}</text>

<!-- Right meta — pushed down 22px to align below seal top -->
<text x="${W-32}" y="46" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="${t.metaLabel}" text-anchor="end">${s.state === 'failed' ? 'CLOSED' : 'VERIFIED'}</text>
<text x="${W-32}" y="58" font-family="Courier Prime,monospace" font-size="6.5" fill="${t.metaVal}"   text-anchor="end">${esc(p.issuedAt)}</text>
<text x="${W-32}" y="69" font-family="Courier Prime,monospace" font-size="5.5" fill="${t.uid}"       text-anchor="end">UID: ${p.uid.slice(0,6)}\u2026${p.uid.slice(-4)}</text>

<!-- ══ AGENT STRIP ══ -->
<rect x="0" y="115" width="${W}" height="42" fill="${t.agentBg}"/>
<line x1="0" y1="115" x2="${W}" y2="115" stroke="${t.agentBdr}" stroke-width="0.6"/>
<line x1="0" y1="157" x2="${W}" y2="157" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="32"  y="128" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="#9a8050">AGENT ID</text>
<text x="32"  y="141" font-family="Courier Prime,monospace" font-size="8"   font-weight="700"    fill="#1a1000">${esc(p.agentId.slice(0,6))}\u2026${esc(p.agentId.slice(-4))}</text>

<line x1="130" y1="120" x2="130" y2="152" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="142" y="128" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2.5" fill="#9a8050">COMMITMENT ID</text>
<text x="142" y="141" font-family="Courier Prime,monospace" font-size="7"   font-weight="700"    fill="#1a1000">${esc(p.commitmentId.slice(0,6))}\u2026${esc(p.commitmentId.slice(-4))}</text>

<line x1="260" y1="120" x2="260" y2="152" stroke="${t.agentBdr}" stroke-width="0.6"/>

<text x="272" y="138" font-family="IM Fell English,Georgia,serif" font-size="9" font-style="italic"
      fill="${t.agentTxt}" opacity="0.85"
      ${s.state === 'failed' ? 'text-decoration="line-through"' : ''}>&quot;${esc(p.commitmentText.length > 82 ? p.commitmentText.slice(0,82) + '\u2026' : p.commitmentText)}&quot;</text>

<!-- ══ METRICS TABLE ══ -->
<line x1="32" y1="168" x2="${W-32}" y2="168" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="44"  y="184" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050">METRIC</text>
<text x="230" y="184" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">TARGET</text>
<text x="370" y="184" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">ACHIEVED</text>
<text x="490" y="184" font-family="Courier Prime,monospace" font-size="5" letter-spacing="3" fill="#9a8050" text-anchor="middle">DELTA</text>
<line x1="32" y1="190" x2="${W-32}" y2="190" stroke="#e0d8c0" stroke-width="0.6"/>

${metricRows}

<!-- ══ SCORES ROW ══ -->
<!-- Achievement score — dark panel -->
<rect x="32"  y="${scoresY}" width="222" height="66" rx="3" fill="#1a1200"/>
<text x="44"  y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">ACHIEVEMENT SCORE</text>
<text x="44"  y="${scoresY+48}" font-family="Cormorant Garamond,serif" font-size="36" font-weight="600" fill="${BADGE_COLOR[s.badgeTier]}">${s.achievementScore}</text>
<text x="44"  y="${scoresY+61}" font-family="Courier Prime,monospace" font-size="5.5" fill="#6a5030">${
  s.hasOverachievement     ? `Base ${s.baseScore} + overachievement bonus` :
  s.deadlineAdj !== 0      ? `Base ${s.baseScore} \u00B7 adj ${s.deadlineAdj > 0 ? '+' : ''}${s.deadlineAdj}` :
  s.state === 'failed'     ? 'No metrics met' :
                             'Clean delivery'
}</text>

<!-- Difficulty score -->
<rect x="262" y="${scoresY}" width="118" height="66" rx="3" fill="#f0ebe0" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="274" y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">DIFFICULTY</text>
<text x="274" y="${scoresY+48}" font-family="Cormorant Garamond,serif" font-size="36" font-weight="600" fill="#6a5030">${p.difficultyScore}</text>
<text x="274" y="${scoresY+61}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">Committed difficulty</text>

<!-- Leaderboard points -->
<rect x="388" y="${scoresY}" width="118" height="66" rx="3" fill="#f0ebe0" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="400" y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="3" fill="#9a8050">LB POINTS</text>
<text x="400" y="${scoresY+48}" font-family="Cormorant Garamond,serif" font-size="36" font-weight="600" fill="#6a5030">${s.leaderboardPoints}</text>
<text x="400" y="${scoresY+61}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a8050">Achievement \u00D7 Difficulty</text>

<!-- Badge -->
<rect x="514" y="${scoresY}" width="114" height="66" rx="3" fill="#f0ebe0" stroke="#e0d8c0" stroke-width="0.6"/>
<text x="571" y="${scoresY+15}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="middle">ACHIEVEMENT BADGE</text>
${s.badgeTier !== 'none' ? `
<rect x="530" y="${scoresY+24}" width="82" height="20" rx="3" fill="${BADGE_COLOR[s.badgeTier]}"/>
<text x="571" y="${scoresY+37}" font-family="Courier Prime,monospace" font-size="8" font-weight="700" letter-spacing="2" fill="#fff" text-anchor="middle">${s.badgeTier.toUpperCase()}</text>
<text x="571" y="${scoresY+55}" font-family="Courier Prime,monospace" font-size="5.5" fill="#9a7050" text-anchor="middle">From achievement score</text>
` : `
<text x="571" y="${scoresY+40}" font-family="Courier Prime,monospace" font-size="7" fill="#9a2010" text-anchor="middle">NOT ISSUED</text>
`}
${p.daysEarly > 0 ? `
<rect x="530" y="${scoresY+48}" width="82" height="13" rx="2" fill="none" stroke="#a0c0a0" stroke-width="0.7"/>
<text x="571" y="${scoresY+58}" font-family="Courier Prime,monospace" font-size="5.5" fill="#2a6030" text-anchor="middle">\u2713 ${p.daysEarly} days early</text>` : ''}

<!-- FAILED stamp overlay -->
${failedStamp}

<!-- ══ FOOTER ══ -->
<rect x="0" y="${svgH-36}" width="${W}" height="36" fill="${t.footBg}"/>
<line x1="0" y1="${svgH-36}" x2="${W}" y2="${svgH-36}" stroke="${t.footBdr}" stroke-width="0.6"/>

<text x="32"      y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'CLOSED' : 'ISSUED'}</text>
<text x="32"      y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.issuedAt)}</text>

<text x="150"     y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">COMMITMENT PERIOD</text>
<text x="150"     y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${esc(p.periodStart)} \u2014 ${esc(p.periodEnd)}</text>

<text x="310"     y="${svgH-22}" font-family="Courier Prime,monospace" font-size="5"   letter-spacing="2" fill="#9a8050">${s.state === 'failed' ? 'RECORD' : 'VERIFIER'}</text>
<text x="310"     y="${svgH-10}" font-family="Courier Prime,monospace" font-size="6.5" fill="#3a2a10">${s.state === 'failed' ? 'Permanent \u00B7 EAS onchain' : p.claimType.includes('x402') ? 'x402 on-chain \u00B7 auto' : 'automated \u00B7 api'}</text>

<text x="${W-32}" y="${svgH-20}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">THESEALER.XYZ</text>
<text x="${W-32}" y="${svgH-10}" font-family="Courier Prime,monospace" font-size="5.5" letter-spacing="2" fill="#9a8050" text-anchor="end">EAS \u00B7 BASE</text>

</svg>`;
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  let metrics: MetricResult[] = [];
  try { metrics = JSON.parse(p.get('metrics') ?? '[]'); } catch { metrics = []; }

  const params: CertificateParams = {
    agentId:         p.get('agentId')       ?? '0x000000000000dead',
    commitmentId:    p.get('commitmentId')  ?? '0x000000000000dead',
    commitmentText:  p.get('commitment')    ?? 'Commitment text not provided',
    claimType:       p.get('claimType')     ?? 'unknown',
    metrics,
    difficultyScore: Number(p.get('difficulty')   ?? 68),
    deadlineDays:    Number(p.get('deadlineDays') ?? 30),
    daysEarly:       Number(p.get('daysEarly')    ?? 0),
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