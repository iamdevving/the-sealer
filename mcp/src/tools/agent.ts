// src/tools/agent.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sealerFetch, formatError, truncateIfNeeded } from '../services/api.js';
import { CHARACTER_LIMIT, EAS_EXPLORER_URL } from '../constants.js';
import type { AgentProfile, CommitmentStatus } from '../types.js';

const STATUS_EMOJI: Record<string, string> = {
  achieved: '✅',
  failed: '❌',
  pending: '⏳',
  verifying: '🔍',
  expired: '—',
  amended: '✏️',
};

export function registerAgentTools(server: McpServer): void {

  server.registerTool(
    'sealer_get_agent_profile',
    {
      title: 'Get Sealer Agent Profile',
      description: `Fetch a complete agent profile from The Sealer Protocol, including their Sealer ID, commitment history, Proof Points, and leaderboard rank.

Use this to understand an agent's track record, identity, and delivery history.

Args:
  - handle_or_wallet (string): Agent's handle (e.g. 'sealer.agent') or EVM wallet address (0x...)

Returns:
  - handle: Claimed handle (e.g. '@sealer.agent'), or null
  - wallet: Full EVM wallet address
  - sid: Sealer ID info (name, entityType, imageUrl, chain, tokenId) — null if no SID minted
  - totalProofPoints: Total Proof Points across all certified commitments
  - achievementCount: Number of commitments with 'achieved' status
  - rank: Global leaderboard rank (null if unranked)
  - commitments: List of commitments with status, claimType, proofPoints, difficulty, and deadline

Examples:
  - "What's the profile for @aria.agent?" → handle_or_wallet='aria.agent'
  - "Look up agent 0x4386..." → handle_or_wallet='0x4386...'
  - "How many Proof Points does sealer.agent have?" → handle_or_wallet='sealer.agent'

Error Handling:
  - Returns "Agent not found" if handle/wallet has no protocol activity`,
      inputSchema: z.object({
        handle_or_wallet: z.string()
          .min(1)
          .describe("Agent's handle (e.g. 'aria.agent') or 0x wallet address"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ handle_or_wallet }) => {
      try {
        const data = await sealerFetch<AgentProfile>(
          `/api/agent/${encodeURIComponent(handle_or_wallet)}`
        );

        const lines: string[] = [];
        lines.push(`**Sealer Agent Profile**`);
        lines.push('');

        const identity = data.handle ? `@${data.handle}` : data.wallet;
        lines.push(`Identity: ${identity}`);
        if (data.handle) lines.push(`Wallet: ${data.wallet}`);

        if (data.sid) {
          lines.push('');
          lines.push('**Sealer ID**');
          if (data.sid.name && data.sid.name !== 'UNNAMED AGENT') {
            lines.push(`  Name: ${data.sid.name}`);
          }
          lines.push(`  Entity Type: ${data.sid.entityType}`);
          lines.push(`  Chain: ${data.sid.chain}`);
          lines.push(`  Token ID: #${data.sid.tokenId}`);
          if (data.sid.renewalCount > 0) lines.push(`  Renewals: ${data.sid.renewalCount}`);
        }

        lines.push('');
        lines.push('**Stats**');
        lines.push(`  Proof Points: ${data.totalProofPoints.toLocaleString()}`);
        lines.push(`  Achievements: ${data.achievementCount}`);
        lines.push(`  Rank: ${data.rank ? `#${data.rank}` : 'Unranked'}`);

        if (data.commitments && data.commitments.length > 0) {
          lines.push('');
          lines.push(`**Commitments (${data.commitments.length})**`);
          for (const c of data.commitments.slice(0, 10)) {
            const emoji = STATUS_EMOJI[c.status] || '?';
            const pts = c.proofPoints > 0 ? ` | ${c.proofPoints} pts` : '';
            const diff = c.difficulty > 0 ? ` | diff: ${c.difficulty}` : '';
            const deadline = c.deadline ? ` | due: ${new Date(c.deadline).toLocaleDateString()}` : '';
            lines.push(`  ${emoji} [${c.claimLabel}] ${c.status.toUpperCase()}${pts}${diff}${deadline}`);
            if (c.statement) {
              lines.push(`     "${c.statement.slice(0, 80)}${c.statement.length > 80 ? '…' : ''}"`);
            }
          }
          if (data.commitments.length > 10) {
            lines.push(`  ... and ${data.commitments.length - 10} more`);
          }
        } else {
          lines.push('');
          lines.push('No commitments yet.');
        }

        lines.push('');
        lines.push(`Profile: https://thesealer.xyz/agent/${encodeURIComponent(handle_or_wallet)}`);

        const output = truncateIfNeeded(lines.join('\n'), CHARACTER_LIMIT);

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

  server.registerTool(
    'sealer_get_commitment_status',
    {
      title: 'Get Commitment Status',
      description: `Look up the current status and metadata of a specific commitment by its EAS attestation UID.

Use this to check whether a commitment has been verified, when it's due, and how many Proof Points it earned.

Args:
  - uid (string): The commitment's EAS attestation UID (starts with 0x, 66 chars)

Returns:
  - uid: The commitment UID
  - status: 'pending' | 'verifying' | 'achieved' | 'amended' | 'failed' | 'expired'
  - claimType: Category (e.g. 'x402_payment_reliability')
  - claimLabel: Human-readable category name
  - agentId: Agent's wallet address
  - difficulty: Difficulty score 0–100 (null if not yet computed)
  - proofPoints: Proof Points earned (null if not yet certified)
  - deadline: ISO timestamp of commitment deadline
  - mintedAt: ISO timestamp when commitment was created
  - lastChecked: ISO timestamp of last verification attempt
  - amended: Whether this commitment was amended

Examples:
  - "Check status of commitment 0xabc..." → uid='0xabc...'
  - "Was commitment 0x123 verified?" → uid='0x123...'
  - "How many proof points did 0xdef earn?" → uid='0xdef...'

Error Handling:
  - Returns 404 if UID not found (commitment may not be registered or may have expired from cache)`,
      inputSchema: z.object({
        uid: z.string()
          .regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a valid EAS UID: 0x followed by 64 hex characters')
          .describe('EAS commitment attestation UID (0x + 64 hex chars)'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uid }) => {
      try {
        const data = await sealerFetch<CommitmentStatus>(`/api/commitment/${uid}`);

        const emoji = STATUS_EMOJI[data.status] || '?';
        const lines: string[] = [];
        lines.push(`**Commitment Status** ${emoji}`);
        lines.push('');
        lines.push(`UID: ${uid}`);
        lines.push(`Status: **${data.status.toUpperCase()}**`);
        lines.push(`Category: ${data.claimLabel}`);
        lines.push(`Agent: ${data.agentId}`);

        if (data.difficulty !== null) lines.push(`Difficulty: ${data.difficulty}/100`);
        if (data.proofPoints !== null) lines.push(`Proof Points: ${data.proofPoints}`);
        if (data.amended) lines.push(`Amended: Yes`);
        if (data.mintedAt) lines.push(`Created: ${new Date(data.mintedAt).toLocaleString()}`);
        if (data.deadline) lines.push(`Deadline: ${new Date(data.deadline).toLocaleString()}`);
        if (data.lastChecked) lines.push(`Last Checked: ${new Date(data.lastChecked).toLocaleString()}`);

        lines.push('');
        lines.push(`EAS Explorer: ${EAS_EXPLORER_URL}/${uid}`);

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
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

  server.registerTool(
    'sealer_check_handle',
    {
      title: 'Check Sealer Handle',
      description: `Check whether a Sealer handle is available or already taken, and look up which handle a wallet has claimed.

Handles are in the format 'name.agent' (e.g. 'aria.agent', 'sealer.agent').

Args:
  - handle (string, optional): Handle to check availability for (e.g. 'aria.agent')
  - wallet (string, optional): EVM wallet address to look up current handle for
  
At least one of handle or wallet must be provided.

Returns (handle check):
  - handle: The handle checked
  - available: true if unclaimed, false if taken
  
Returns (wallet lookup):
  - wallet: The wallet address
  - handle: Currently claimed handle, or null

Examples:
  - "Is aria.agent available?" → handle='aria.agent'
  - "What handle does 0x4386... have?" → wallet='0x4386...'
  - "Check if sealer.agent is taken" → handle='sealer.agent'`,
      inputSchema: z.object({
        handle: z.string().optional().describe("Handle to check (e.g. 'aria.agent')"),
        wallet: z.string().optional().describe('EVM wallet address (0x...) to look up handle for'),
      }).strict().refine(
        (data) => data.handle !== undefined || data.wallet !== undefined,
        { message: 'At least one of handle or wallet must be provided' }
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ handle, wallet }) => {
      try {
        const params: Record<string, string> = {};
        if (handle) params.handle = handle;
        if (wallet) params.wallet = wallet;

        const data = await sealerFetch<{ handle?: string; wallet?: string; available?: boolean }>(
          '/api/sid/check',
          { params }
        );

        if (wallet) {
          const result = data.handle
            ? `Wallet ${wallet.slice(0, 10)}··· has handle @${data.handle}`
            : `Wallet ${wallet.slice(0, 10)}··· has no handle claimed`;
          return {
            content: [{ type: 'text', text: result }],
            structuredContent: data,
          };
        }

        if (handle) {
          const result = data.available === true
            ? `✅ Handle '${handle}' is available`
            : `❌ Handle '${handle}' is already taken`;
          return {
            content: [{ type: 'text', text: result }],
            structuredContent: data,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
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
