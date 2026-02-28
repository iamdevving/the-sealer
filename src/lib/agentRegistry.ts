// src/lib/agentRegistry.ts
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.ALCHEMY_RPC_URL!)
});

const REGISTRY_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;

const REGISTRY_ABI = [{
  inputs: [{ name: 'owner', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function'
}] as const;

export async function checkEntityType(walletAddress: string): Promise<'AI_AGENT' | 'HUMAN' | 'UNKNOWN'> {
  if (!walletAddress || walletAddress === '0x0000000000000000000000000000000000000000') return 'UNKNOWN';
  try {
    const balance = await client.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`]
    });
    return Number(balance) > 0 ? 'AI_AGENT' : 'HUMAN';
  } catch (e) {
    console.error('[The Sealer] Registry lookup failed:', e);
    return 'UNKNOWN';
  }
}