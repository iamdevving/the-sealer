// src/types.ts
// TypeScript type definitions for The Sealer Protocol MCP server

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIndex = { [key: string]: any };

export interface LeaderboardEntry extends AnyIndex {
  rank: number;
  wallet: string;
  handle: string | null;
  proofPoints: number;
  claimType: string;
  claimLabel: string;
  difficulty: number;
  onTime: boolean;
  achievementCount: number;
}

export interface LeaderboardResponse extends AnyIndex {
  leaderboard: LeaderboardEntry[];
  claimType: string;
  claimLabel: string;
  total: number;
  limit: number;
}

export interface AgentProfile extends AnyIndex {
  wallet: string;
  handle: string | null;
  sid: SealerID | null;
  totalProofPoints: number;
  achievementCount: number;
  rank: number | null;
  commitments: Commitment[];
}

export interface SealerID extends AnyIndex {
  tokenId: string;
  name: string;
  entityType: string;
  imageUrl: string;
  chain: string;
  renewalCount: number;
  tokenUri: string;
}

export interface Commitment extends AnyIndex {
  uid: string;
  claimType: string;
  claimLabel: string;
  status: string;
  statement: string;
  deadline: string | null;
  proofPoints: number;
  difficulty: number;
  onTime: boolean;
}

export interface CommitmentStatus extends AnyIndex {
  uid: string;
  status: string;
  claimType: string;
  claimLabel: string;
  agentId: string;
  difficulty: number | null;
  proofPoints: number | null;
  deadline: string | null;
  mintedAt: string | null;
  lastChecked: string | null;
  amended: boolean;
}

export interface DifficultyPreviewResponse extends AnyIndex {
  claimType: string;
  claimLabel: string;
  difficulty: number;
  tier: string;
  tierLabel: string;
  bootstrapped: boolean;
  breakdown: {
    percentileScore: number;
    breadthMultiplier: number;
    metricsScored: string[];
  };
  proofPointsEstimate: {
    full: number;
    partial: number;
    failed: number;
    note: string;
  };
  interpretation: string;
  availableParams: string[];
  unknownParams?: string[];
}

export interface InfoproductsResponse extends AnyIndex {
  platform: string;
  url: string;
  tagline: string;
  description: string;
  payment: {
    protocol: string;
    token: string;
    chains: string[];
    recipient: { base: string; solana: string };
    note: string;
  };
  products: Record<string, unknown>;
  choosingAProduct: Record<string, string>;
  attestation: {
    protocol: string;
    chain: string;
    explorer: string;
    note: string;
  };
}

export type ClaimType =
  | 'x402_payment_reliability'
  | 'defi_trading_performance'
  | 'code_software_delivery'
  | 'website_app_delivery'
  | 'acp_job_delivery';

export const CLAIM_LABELS: Record<string, string> = {
  x402_payment_reliability: 'x402 Payment Reliability',
  defi_trading_performance: 'DeFi Trading Performance',
  code_software_delivery: 'Code / Software Delivery',
  website_app_delivery: 'Website / App Delivery',
  acp_job_delivery: 'ACP Job Delivery',
  all: 'All Categories',
};

export const VALID_CLAIM_TYPES: ClaimType[] = [
  'x402_payment_reliability',
  'defi_trading_performance',
  'code_software_delivery',
  'website_app_delivery',
  'acp_job_delivery',
];
