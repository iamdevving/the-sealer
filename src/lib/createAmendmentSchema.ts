// src/lib/createAmendmentSchema.ts
// ONE-TIME script — run once to register the amendment EAS schema on Base mainnet.
//
// Run with:
//   npx ts-node -r tsconfig-paths/register src/lib/createAmendmentSchema.ts
//
// After running, copy the Schema UID from the output and add to .env.local:
//   EAS_AMENDMENT_SCHEMA_UID=0x...

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';

const rpcUrl    = process.env.ALCHEMY_RPC_URL!;
const rawPk     = (process.env.TEST_PRIVATE_KEY || '').trim();
const privateKey = rawPk.startsWith('0x') ? rawPk : `0x${rawPk}`;

if (privateKey.length !== 66) {
  throw new Error(`TEST_PRIVATE_KEY wrong length: ${privateKey.length}. Must be 66 chars (0x + 64 hex).`);
}

const account      = privateKeyToAccount(privateKey as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

// Schema string — must match issueAmendmentAttestation in x402.ts exactly
const AMENDMENT_SCHEMA = 'string claimType,string originalUID,string newMetric,uint8 newDifficulty,bool bootstrapped';

// Base mainnet SchemaRegistry address
const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020';

async function main() {
  console.log('[createAmendmentSchema] Registering amendment schema on Base mainnet...');
  console.log('[createAmendmentSchema] Schema:', AMENDMENT_SCHEMA);
  console.log('[createAmendmentSchema] Deployer:', account.address);

  const registry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS);
  (registry as any).connect(walletClient);

  const tx = await registry.register({
    schema:          AMENDMENT_SCHEMA,
    resolverAddress: '0x0000000000000000000000000000000000000000',
    revocable:       true,
  });

  const txHash = typeof tx === 'string'
    ? (tx as Hash)
    : (tx as any).hash || (tx as any).transactionHash;

  console.log('[createAmendmentSchema] Tx sent:', txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log('[createAmendmentSchema] ✅ Schema registered!');
  console.log('Tx hash:', receipt.transactionHash);
  console.log('');
  console.log('Next steps:');
  console.log('1. Go to https://base.easscan.org/schemas');
  console.log('2. Find the newest schema (contains "claimType,originalUID,newMetric")');
  console.log('3. Copy the Schema UID (long 0x... string)');
  console.log('4. Add to .env.local:');
  console.log('   EAS_AMENDMENT_SCHEMA_UID=0x<YOUR_UID_HERE>');
}

main().catch(err => {
  console.error('[createAmendmentSchema] Error:', err.message || err);
  process.exit(1);
});
