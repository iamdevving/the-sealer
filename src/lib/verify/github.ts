// src/lib/verify/github.ts
// Verifier for Code & Software Delivery achievements
// Data source: GitHub API (authenticated — reads private repos too)
// Verifies: merged PRs, commit count, CI pass rate, code volume
//
// Wallet ownership verification (when walletGithubSig is provided):
//   The agent must post a public GitHub Gist containing:
//     sealer-verify: <agentWallet>
//   The Gist must be authored by githubUsername.
//   This proves the GitHub account is controlled by the agent wallet owner.
//   Without this, any githubUsername could be claimed by any wallet.
//
//   How to create the Gist (agent-side):
//     POST https://api.github.com/gists
//     { "public": true, "files": { "sealer.txt": { "content": "sealer-verify: 0xYourWallet" } } }
//   Pass the returned Gist ID as walletGithubSig in the commitment params.

import type { VerificationResult, AchievementLevel } from './types';

export interface GithubVerificationParams {
  agentWallet:    string;
  repoOwner:      string;
  repoName:       string;
  githubUsername: string;
  windowDays:     number;
  mintTimestamp:  number;
  walletGithubSig?: string;  // Gist ID containing "sealer-verify: <agentWallet>"
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
      Authorization:          `Bearer ${token}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${path}`);
  return res.json();
}

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

// ── Wallet ownership via Gist ─────────────────────────────────────────────────
//
// Fetches the Gist by ID, checks:
//   1. The Gist owner is githubUsername
//   2. Any file in the Gist contains "sealer-verify: <agentWallet>" (case-insensitive)

async function verifyGistOwnership(
  gistId:        string,
  githubUsername: string,
  agentWallet:   string,
): Promise<{ verified: boolean; reason?: string }> {
  try {
    const gist = await ghFetch(`/gists/${gistId}`);
    if (!gist) {
      return { verified: false, reason: `Gist ${gistId} not found. Create a public Gist with content "sealer-verify: ${agentWallet}".` };
    }

    // Check Gist owner
    if (gist.owner?.login?.toLowerCase() !== githubUsername.toLowerCase()) {
      return { verified: false, reason: `Gist ${gistId} is owned by @${gist.owner?.login}, not @${githubUsername}.` };
    }

    // Check any file for the verification string
    const expectedContent = `sealer-verify: ${agentWallet.toLowerCase()}`;
    const files = Object.values(gist.files ?? {}) as any[];

    for (const file of files) {
      const content: string = (file.content ?? '').toLowerCase().trim();
      if (content.includes(expectedContent)) {
        return { verified: true };
      }
    }

    return {
      verified: false,
      reason:   `Gist ${gistId} does not contain "sealer-verify: ${agentWallet}". Add this text to any file in the Gist.`,
    };
  } catch (err) {
    return { verified: false, reason: `Failed to fetch Gist: ${String(err)}` };
  }
}

// ── PR / Commit helpers ───────────────────────────────────────────────────────

async function fetchMergedPRs(
  owner:         string,
  repo:          string,
  username:      string,
  mintTimestamp: number,
): Promise<any[]> {
  const query   = `repo:${owner}/${repo} is:pr is:merged author:${username}`;
  const encoded = encodeURIComponent(query);
  const data    = await ghFetch(`/search/issues?q=${encoded}&per_page=100`);
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
  return ghFetchAll(`/repos/${owner}/${repo}/commits?author=${username}&since=${since}`);
}

async function fetchLinesChanged(
  owner:   string,
  repo:    string,
  commits: any[],
): Promise<number> {
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
  const sample = commits.slice(0, 10);
  let passed   = 0;
  let checked  = 0;

  for (const commit of sample) {
    try {
      const runs = await ghFetch(`/repos/${owner}/${repo}/commits/${commit.sha}/check-runs`);
      if (runs?.check_runs?.length > 0) {
        checked++;
        const allPassed = runs.check_runs.every(
          (r: any) => r.conclusion === 'success' || r.conclusion === 'neutral'
        );
        if (allPassed) passed++;
      }
    } catch { /* skip */ }
  }

  return { passRate: checked > 0 ? (passed / checked) * 100 : 100, checked };
}

