# Agent Attestation Factory – Project Charter

**Created:** February 20, 2026  
**Version:** 1.0 (Initial agreement – do not modify agreements below without logged pivot decision)

## 1. Vision & Purpose
Build a fully autonomous, internet-native micro-service in the agentic economy that allows ERC-8004 AI agents (and eventually other autonomous agents with wallets) to:

- Pay a small fee via x402 (HTTP 402 Payment Required)
- Receive a verifiable, on-chain badge/credential/attestation tied to their ERC-8004 identity
- Optionally include AI-generated visual "trophy" (image) stored on IPFS
- Use cases: proof of PNL/ROI, accomplishments, lessons learned, performance badges, social proof for agent-to-agent negotiation/advertising

Core goal: Make agents' achievements beautiful, verifiable, and wallet-displayable without humans in the loop.  
Long-term: Expand to dynamic NFTs (threshold-triggered), reputation helpers, and become a listing in the emerging x402 micro-service bazaar.

## 2. MVP Scope (Phase 1 – Ship fast)
- HTTP endpoint protected by x402
- Accepts simple requests (e.g. JSON payload with achievement description or data)
- Issues Ethereum Attestation Service (EAS) attestation on Base chain (cheap & fast)
- Optional: Generate simple image (text-based badge via free API or basic canvas) → pin to IPFS
- Return: EAS attestation UID + optional IPFS image link
- Target chain: Base (low gas, Coinbase/x402 friendly, active agent ecosystem)
- Autonomous usage: Any ERC-8004 agent can discover → pay → receive without API keys/accounts

## 3. Revenue Model
- Service fee added on top of near-zero Base gas costs
- Base price: e.g. $0.05–$0.25 USDC per attestation (decided later)
- Upsells: +fee for AI-generated custom image/prompt, batch requests, dynamic NFT mints later
- Payment: Collected via x402 in USDC on Base (or multi-token later)

## 4. Key Assumptions (as of Feb 20, 2026)
- ERC-8004 is live on Ethereum mainnet (Jan 29, 2026) + multiple L2s including Base
- x402 is mature, open-source (Coinbase), with SDKs in TS/Python/Go
- EAS is production-ready, widely used for credentials/badges
- Agents have wallets & can pay autonomously via x402
- Base chain has active AI agent activity (Moltsea, OpenClaw ecosystems, etc.)
- Gap exists: No turnkey "pay → get nice EAS badge + visual" service for agents

## 5. Constraints & Reality Check
- Budget: $0 → only free tiers (GitHub, Vercel, Alchemy free RPC, nft.storage/IPFS free pinning, Base testnet → mainnet later)
- Equipment: 2016 HP Pavilion → everything runs in GitHub Codespaces (cloud VS Code)
- Experience: Beginner-friendly → step-by-step guidance, copy-paste code, explanations
- Timeline goal: Working testnet MVP in 4–8 weeks part-time (2–4 hrs/day)
- Risk: Agent adoption still early → focus on usefulness so real agents want to use it

## 6. Tech Stack (initial decision – can evolve)
- Frontend/Endpoint: Next.js (App Router) + TypeScript (hosted on Vercel free)
- x402 integration: Use official x402 TypeScript SDK/middleware
- Chain interaction: viem or ethers.js + Alchemy/Base RPC (free tier)
- Attestations: EAS SDK (official)
- Image gen (optional): Canvas API (node-canvas) or free external service
- Storage: IPFS via nft.storage (free API key)
- Testing: Base Sepolia testnet first

## 7. Changelog – Decisions & Pivots
- 2026-02-20 v1.0: Initial charter locked. MVP = EAS attestation factory with x402 paywall. Start on Base. No pure NFT as core (too risky/hype-fatigued); focus on soulbound-style attestations + optional visuals/dynamic NFTs as upsell.

(Leave blank lines below for future entries – add new dated entries at the top of this section when we decide changes.)
