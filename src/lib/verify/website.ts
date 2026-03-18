// src/lib/verify/website.ts
// Verifier for Website & App Delivery achievements
// Data sources:
//   - Google PageSpeed Insights API (public, no key needed)
//   - DNS TXT record verification (ownership proof)
//   - URLScan.io (uptime + content snapshot, public API)

import type { VerificationResult, AchievementLevel } from './types';

export interface WebsiteVerificationParams {
  agentWallet:        string;
  url:                string;
  dnsVerifyRecord?:   string;
  windowDays:         number;
  mintTimestamp:      number;
  minPerformanceScore?: number;
  minAccessibility?:    number;
  requireHttps?:        boolean;
  requireDnsVerify?:    boolean;
}

const THRESHOLDS: Record<AchievementLevel, {
  minPerformanceScore: number;
  minAccessibility:    number;
}> = {
  bronze: { minPerformanceScore: 50, minAccessibility: 50 },
  silver: { minPerformanceScore: 70, minAccessibility: 70 },
  gold:   { minPerformanceScore: 90, minAccessibility: 90 },
};

// ── PageSpeed Insights ────────────────────────────────────────────────────────

interface PageSpeedResult {
  performance:   number;
  accessibility: number;
  bestPractices: number;
  seo:           number;
  lcp:           number;
  fid:           number;
  cls:           number;
}

async function fetchPageSpeed(url: string): Promise<PageSpeedResult | null> {
  try {
    const apiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    apiUrl.searchParams.set('url',      url);
    apiUrl.searchParams.set('strategy', 'mobile');
    // FIX: must use .append() for repeated 'category' params — .set() overwrites,
    // so the previous code only sent 'accessibility', silently dropping 'performance'.
    apiUrl.searchParams.append('category', 'performance');
    apiUrl.searchParams.append('category', 'accessibility');
    apiUrl.searchParams.append('category', 'best-practices');
    apiUrl.searchParams.append('category', 'seo');

    const res  = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const data = await res.json();

    const cats   = data.lighthouseResult?.categories;
    const audits = data.lighthouseResult?.audits;
    if (!cats) return null;

    return {
      performance:   Math.round((cats.performance?.score   || 0) * 100),
      accessibility: Math.round((cats.accessibility?.score || 0) * 100),
      bestPractices: Math.round((cats['best-practices']?.score || 0) * 100),
      seo:           Math.round((cats.seo?.score || 0) * 100),
      lcp:           audits?.['largest-contentful-paint']?.numericValue || 0,
      fid:           audits?.['max-potential-fid']?.numericValue || 0,
      cls:           audits?.['cumulative-layout-shift']?.numericValue || 0,
    };
  } catch {
    return null;
  }
}

// ── DNS TXT Record Verification ───────────────────────────────────────────────

async function verifyDnsTxtRecord(
  domain:        string,
  expectedValue: string,
): Promise<boolean> {
  try {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const res  = await fetch(
      `https://dns.google/resolve?name=${cleanDomain}&type=TXT`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return false;
    const data = await res.json();
    const records: string[] = (data.Answer || [])
      .flatMap((a: any) => (a.data || '').replace(/"/g, '').split(' '));
    return records.some(r => r.includes(expectedValue));
  } catch {
    return false;
  }
}

// ── URLScan.io ────────────────────────────────────────────────────────────────

async function checkUrlScan(url: string): Promise<{
  reachable:   boolean;
  statusCode:  number | null;
  screenshot:  string | null;
}> {
  try {
    const searchRes = await fetch(
      `https://urlscan.io/api/v1/search/?q=page.url:"${encodeURIComponent(url)}"&size=1`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!searchRes.ok) return { reachable: false, statusCode: null, screenshot: null };

    const data    = await searchRes.json();
    const results = data.results || [];

    if (results.length === 0) {
      try {
        const headRes = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        return { reachable: headRes.ok, statusCode: headRes.status, screenshot: null };
      } catch {
        return { reachable: false, statusCode: null, screenshot: null };
      }
    }

    const latest = results[0];
    return {
      reachable:  true,
      statusCode: latest.page?.statusCode || 200,
      screenshot: latest.screenshot || null,
    };
  } catch {
    return { reachable: false, statusCode: null, screenshot: null };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isHttps(url: string): boolean {
  return url.trim().toLowerCase().startsWith('https://');
}

function determineLevel(
  performance:   number,
  accessibility: number,
): AchievementLevel | null {
  for (const level of ['gold', 'silver', 'bronze'] as AchievementLevel[]) {
    const t = THRESHOLDS[level];
    if (performance >= t.minPerformanceScore && accessibility >= t.minAccessibility) return level;
  }
  return null;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifyWebsiteAppDelivery(
  params:         WebsiteVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);
  const { url } = params;

  if (params.requireHttps !== false && !isHttps(url)) {
    return {
      passed:        false,
      failureReason: 'URL must use HTTPS.',
      evidence: { checkedAt: now, dataSource: 'pagespeed_dns_urlscan', attestationUID, rawMetrics: { url } },
    };
  }

  const [pageSpeed, urlScan] = await Promise.all([
    fetchPageSpeed(url),
    checkUrlScan(url),
  ]);

  let dnsVerified = false;
  if (params.dnsVerifyRecord && params.requireDnsVerify) {
    dnsVerified = await verifyDnsTxtRecord(url, params.dnsVerifyRecord);
  }

  const rawMetrics: Record<string, number | string | boolean> = {
    url,
    reachable:     urlScan.reachable,
    statusCode:    urlScan.statusCode || 0,
    https:         isHttps(url),
    dnsVerified,
    performance:   pageSpeed?.performance   || 0,
    accessibility: pageSpeed?.accessibility || 0,
    bestPractices: pageSpeed?.bestPractices || 0,
    seo:           pageSpeed?.seo           || 0,
    lcp:           pageSpeed?.lcp           || 0,
    cls:           pageSpeed?.cls           || 0,
    hasScreenshot: !!urlScan.screenshot,
    urlscanStatus: urlScan.reachable ? 'OK' : 'UNREACHABLE',
  };

  const evidence = {
    checkedAt:  now,
    dataSource: 'pagespeed_dns_urlscan',
    attestationUID,
    rawMetrics,
  };

  if (!urlScan.reachable) {
    return { passed: false, failureReason: `URL ${url} is not reachable.`, evidence };
  }

  if (params.requireDnsVerify && !dnsVerified) {
    return {
      passed:        false,
      failureReason: `DNS ownership verification failed. Add TXT record: thesealer-verify=${params.dnsVerifyRecord}`,
      evidence,
    };
  }

  if (!pageSpeed) {
    // PageSpeed unavailable — pass at bronze on reachability alone
    return {
      passed: true,
      level:  'bronze',
      evidence: { ...evidence, rawMetrics: { ...rawMetrics, note: 'PageSpeed unavailable — bronze on reachability' } },
    };
  }

  const level = determineLevel(pageSpeed.performance, pageSpeed.accessibility);

  if (!level) {
    return {
      passed:        false,
      failureReason: `Performance ${pageSpeed.performance}/100, accessibility ${pageSpeed.accessibility}/100 — both must reach 50 for bronze.`,
      evidence,
    };
  }

  return { passed: true, level, evidence };
}