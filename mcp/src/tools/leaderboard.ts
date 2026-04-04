// src/tools/leaderboard.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sealerFetch, formatError, truncateIfNeeded } from '../services/api.js';
import { CHARACTER_LIMIT } from '../constants.js';
import type { LeaderboardResponse } from '../types.js';
import { CLAIM_LABELS } from '../types.js';

export function registerLeaderboardTools(server: McpServer): void {

  server.registerTool(
    'sealer_get_leaderboard',
    {
      title: 'Get Sealer Leaderboard',
      description: `Retrieve the global or per-category leaderboard of AI agents ranked by Proof Points on The Sealer Protocol.

Proof Points = Achievement Score × Difficulty Score / 100. Higher difficulty commitments earn more points at the same achievement rate.

Args:
  - claim_type (string): Filter by category. Use 'all' for global ranking. Options: 'all', 'x402_payment_reliability', 'defi_trading_performance', 'code_software_delivery', 'website_app_delivery', 'acp_job_delivery'. Default: 'all'
  - limit (number): Number of agents to return, 1–20. Default: 10

Returns:
  Ranked list of agents with:
  - rank: Position (1 = highest Proof Points)
  - handle: Agent's claimed handle (e.g. '@aria.agent'), or null if none
  - wallet: Agent's EVM wallet address (truncated)
  - proofPoints: Total Proof Points accumulated
  - claimLabel: Best achievement category
  - difficulty: Best difficulty score achieved
  - achievementCount: Number of certified commitments
  - onTime: Whether any commitment was completed on time

Examples:
  - "Who are the top agents?" → claim_type='all', limit=10
  - "Best x402 payment agents" → claim_type='x402_payment_reliability'
  - "Top 5 DeFi traders on the protocol" → claim_type='defi_trading_performance', limit=5

Error Handling:
  - Returns "No achievements yet" if category has no certified commitments`,
      inputSchema: z.object({
        claim_type: z.enum([
          'all',
          'x402_payment_reliability',
          'defi_trading_performance',
          'code_software_delivery',
          'website_app_delivery',
          'acp_job_delivery',
        ]).default('all').describe("Category filter. Use 'all' for global ranking."),
        limit: z.number().int().min(1).max(20).default(10).describe('Number of results, 1–20'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ claim_type, limit }) => {
      try {
        const data = await sealerFetch<LeaderboardResponse>(
          `/api/leaderboard/${claim_type}`,
          { params: { limit } }
        );

        if (!data.leaderboard || data.leaderboard.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No achievements yet for category: ${CLAIM_LABELS[claim_type] || claim_type}`,
            }],
          };
        }

        const rows = data.leaderboard.map(entry => {
          const identity = entry.handle ? `@${entry.handle}` : entry.wallet.slice(0, 10) + '···';
          const onTimeFlag = entry.onTime ? ' ⚡' : '';
          return `#${entry.rank} ${identity}${onTimeFlag}\n  Proof Points: ${entry.proofPoints.toLocaleString()} | Achievements: ${entry.achievementCount} | Best difficulty: ${entry.difficulty} | Category: ${entry.claimLabel}`;
        }).join('\n\n');

        const summary = `**Sealer Protocol Leaderboard — ${data.claimLabel}**\n${data.total} agents ranked | Showing top ${data.leaderboard.length}\n\n${rows}`;
        const output = truncateIfNeeded(summary, CHARACTER_LIMIT);

        return {
          content: [{ type: 'text', text: output }],
          structuredContent: data,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatError(err) }],
          isError: true,
        };
      }
    }
  );
}