function determineLevel(
  mergedPRs:    number,
  commits:      number,
  linesChanged: number,
): AchievementLevel | null {
  for (const level of ['gold', 'silver', 'bronze'] as AchievementLevel[]) {
    const t = THRESHOLDS[level];
    if (mergedPRs >= t.minMergedPRs && commits >= t.minCommits && linesChanged >= t.minLinesChanged) {
      return level;
    }
  }
  return null;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifyCodeSoftwareDelivery(
  params:         GithubVerificationParams,
  attestationUID: string,
): Promise<VerificationResult> {
  const now = Math.floor(Date.now() / 1000);
  const { repoOwner, repoName, githubUsername, mintTimestamp } = params;

  // ── Wallet ownership gate ─────────────────────────────────────────────────
  // If walletGithubSig is provided, enforce it. If not provided, proceed but
  // flag in evidence that ownership was not verified.
  let ownershipVerified = false;
  let ownershipNote     = 'wallet_github_sig not provided — ownership unverified';

  if (params.walletGithubSig) {
    const check = await verifyGistOwnership(
      params.walletGithubSig,
      githubUsername,
      params.agentWallet,
    );
    if (!check.verified) {
      return {
        passed:        false,
        failureReason: `GitHub wallet ownership check failed: ${check.reason}`,
        evidence: {
          checkedAt: now, dataSource: 'github_api',
          attestationUID,
          rawMetrics: { ownershipVerified: false, gistId: params.walletGithubSig },
        },
      };
    }
    ownershipVerified = true;
    ownershipNote     = `verified via Gist ${params.walletGithubSig}`;
  }

  // ── Repo check ────────────────────────────────────────────────────────────
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

  // ── Fetch activity ────────────────────────────────────────────────────────
  const [prs, commits] = await Promise.all([
    fetchMergedPRs(repoOwner, repoName, githubUsername, mintTimestamp),
    fetchCommits(repoOwner, repoName, githubUsername, mintTimestamp),
  ]);

  const mergedPRCount = prs.length;
  const commitCount   = commits.length;

  const linesChanged = commitCount > 0
    ? await fetchLinesChanged(repoOwner, repoName, commits)
    : 0;

  let ciPassRate = 100;
  let ciChecked  = 0;
  if (params.requireCIPass && commitCount > 0) {
    const ci = await checkCIPassRate(repoOwner, repoName, commits);
    ciPassRate = ci.passRate;
    ciChecked  = ci.checked;
  }

  const rawMetrics = {
    mergedPRCount,
    commitCount,
    linesChanged,
    ciPassRate:        parseFloat(ciPassRate.toFixed(1)),
    ciChecked,
    repo:              `${repoOwner}/${repoName}`,
    author:            githubUsername,
    windowDays:        params.windowDays,
    ownershipVerified,
    ownershipNote,
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
      failureReason: `No commits or merged PRs found for @${githubUsername} in ${repoOwner}/${repoName} since commitment.`,
      evidence,
    };
  }

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
      failureReason: `Did not meet bronze threshold. Need: ${THRESHOLDS.bronze.minMergedPRs} PRs, ${THRESHOLDS.bronze.minCommits} commits, ${THRESHOLDS.bronze.minLinesChanged} lines. Got: ${mergedPRCount} PRs, ${commitCount} commits, ${linesChanged} lines.`,
      evidence,
    };
  }

  // Check committed thresholds on top of level
  const meetsMinPRs    = mergedPRCount >= (params.minMergedPRs    ?? 0);
  const meetsMinCommits = commitCount  >= (params.minCommits       ?? 0);
  const meetsMinLines  = linesChanged  >= (params.minLinesChanged  ?? 0);

  if (!meetsMinPRs || !meetsMinCommits || !meetsMinLines) {
    const reasons: string[] = [];
    if (!meetsMinPRs)     reasons.push(`PRs ${mergedPRCount} < ${params.minMergedPRs}`);
    if (!meetsMinCommits) reasons.push(`commits ${commitCount} < ${params.minCommits}`);
    if (!meetsMinLines)   reasons.push(`lines ${linesChanged} < ${params.minLinesChanged}`);
    return { passed: false, failureReason: reasons.join('; '), evidence };
  }

  return { passed: true, level, evidence };
}