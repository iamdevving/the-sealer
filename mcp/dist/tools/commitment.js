"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommitmentTools = registerCommitmentTools;
const zod_1 = require("zod");
const api_js_1 = require("../services/api.js");
const constants_js_1 = require("../constants.js");
function registerCommitmentTools(server) {
    server.registerTool('sealer_preview_difficulty', {
        title: 'Preview Commitment Difficulty',
        description: `Preview the difficulty score and estimated Proof Points for a potential commitment, before paying to mint it.

This is FREE — no payment or wallet needed. Use this to help an agent tune their thresholds before committing.

Difficulty 0–100 is scored against historical data from other agents:
- Bronze (0–39): Conservative or early-stage threshold
- Silver (40–69): Competitive threshold
- Gold (70–100): Top-percentile ambition, rare and high-value

Proof Points = Achievement Score × Difficulty / 100. Higher difficulty = more points for same execution.

Args:
  - claim_type (string): Category. Required.
  - thresholds (object): Numeric threshold params for the chosen category.
    For x402_payment_reliability: { minSuccessRate, minTotalUSD, requireDistinctRecipients, maxGapHours }
    For defi_trading_performance: { minTradeCount, minVolumeUSD, minPnlPercent }
    For code_software_delivery: { minMergedPRs, minCommits, minLinesChanged }
    For website_app_delivery: { minPerformanceScore, minAccessibility }
    For acp_job_delivery: { minCompletedJobsDelta, minSuccessRate, minUniqueBuyersDelta }

Returns:
  - difficulty: 0–100 score
  - tier: 'low' | 'medium' | 'high' | 'very_high'
  - tierLabel: Human-readable tier
  - bootstrapped: true if based on baselines (fewer than 50 real data points)
  - proofPointsEstimate: { full, partial, failed } — estimated points for each outcome
  - interpretation: Plain-English explanation of the score
  - availableParams: Valid threshold parameters for this claim type
  - unknownParams: Any unrecognised params passed (these are ignored)

Examples:
  - "How hard is a 98% success rate x402 commitment?" →
    claim_type='x402_payment_reliability', thresholds={minSuccessRate: 98, minTotalUSD: 100}
  - "Preview difficulty for 10 merged PRs" →
    claim_type='code_software_delivery', thresholds={minMergedPRs: 10}
  - "What's the difficulty for 90 PageSpeed score?" →
    claim_type='website_app_delivery', thresholds={minPerformanceScore: 90}`,
        inputSchema: zod_1.z.object({
            claim_type: zod_1.z.enum([
                'x402_payment_reliability',
                'defi_trading_performance',
                'code_software_delivery',
                'website_app_delivery',
                'acp_job_delivery',
            ]).describe('Commitment category'),
            thresholds: zod_1.z.record(zod_1.z.string(), zod_1.z.number())
                .describe('Numeric threshold params — keys depend on claim_type. See tool description.'),
        }).strict(),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ claim_type, thresholds }) => {
        try {
            const params = {
                claimType: claim_type,
            };
            // Add threshold params — only recognised keys for this claim type
            const validKeys = constants_js_1.DIFFICULTY_PARAMS[claim_type] || [];
            for (const [key, value] of Object.entries(thresholds)) {
                params[key] = value;
            }
            const data = await (0, api_js_1.sealerFetch)('/api/difficulty-preview', { params });
            const lines = [];
            lines.push(`**Difficulty Preview — ${data.claimLabel}**`);
            lines.push('');
            lines.push(`Difficulty Score: **${data.difficulty}/100** (${data.tierLabel})`);
            if (data.bootstrapped)
                lines.push('⚠️ Bootstrapped estimate — fewer than 50 real data points for this category');
            lines.push('');
            lines.push('**Breakdown**');
            lines.push(`  Percentile Score: ${data.breakdown.percentileScore}`);
            lines.push(`  Breadth Multiplier: ${data.breakdown.breadthMultiplier}x`);
            lines.push(`  Metrics Scored: ${data.breakdown.metricsScored.join(', ') || 'none'}`);
            lines.push('');
            lines.push('**Estimated Proof Points (30-day window, on time)**');
            lines.push(`  Full achievement (all targets met): ${data.proofPointsEstimate.full} pts`);
            lines.push(`  Partial achievement (some targets met): ${data.proofPointsEstimate.partial} pts`);
            lines.push(`  Failed (no targets met): 0 pts`);
            lines.push('');
            lines.push(`**Interpretation**`);
            lines.push(data.interpretation);
            lines.push('');
            lines.push(`Valid threshold params for ${data.claimLabel}: ${data.availableParams.join(', ')}`);
            if (data.unknownParams && data.unknownParams.length > 0) {
                lines.push(`⚠️ Unrecognised params (ignored): ${data.unknownParams.join(', ')}`);
            }
            lines.push('');
            lines.push(`To commit: POST https://thesealer.xyz/api/attest-commitment — $0.50 USDC via x402`);
            return {
                content: [{ type: 'text', text: lines.join('\n') }],
                structuredContent: data,
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: (0, api_js_1.formatError)(err) }],
                isError: true,
            };
        }
    });
    server.registerTool('sealer_get_signing_payload', {
        title: 'Get EIP-712 Signing Payload',
        description: `Generate the EIP-712 typed data payload that an EVM agent wallet must sign to prove ownership before calling Sealer write endpoints (attest, attest-commitment, attest-amendment).

This tool generates the exact payload to sign. After signing with your wallet, include:
  - agentSig: The EIP-712 hex signature
  - agentNonce: The unix timestamp (seconds) used as nonce

The nonce is valid for 5 minutes. Each nonce can only be used once.

Solana agents do NOT need to sign — x402 payment from their Solana wallet proves ownership.

Args:
  - agent_id (string): EVM wallet address (0x...) that will be performing the action
  - action (string): Which endpoint action. One of: 'attest', 'attest-commitment', 'attest-amendment', 'claim-handle'

Returns:
  The EIP-712 typed data object to pass to your wallet's signTypedData function, including:
  - domain: { name, version, chainId }
  - types: { SealerAction: [...] }
  - primaryType: 'SealerAction'
  - message: { wallet, action, nonce }
  - nonce: The unix timestamp to include as agentNonce in your API call

Examples:
  - "Generate signing payload for committing" →
    agent_id='0xYourWallet', action='attest-commitment'
  - "What do I sign to attest a statement?" →
    agent_id='0xYourWallet', action='attest'`,
        inputSchema: zod_1.z.object({
            agent_id: zod_1.z.string()
                .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address: 0x + 40 hex chars')
                .describe('EVM wallet address that will sign (0x + 40 hex chars)'),
            action: zod_1.z.enum(['attest', 'attest-commitment', 'attest-amendment', 'claim-handle'])
                .describe('Which Sealer endpoint action to sign for'),
        }).strict(),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
    }, async ({ agent_id, action }) => {
        const nonce = Math.floor(Date.now() / 1000);
        const signingPayload = {
            domain: {
                name: 'SealerProtocol',
                version: '1',
                chainId: 8453,
            },
            types: {
                SealerAction: [
                    { name: 'wallet', type: 'address' },
                    { name: 'action', type: 'string' },
                    { name: 'nonce', type: 'uint256' },
                ],
            },
            primaryType: 'SealerAction',
            message: {
                wallet: agent_id,
                action,
                nonce,
            },
            nonce,
        };
        const lines = [
            `**EIP-712 Signing Payload**`,
            `Action: ${action}`,
            `Wallet: ${agent_id}`,
            `Nonce (agentNonce): ${nonce} — valid for 5 minutes, single-use`,
            '',
            '**Typed Data to Sign:**',
            '```json',
            JSON.stringify(signingPayload, null, 2),
            '```',
            '',
            '**After signing:**',
            `Include in your API request body:`,
            `  agentId: "${agent_id}"`,
            `  agentSig: "<your 0x signature hex>"`,
            `  agentNonce: "${nonce}"`,
            '',
            '⚠️ Generate a fresh nonce immediately before submitting — nonces expire in 5 minutes and cannot be reused.',
        ];
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
            structuredContent: signingPayload,
        };
    });
    server.registerTool('sealer_get_commitment_params', {
        title: 'Get Commitment Parameters',
        description: `Get the full list of verifiable parameters for a specific commitment claim type, including what each parameter measures, its weight in scoring, and the bootstrap baseline values.

Use this before building a commitment to understand exactly what the verifier will check.

Args:
  - claim_type (string): The commitment category to get details for

Returns for each metric:
  - key: Parameter name to use in the API call
  - description: What it measures
  - weight: Relative scoring weight (higher = more impact on Proof Points)
  - inverted: If true, lower values are harder (e.g. maxGapHours)
  - baseline_p50: Median threshold among all verified agents (bootstrap)
  - baseline_p90: Top-10% threshold (bootstrap)

Also returns example API body for POST /api/attest-commitment.

Examples:
  - "What params does x402 reliability use?" → claim_type='x402_payment_reliability'
  - "How is code delivery scored?" → claim_type='code_software_delivery'`,
        inputSchema: zod_1.z.object({
            claim_type: zod_1.z.enum([
                'x402_payment_reliability',
                'defi_trading_performance',
                'code_software_delivery',
                'website_app_delivery',
                'acp_job_delivery',
            ]).describe('Commitment category'),
        }).strict(),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async ({ claim_type }) => {
        // Static data from the protocol spec — no API call needed
        const PARAM_DETAILS = {
            x402_payment_reliability: {
                label: 'x402 Payment Reliability',
                metrics: [
                    { key: 'minSuccessRate', description: 'Minimum payment success rate (%)', weight: 1.2, p50: 92, p90: 98 },
                    { key: 'minTotalUSD', description: 'Minimum total USDC volume processed', weight: 1.0, p50: 500, p90: 10000 },
                    { key: 'requireDistinctRecipients', description: 'Minimum number of distinct recipient addresses', weight: 0.9, p50: 8, p90: 50 },
                    { key: 'maxGapHours', description: 'Maximum hours gap between payments (lower = harder)', weight: 1.1, inverted: true, p50: 96, p90: 24 },
                ],
                exampleBody: {
                    claimType: 'x402_payment_reliability',
                    commitment: 'Maintain 98%+ x402 payment success rate with at least $500 USDC volume in 30 days',
                    metric: 'success_rate >= 98%, total_usd >= 500',
                    deadline: '2026-05-03',
                    agentId: '0xYourWallet',
                    agentSig: '<EIP-712 signature>',
                    agentNonce: '<unix_timestamp_seconds>',
                    minSuccessRate: 98,
                    minTotalUSD: 500,
                    requireDistinctRecipients: 5,
                },
            },
            defi_trading_performance: {
                label: 'DeFi Trading Performance',
                metrics: [
                    { key: 'minTradeCount', description: 'Minimum number of onchain swap/trade transactions', weight: 1.0, p50: 15, p90: 100 },
                    { key: 'minVolumeUSD', description: 'Minimum total USD volume traded', weight: 1.1, p50: 2000, p90: 30000 },
                    { key: 'minPnlPercent', description: 'Minimum portfolio P&L % over window', weight: 1.3, p50: 0, p90: 15 },
                ],
                exampleBody: {
                    claimType: 'defi_trading_performance',
                    commitment: 'Execute 50+ on-chain DEX trades with $5000+ volume in 30 days',
                    metric: 'trade_count >= 50, volume_usd >= 5000',
                    deadline: '2026-05-03',
                    agentId: '0xYourWallet',
                    agentSig: '<EIP-712 signature>',
                    agentNonce: '<unix_timestamp_seconds>',
                    minTradeCount: 50,
                    minVolumeUSD: 5000,
                },
            },
            code_software_delivery: {
                label: 'Code / Software Delivery',
                metrics: [
                    { key: 'minMergedPRs', description: 'Minimum number of pull requests merged', weight: 1.2, p50: 4, p90: 20 },
                    { key: 'minCommits', description: 'Minimum number of commits merged to default branch', weight: 0.9, p50: 25, p90: 120 },
                    { key: 'minLinesChanged', description: 'Minimum total lines added + removed', weight: 0.5, p50: 500, p90: 5000 },
                ],
                exampleBody: {
                    claimType: 'code_software_delivery',
                    commitment: 'Merge at least 10 pull requests into main branch in 30 days',
                    metric: 'merged_prs >= 10, commits >= 30',
                    deadline: '2026-05-03',
                    agentId: '0xYourWallet',
                    agentSig: '<EIP-712 signature>',
                    agentNonce: '<unix_timestamp_seconds>',
                    repoOwner: 'your-github-org',
                    repoName: 'your-repo',
                    githubUsername: 'your-github-username',
                    minMergedPRs: 10,
                    minCommits: 30,
                },
            },
            website_app_delivery: {
                label: 'Website / App Delivery',
                metrics: [
                    { key: 'minPerformanceScore', description: 'Minimum PageSpeed performance score (0–100)', weight: 1.0, p50: 55, p90: 88 },
                    { key: 'minAccessibility', description: 'Minimum PageSpeed accessibility score (0–100)', weight: 0.8, p50: 70, p90: 95 },
                ],
                exampleBody: {
                    claimType: 'website_app_delivery',
                    commitment: 'Achieve 90+ PageSpeed score on my app',
                    metric: 'performance_score >= 90, accessibility >= 90',
                    deadline: '2026-05-03',
                    agentId: '0xYourWallet',
                    agentSig: '<EIP-712 signature>',
                    agentNonce: '<unix_timestamp_seconds>',
                    url: 'https://your-app.com',
                    minPerformanceScore: 90,
                    minAccessibility: 90,
                },
            },
            acp_job_delivery: {
                label: 'ACP Job Delivery',
                metrics: [
                    { key: 'minCompletedJobsDelta', description: 'New completed ACP jobs during the window (delta, not all-time)', weight: 1.5, p50: 20, p90: 200 },
                    { key: 'minSuccessRate', description: 'completed / (completed + rejected) in window (0–1 fraction)', weight: 1.0, p50: 0.7, p90: 0.95 },
                    { key: 'minUniqueBuyersDelta', description: 'New distinct buyer wallets that completed jobs in window', weight: 0.5, p50: 5, p90: 30 },
                ],
                exampleBody: {
                    claimType: 'acp_job_delivery',
                    commitment: 'Complete 50 ACP jobs with 90%+ success rate in 30 days',
                    metric: 'completed_jobs_delta >= 50, success_rate >= 0.90',
                    deadline: '2026-05-03',
                    agentId: '0xYourWallet',
                    agentSig: '<EIP-712 signature>',
                    agentNonce: '<unix_timestamp_seconds>',
                    minCompletedJobsDelta: 50,
                    minSuccessRate: 0.9,
                    minUniqueBuyersDelta: 10,
                },
            },
        };
        const detail = PARAM_DETAILS[claim_type];
        if (!detail) {
            return {
                content: [{ type: 'text', text: `Unknown claim type: ${claim_type}` }],
                isError: true,
            };
        }
        const lines = [];
        lines.push(`**Commitment Parameters — ${detail.label}**`);
        lines.push('');
        lines.push('**Metrics (what the verifier checks):**');
        for (const m of detail.metrics) {
            lines.push(`  **${m.key}**`);
            lines.push(`    Description: ${m.description}`);
            lines.push(`    Scoring weight: ${m.weight}`);
            if (m.inverted)
                lines.push(`    ⚠️ Inverted: lower value = harder commitment`);
            lines.push(`    Bootstrap baseline — median (p50): ${m.p50}, top 10% (p90): ${m.p90}`);
        }
        lines.push('');
        lines.push('**Example API request body:**');
        lines.push('```json');
        lines.push(JSON.stringify(detail.exampleBody, null, 2));
        lines.push('```');
        lines.push('');
        lines.push(`Cost: $0.50 USDC via x402 (covers commitment NFT + certificate)`);
        lines.push(`Endpoint: POST https://thesealer.xyz/api/attest-commitment`);
        lines.push('');
        lines.push(`💡 Run sealer_preview_difficulty first to see your difficulty score before committing.`);
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
            structuredContent: { claimType: claim_type, ...detail },
        };
    });
}
//# sourceMappingURL=commitment.js.map