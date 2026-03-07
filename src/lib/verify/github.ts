// src/lib/verify/github.ts
// Verifier for Code & Software Delivery achievements
// Data source: GitHub API (authenticated — reads private repos too)
// Verifies: merged PRs, commit count, CI pass rate, code volume

import type { VerificationResult, AchievementLevel } from './types';

export interface GithubVerificationParams {
  agentWallet:    string;
  repoOwner:      string;   // GitHub org or username
  repoName:       string;   // repo name
  githubUsername: string;   // GitHub username of the agent/human
  windowDays:     number;
  mintTimestamp:  number;
  // Optional thresholds
  minMergedPRs?:      number;
  minCommits?:        number;
  requireCIPass?:     boolean;
  minLinesChanged?:   number;
}

const THRESHOLDS: Record<AchievementLevel, {
  minMergedPRs:    number;
  minCommits:      number;
  minLinesChanged: number;
}> = {
  bronze: { minMergedPRs: 1,  minCommits: 5,   minLinesChanged: 50   },
  silver: { minMergedPRs: 5,  minCommits: 25,  minLinesChanged: 500  },
  gold:   { minMergedPRs: 20, minCommits: 100, minLinesChanged: 5000 },
};

const GH_API = 'https://api.github.com';

async function ghFetch(path: string): Promise<any> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');

  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Authorization:        `Bearer ${token}`,
      Accept:               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${path}`);
  return res.json();
}

// Paginate GitHub list endpoints (max 100 per page)
async function ghFetchAll(path: string, perPage = 100): Promise<any[]> {
  const results: any[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await ghFetch(`${path}${separator}per_page=${perPage}&page=${page}`);
    if (!data || !Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  return results;
}

function isInWindow(dateStr: string, mintTimestamp: number): boolean {
  return new Date(dateStr).getTime() / 1000 >= mintTimestamp;
}

async function fetchMergedPRs(
  owner:         string,
  repo:          string,
  username:      string,
  mintTimestamp: number,
): Promise<any[]> {
  // GitHub search API for merged PRs by author in repo
  const query    = `repo:${owner}/${repo} is:pr is:merged author:${username}`;
  const encoded  = encodeURIComponent(query);
  const data     = await ghFetch(`/search/issues?q=${encoded}&per_page=100`);
  if (!data?.items) return [];

  return data.items.filter((pr: any) => {
    const mergedAt = pr.pull_request?.merged_at;
    return mergedAt && isInWindow(mergedAt, mintTimestamp);
  });
}

async function fetchCommits(
  owner:         string,
  repo:          string,
  username:      string,
  mintTimestamp: number,
): Promise<any[]> {
  const since = new Date(mintTimestamp * 1000).toISOString();
  const data  = await ghFetchAll(
    `/repos/${owner}/${repo}/commits?author=${username}&since=${since}`
  );
  return data || [];
}

async function fetchLinesChanged(
  owner:   string,
  repo:    string,
  commits: any[],
): Promise<number> {
  // Sample up to 20 commits to avoid rate limits
  const sample = commits.slice(0, 20);
  let total    = 0;

  for (const commit of sample) {
    try {
      const detail = await ghFetch(`/repos/${owner}/${repo}/commits/${commit.sha}`);
      if (detail?.stats) {
        total += (detail.stats.additions || 0) + (detail.stats.deletions || 0);
      }
    } catch { /* skip */ }
  }

  // Extrapolate if we sampled
  if (commits.length > 20 && sample.length > 0) {
    total = Math.round((total / sample.length) * commits.length);
  }

  return total;
}

async function checkCIPassRate(
  owner:   string,
  repo:    string,
  commits: any[],
): Promise<{ passRate: number; checked: number }> {
  const sample  = commits.slice(0, 10);
  let passed    = 0;
  let checked   = 0;

  for (const commit of sample) {
    try {
      const runs = await ghFetch(
        `/repos/${owner}/${repo}/commits/${commit.sha}/check-runs`
      );
      if (runs?.check_runs?.length > 0) {
        checked++;
        const allPassed = runs.check_runs.every(
          (r: any) => r.conclusion === 'success' || r.conclusion === 'neutral'
        );
        if (allPassed) passed++;
      }
    } catch { /* skip */ }
  }

  return {
    passRate: checked > 0 ? (passed / checked) * 100 : 100,
    checked,
  };
}

function determineLevel(
  mergedPRs:    number,
  commits:      number,
  linesChanged: number,
): AchievementLevel | null {
  for (const level of ['gold', 'silver', 'bronze'] as AchievementLevel[]) {
    const t = THRESHOLDS[level];
    if (
      mergedPRs    >= t.minMergedPRs    &&
      commits      >= t.minCommits      &&
      linesChanged >= t.minLinesChanged
    ) return level;
  }
  return null;
}

export async function verifyCodeSoftwareDelivery(
  params:         GithubVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);
  const { repoOwner, repoName, githubUsername, mintTimestamp } = params;

  // Verify repo exists and is accessible
  const repo = await ghFetch(`/repos/${repoOwner}/${repoName}`);
  if (!repo) {
    return {
      passed:        false,
      failureReason: `Repository ${repoOwner}/${repoName} not found or not accessible.`,
      evidence: {
        checkedAt: now, dataSource: 'github_api',
        attestationUID, rawMetrics: {},
      },
    };
  }

  // Fetch all data in parallel
  const [prs, commits] = await Promise.all([
    fetchMergedPRs(repoOwner, repoName, githubUsername, mintTimestamp),
    fetchCommits(repoOwner, repoName, githubUsername, mintTimestamp),
  ]);

  const mergedPRCount = prs.length;
  const commitCount   = commits.length;

  // Lines changed (sampled)
  const linesChanged = commitCount > 0
    ? await fetchLinesChanged(repoOwner, repoName, commits)
    : 0;

  // CI pass rate (optional check)
  let ciPassRate   = 100;
  let ciChecked    = 0;
  if (params.requireCIPass && commitCount > 0) {
    const ci   = await checkCIPassRate(repoOwner, repoName, commits);
    ciPassRate = ci.passRate;
    ciChecked  = ci.checked;
  }

  const rawMetrics = {
    mergedPRCount,
    commitCount,
    linesChanged,
    ciPassRate:   parseFloat(ciPassRate.toFixed(1)),
    ciChecked,
    repo:         `${repoOwner}/${repoName}`,
    author:       githubUsername,
    windowDays:   params.windowDays,
  };

  const evidence = {
    checkedAt:  now,
    dataSource: 'github_api',
    attestationUID,
    rawMetrics,
  };

  if (commitCount === 0 && mergedPRCount === 0) {
    return {
      passed:        false,
      failureReason: `No commits or merged PRs found for ${githubUsername} in ${repoOwner}/${repoName} since commitment.`,
      evidence,
    };
  }

  // CI gate
  if (params.requireCIPass && ciPassRate < 80) {
    return {
      passed:        false,
      failureReason: `CI pass rate too low: ${ciPassRate.toFixed(1)}% (minimum 80% required).`,
      evidence,
    };
  }

  const level = determineLevel(mergedPRCount, commitCount, linesChanged);

  if (!level) {
    return {
      passed:        false,
      failureReason: `Did not meet bronze threshold. PRs=${mergedPRCount}, commits=${commitCount}, lines=${linesChanged}`,
      evidence,
    };
  }

  return { passed: true, level, evidence };
}