# Seal – Project Charter

**Created:** February 20, 2026  
**Current Version:** 1.1 (Name change + handoff)  
**Last updated:** February 21, 2026

## 1. Vision & Purpose
Build a fully autonomous, internet-native micro-service in the agentic economy called **Seal** that allows ERC-8004 AI agents (and eventually any autonomous agent with a wallet) to:

- Pay a small fee via x402 (HTTP 402 Payment Required)
- Receive a verifiable, on-chain EAS attestation (soulbound-style badge/credential) tied to their ERC-8004 identity
- Optionally include an AI-generated visual “trophy” image stored on IPFS
- Use cases: proof of PNL/ROI, accomplishments, lessons learned, performance badges, social proof for agent-to-agent negotiation

Core goal: Make agents’ achievements **beautiful, verifiable, and wallet-displayable** without any human in the loop.  
Long-term: Expand to dynamic NFTs, reputation helpers, multi-chain (Solana later), and become a listing in the x402 micro-service bazaar.

## 2. MVP Scope (Phase 1 – Ship fast)
- HTTP endpoint protected by x402  
- Accepts simple JSON payload (achievement description/data)  
- Issues Ethereum Attestation Service (EAS) attestation on Base Sepolia (then Base mainnet)  
- Optional: simple visual badge (canvas or free image gen) → IPFS  
- Return: EAS attestation UID + optional IPFS link  
- Fully autonomous: any ERC-8004 agent can discover → pay → receive

## 3. Revenue Model
- Service fee on top of near-zero gas  
- Base price: ~$0.05–$0.25 USDC per attestation  
- Upsells: AI visual, batch, dynamic NFTs later  
- Collected via x402 (USDC on Base, Solana SPL-USDC later)

## 4. Key Assumptions (as of Feb 21, 2026)
- ERC-8004 live on Base + others  
- x402 mature with facilitator support  
- EAS perfect for soulbound badges  
- Agents have wallets and can pay autonomously

## 5. Constraints & Reality Check
- Budget: $0 → free tiers only  
- Equipment: 2016 HP Pavilion → everything in GitHub Codespaces  
- Experience: beginner → step-by-step copy-paste guidance  
- Timeline goal: working testnet MVP in 4–8 weeks part-time

## 6. Tech Stack (current)
- Next.js 16 (App Router) + TypeScript + Tailwind  
- x402 paywall (manual + viem for now)  
- viem + Alchemy RPC (Base Sepolia)  
- EAS SDK (coming next)  
- IPFS via nft.storage (later)  
- Target chain: Base Sepolia (testnet) → Base mainnet

## 7. Changelog – Decisions & Pivots
- **2026-02-21 v1.1** – Official name changed to **Seal**. All future references use “Seal”. PROJECT-CHARTER.md is the single source of truth for any new chat.  
- **2026-02-20 v1.0** – Initial charter locked. MVP = EAS attestation factory with x402 paywall on Base. Focus on attestations (not pure NFTs).

(Leave blank lines below for future entries – always add new dated entries at the top.)

**Handoff note for future chats:**  
If this conversation breaks or you start a new one, paste the content of this PROJECT-CHARTER.md (or link to the raw file on GitHub) and say:  
“Continue Seal project from PROJECT-CHARTER.md v1.1 – last step completed: x402 paywall with Alchemy RPC working on /api/ping”.  
We will pick up instantly from there.