import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as `0x${string}`;
const ABI = parseAbi([
  'function register(string calldata agentURI) external returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
]);

async function main() {
  const rawKey = (process.env.TEST_PRIVATE_KEY || '').trim();
  const privateKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({ chain: base, transport: http(process.env.ALCHEMY_RPC_URL!) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.ALCHEMY_RPC_URL!) });

  console.log('Registering agent with wallet:', account.address);

  try {
    const balance = await publicClient.readContract({ address: REGISTRY, abi: ABI, functionName: 'balanceOf', args: [account.address] });
    if (balance > BigInt(0)) { console.log('Already registered!'); return; }
  } catch {}

  // Must be hosted at /.well-known/agent-card.json per ERC-8004 spec
  const agentURI = 'https://www.thesealer.xyz/.well-known/agent-card.json';
  console.log(`Registering with URI: ${agentURI}`);

  const hash = await walletClient.writeContract({ address: REGISTRY, abi: ABI, functionName: 'register', args: [agentURI] });
  console.log(`TX submitted: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status}`);
  console.log(`TX: https://basescan.org/tx/${hash}`);
}

main().catch(console.error);
