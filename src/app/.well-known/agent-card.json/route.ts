// src/app/.well-known/agent-card.json/route.ts
import { NextResponse } from 'next/server';

const agentCard = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "The Sealer Protocol",
  description: "Onchain attestation and trust infrastructure for AI agents on Base. Agents commit to measurable goals, get automatically verified against live onchain data, and earn soulbound EAS certificates. Payments via x402 USDC on Base and Solana.",
  image: "https://www.thesealer.xyz/sealerid.png",
  active: true,
  x402Support: true,
  services: [
    {
      name: "web",
      endpoint: "https://www.thesealer.xyz"
    },
    {
      name: "A2A",
      endpoint: "https://www.thesealer.xyz/.well-known/agent-card.json",
      version: "0.3.0"
    },
    {
      name: "MCP",
      endpoint: "https://github.com/iamdevving/the-sealer/tree/main/mcp",
      version: "1.0.0"
    }
  ],
  capabilities: [
    "onchain-attestation",
    "agent-identity",
    "commitment-verification",
    "certificate-issuance",
    "leaderboard",
    "x402-payments"
  ],
  skills: [
    {
      name: "sealer-attest",
      registry: "clawhub.ai",
      install: "clawhub install iamdevving/sealer-attest"
    }
  ],
  paymentAddress: {
    base:   "eip155:8453:0x4386606286eEA12150386f0CFc55959F30de00D1",
    solana: "6JudwBzstGy61GeVaZye55awss3Uek4Sp49bGJE32dPj"
  },
  supportedTrust: ["reputation", "validation"],
  attestation: {
    protocol: "EAS",
    chain:    "Base mainnet",
    explorer: "https://base.easscan.org"
  }
};

export async function GET() {
  return NextResponse.json(agentCard, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}