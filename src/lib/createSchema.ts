// src/lib/createSchema.ts - ONE-TIME script to create Seal schema
import { config } from 'dotenv';
config({ path: '.env.local' }); // ← Explicitly load .env.local

import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';

console.log('[Seal] DEBUG: Loading .env.local...');
console.log('[Seal] TEST_PRIVATE_KEY length from env:', process.env.TEST_PRIVATE_KEY?.length || 0);
console.log('[Seal] First 10 chars of key:', process.env.TEST_PRIVATE_KEY?.slice(0,10) || 'MISSING');

const rpcUrl = process.env.ALCHEMY_RPC_URL!;
const rawPk = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = rawPk.startsWith('0x') ? rawPk : `0x${rawPk}`;

console.log('[Seal] Final privateKey length:', privateKey.length);

if (privateKey.length !== 66) {
  throw new Error(`❌ TEST_PRIVATE_KEY is wrong. Length is ${privateKey.length}. It must be exactly 66 chars starting with 0x. Check .env.local`);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });

async function main() {
  console.log('[Seal] Creating schema "string achievement"...');

  const schemaRegistry = new SchemaRegistry('0x4200000000000000000000000000000000000020');
  (schemaRegistry as any).connect(walletClient);

  const tx = await schemaRegistry.register({
    schema: 'string achievement',
    resolverAddress: '0x0000000000000000000000000000000000000000',
    revocable: true,
  });

  console.log('[Seal] Schema tx sent:', tx);

  const txHash = typeof tx === 'string' ? (tx as Hash) : (tx as any).hash || (tx as any).transactionHash;
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log('[Seal] ✅ SCHEMA CREATED SUCCESSFULLY!');
  console.log('Transaction hash:', receipt.transactionHash);
  console.log('View on Basescan:', `https://sepolia.basescan.org/tx/${receipt.transactionHash}`);
  console.log('');
  console.log('✅ NEXT: Go to https://base-sepolia.easscan.org/schemas');
  console.log('Find the newest schema (contains "achievement") → click it → copy the Schema UID (long 0x... string)');
}

main().catch((error) => {
  console.error('[Seal] ❌ Error:', error.message || error);
});