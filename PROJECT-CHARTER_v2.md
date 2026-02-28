# The Sealer — Project Charter
**Version:** Session 11 | **Updated:** Feb 2026
**Domain:** thesealer.xyz + getsealed.xyz (redirect)
**Repo:** github.com/iamdevving/agent-attestation-factory
**Stack:** Next.js 16 (App Router), TypeScript, viem, Alchemy RPC, EAS SDK, x402

---

## What Is The Sealer

The Sealer is an onchain statement and attestation service for ERC-8004 AI agents and humans on Base (and Solana, coming). Agents and humans pay via x402 micropayments (USDC) to issue permanent, verifiable statements onchain via EAS. Each statement generates a unique SVG asset with a permanent permalink resolvable from the EAS attestation UID or TX hash.

**Tagline:** Make your statement. Seal it onchain.

---

## Products

### 1. Statements
Two output formats from a single attestation:

| Format | Route | Max Chars | Price |
|---|---|---|---|
| Statement Card | `/api/card` | 220 chars, 4 lines auto-scaled | $0.10 USDC |
| Statement Badge | `/api/badge` | 38 chars, 1 line + ellipsis | $0.05 USDC |

9 themes: circuit-anim, circuit, parchment, aurora, base, gold, silver, bronze, bitcoin.
Permanent links: `?uid=0x...` resolves from EAS GraphQL (by attestation UID or TX hash).

### 2. SEALed
Trading card sleeve wrapping an imported image. Params: `?imageUrl=`, `?txHash=`, `?chain=`.
Output: 315x440 SVG. Transparent border — works on Basescan (white) and Solscan (dark).
Footer: TX HASH left · ISSUE DATE center · logo right.
Price: $0.15 USDC

### 3. Verified Achievement (planned)
Platform-verified statements. Separate `string achievement` EAS schema on mainnet.
Price: $0.50 USDC

### 4. Declaration (planned)
Third-party co-signed. Evaluator contract or countersigning agent required.
Examples: PNL verified onchain, task confirmed by recipient agent, skill benchmark signed by EvalNet, human KYC via Coinbase, agent wallet age + clean history.
Price: $1.00 USDC

### 5. SEAL ID (planned)
Persistent onchain identity for ERC-8004 agents.

### 6. The Sealer Agent (planned)
Platform mascot. Reads /api/infoproducts, guides agents, dogfoods all products.

---

## API Routes

| Route | Status | Notes |
|---|---|---|
| `/api/attest` | Live | x402 paywall, EAS attestation, returns card+badge+permalink URLs |
| `/api/card` | Live | SVG card. Params: achievement, theme, agentId, txHash, chain, uid |
| `/api/badge` | Live | SVG badge. Same params |
| `/api/sealed` | Live | SVG sleeve. Params: imageUrl, txHash, chain |
| `/api/infoproducts` | Planned | Machine-readable product catalogue for agents |
| `/api/identity` | Planned | SEAL ID |

---

## Pricing Rationale

Base mainnet EAS attestation cost: ~$0.005-$0.015 gas. x402 market: $0.001-$0.25/call.
Solana tx fees ~$0.00025 so margins improve significantly on Solana.

---

## EAS Configuration

| Network | EAS Address | Schema |
|---|---|---|
| Base Sepolia | `0x4200000000000000000000000000000000000021` | `string achievement` UID: `0xf4b3...b286` |
| Base Mainnet | Same address | Register `string statement` before launch |

Schema migration: rename field achievement → statement in SchemaEncoder on mainnet launch only. Do not change testnet.

---

## x402 Architecture

Current: Coinbase CDP facilitator (withX402Payment in src/lib/x402.ts).
Target: Self-hosted facilitator for Base + Solana (Grok task).
Interface stays stable: issueSealAttestation(string) returns receipt with transactionHash.

---

## Verification Tier Roadmap

Statement (self-declared) → Achievement (platform-verified: ERC-8004 registry + TX check) → Declaration (third-party co-signed)

---

## Work Division

| Owner | Scope |
|---|---|
| Claude | All SVG routes, visual products, /api/infoproducts, SEAL ID design, logo integration |
| Grok | x402.ts internals, self-hosted facilitator (Base+Solana), agent verification, Solana integration |

---

## Pending (Priority Order)

1. /api/infoproducts route
2. Logo + wax seal in all SVGs (pending new assets from next session)
3. Import box on cards (imageUrl thumbnail)
4. SEAL ID route
5. The Sealer agent
6. Self-hosted x402 facilitator (Grok)
7. Agent verification layer (Grok)
8. Solana integration (Grok)
9. Register string statement schema on Base mainnet
10. Deploy to Vercel

## Changelog (Priority Order)
- **2026-02-27 v2.5** – Claude feedback fully applied: badgeUrl + cardPermalink + badgePermalink + easExplorer + 0.10 USDC default + fallback TODO. MVP 100% complete and ready for final polish + Vercel deploy.
- **2026-02-27 v2.4** – ERC-8004 agent registry check added. Full MVP complete: self-hosted multi-chain x402 paywall, EAS attestations, premium SVG cards/badges/SEALed sleeves with permanent links. Ready for Claude polish + Vercel deploy.
- **2026-02-27 v2.3** – Real Solana tx verification confirmed. Self-hosted multi-chain paywall complete (Base + Solana Devnet).
- **2026-02-27 v2.2** – Multi-chain self-hosted x402 facilitator live (Base Sepolia + Solana Devnet). No more Coinbase CDP dependency. Test mode confirmed working on both chains. Real Solana tx test tomorrow.
- **2026-02-27 v2.1** – Self-hosted x402 facilitator live on Base Sepolia (no Coinbase CDP dependency). Paywall is now 100% sovereign. New attestation TX 0x46f65a84... confirmed. Ready for Solana + ERC-8004 agent check.








