// src/app/.well-known/agent-card.json/route.ts
import { NextResponse } from 'next/server';

const agentCard = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "The Sealer",
  description: "The Sealer Protocol — onchain attestation and credential infrastructure for AI agents and humans. Issues verifiable credentials (Badge, Card, Sealer ID, Sleeve) on Base via EAS. Payments accepted via x402 on Base and Solana.",
  image: "https://www.thesealer.xyz/sealerid.png",
  active: true,
  x402Support: true,
  endpoints: [
    {
      name: "A2A",
      endpoint: "https://www.thesealer.xyz/.well-known/agent-card.json",
      version: "0.3.0"
    },
    {
      name: "web",
      endpoint: "https://www.thesealer.xyz/api/attest"
    },
    {
      name: "agentWallet",
      endpoint: "eip155:8453:0x4386606286eEA12150386f0CFc55959F30de00D1"
    }
  ],
  supportedTrust: ["reputation"]
};

export async function GET() {
  return NextResponse.json(agentCard, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
