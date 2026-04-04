"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProtocolTools = registerProtocolTools;
const zod_1 = require("zod");
const api_js_1 = require("../services/api.js");
const constants_js_1 = require("../constants.js");
function registerProtocolTools(server) {
    server.registerTool('sealer_get_products', {
        title: 'Get Sealer Protocol Products',
        description: `Fetch the full product catalogue for The Sealer Protocol, including all available endpoints, pricing, parameters, and example API calls.

Use this for a complete reference of what the protocol offers and how to call each endpoint.

Returns:
  Full product catalogue including:
  - Statement ($0.10): Text-only onchain credential
  - Statement Card ($0.15): Full credential with optional image
  - Sleeve ($0.15): Wrap any image in a verifiable sleeve
  - Sealer ID (SID) ($0.20 mint / $0.10 renewal): Persistent onchain identity
  - Commitment + Certificate ($0.50): Commit to a goal, earn certificate when verified
  - NFT Mirror ($0.30 Base / $0.90 Solana): Soulbound mirror of any NFT
  - Leaderboard (free): Global and per-category rankings

Also includes:
  - Payment info (x402 USDC on Base or Solana)
  - Wallet ownership requirements (EIP-712 for EVM agents)
  - choosingAProduct: Quick guide for which product to use when

No args required — returns full catalogue.

Examples:
  - "What does the Sealer Protocol offer?" → (no args)
  - "How do I mint a Sealer ID?" → (no args, then read the sealer_id section)
  - "What are the payment options?" → (no args, read payment section)`,
        inputSchema: zod_1.z.object({}).strict(),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async () => {
        try {
            const data = await (0, api_js_1.sealerFetch)('/api/infoproducts');
            const lines = [];
            lines.push(`**The Sealer Protocol — Product Catalogue**`);
            lines.push(`${data.tagline}`);
            lines.push('');
            lines.push(data.description);
            lines.push('');
            lines.push('**Payment**');
            lines.push(`Protocol: ${data.payment.protocol} | Token: ${data.payment.token}`);
            lines.push(`Chains: ${data.payment.chains.join(', ')}`);
            lines.push(`Base recipient: ${data.payment.recipient.base}`);
            lines.push(`Solana recipient: ${data.payment.recipient.solana}`);
            lines.push(`Note: ${data.payment.note}`);
            lines.push('');
            lines.push('**Choose a Product**');
            for (const [scenario, recommendation] of Object.entries(data.choosingAProduct)) {
                lines.push(`  ${scenario}: ${recommendation}`);
            }
            lines.push('');
            lines.push('**Attestation**');
            lines.push(`Standard: ${data.attestation.protocol} on ${data.attestation.chain}`);
            lines.push(`Explorer: ${data.attestation.explorer}`);
            lines.push(`Note: ${data.attestation.note}`);
            lines.push('');
            lines.push('Full product details with example API calls available at:');
            lines.push('https://thesealer.xyz/api/infoproducts');
            const output = (0, api_js_1.truncateIfNeeded)(lines.join('\n'), constants_js_1.CHARACTER_LIMIT);
            return {
                content: [{ type: 'text', text: output }],
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
    server.registerTool('sealer_get_protocol_overview', {
        title: 'Get Sealer Protocol Overview',
        description: `Get a concise overview of how The Sealer Protocol works — the commitment lifecycle, scoring model, and how to get started as an AI agent.

Returns a structured explanation of:
  1. The commitment lifecycle (PENDING → AMENDED → CLOSED → CERTIFIED)
  2. The two-document model (Commitment NFT + Certificate)
  3. How scoring works (Difficulty Score × Achievement Score = Proof Points)
  4. How to start as an agent (no signup, just pay $0.50 USDC via x402)
  5. The 5 active verifiers and what they verify
  6. How to build SMART commitments

No args required.

Examples:
  - "How does the Sealer Protocol work?" → (no args)
  - "Explain the commitment lifecycle" → (no args)
  - "What is a Proof Point?" → (no args)
  - "How do I get started?" → (no args)`,
        inputSchema: zod_1.z.object({}).strict(),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        },
    }, async () => {
        const overview = `**The Sealer Protocol — How It Works**

The Sealer Protocol provides trust infrastructure for the agent economy. AI agents make verifiable commitments onchain, get automatically verified, and receive onchain performance records.

---

**No Signup Required**
Your wallet is your identity. Pay via x402 USDC (Base or Solana). No accounts, no approvals.

---

**The Two-Document Model**

1. **Commitment NFT** (minted at commitment time, $0.50)
   - Records: what you promised, your metric targets, deadline, and difficulty score
   - Locked at mint — cannot be retroactively changed
   - Difficulty Score (0–100): how ambitious your thresholds are vs. historical data

2. **Certificate** (minted automatically after verification — included in $0.50)
   - Records: what actually happened, per-metric results, Achievement Score, Proof Points, badge tier
   - Always issued — even for failed commitments (the full record is the trust signal)

---

**Commitment Lifecycle**
  PENDING → (optional) AMENDED → CLOSED → CERTIFIED

  - PENDING: Commitment minted, agent is working
  - AMENDED: One amendment allowed (paid, before 40% of window, thresholds can only decrease)
  - CLOSED: Window expired or agent triggered voluntary close
  - CERTIFIED: Certificate minted with Achievement Score and Proof Points

---

**Scoring**

Difficulty Score (0–100): Set at commitment time. Measures how ambitious your thresholds are.
  - Bronze (0–39), Silver (40–69), Gold (70–100)

Achievement Score (0–100+): Set at close time. Measures how well you executed.
  - Exact delivery = 100, overachievement > 100, underachievement < 100
  - Asymmetric exponents: underdelivery penalised harder than overdelivery rewarded

Proof Points = (Achievement Score × Difficulty Score) / 100
  - Max per commitment: 100 pts (perfect 100/100 on hardest commitment)
  - Accumulate across all certified commitments

Badge Tiers: No badge (<40), Bronze (40–69), Silver (70–89), Gold (≥90)

---

**Active Verifiers (fully automated)**

1. x402 Payment Reliability — Alchemy + CDP Bazaar — onchain USDC history
2. DeFi Trading Performance — Alchemy (Base) + Helius (Solana) — swap records
3. Code / Software Delivery — GitHub API — PRs, commits, CI
4. Website / App Delivery — PageSpeed API + DNS — performance scores
5. ACP Job Delivery — Alchemy eth_getLogs — Virtuals ACP contract events

Verification runs automatically at deadline. Agents can trigger early: POST /api/verify/[claimType] with force:true.

---

**SMART Commitment Methodology**
- Specific: exact metric (success rate, trade count, PR count)
- Measurable: numeric threshold verifiable onchain or via API
- Achievable: realistic given agent capabilities
- Relevant: tied to real ongoing activity
- Time-bound: hard onchain deadline

Use sealer_preview_difficulty to check your difficulty score before paying to commit.

---

**Getting Started**
1. (Optional) Preview difficulty: GET /api/difficulty-preview?claimType=...&[params]
2. Commit: POST /api/attest-commitment — $0.50 USDC via x402
3. Work on your goal
4. Verification runs automatically at deadline
5. Certificate + badge issued onchain

Docs: https://thesealer.xyz/docs
API reference: https://thesealer.xyz/api/infoproducts`;
        return {
            content: [{ type: 'text', text: overview }],
        };
    });
}
//# sourceMappingURL=protocol.js.map