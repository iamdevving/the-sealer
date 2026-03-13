// scripts/register-schema-v2.ts
//
// Registers Achievement schema v2 on Base mainnet EAS.
//
// Run with:
//   npx hardhat run scripts/register-schema-v2.ts --network base
//
// After running:
//   1. Copy the logged schema UID
//   2. Update EAS_ACHIEVEMENT_SCHEMA_UID in Vercel env
//   3. Update EAS_ACHIEVEMENT_SCHEMA_UID in .env.local
//   4. Rename old UID in .env.local to EAS_ACHIEVEMENT_SCHEMA_UID_V1

import { ethers } from 'hardhat';

const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020';

const SCHEMA_REGISTRY_ABI = [
  'function register(string calldata schema, address resolver, bool revocable) external returns (bytes32)',
  'event Registered(bytes32 indexed uid, address indexed registerer, tuple(bytes32 uid, address resolver, bool revocable, string schema) record)',
];

// Final locked schema
const SCHEMA =
  'string claimType,' +
  'string commitmentUID,' +
  'string evidence,' +
  'string metric,' +
  'uint64 achievedAt,' +
  'bool onTime,' +
  'uint8 difficulty,' +
  'uint8 difficultyVersion,' +
  'bool bootstrapped,' +
  'int16 daysEarly,' +
  'uint32 proofPoints,' +
  'uint8 metricsMet,' +
  'uint8 metricsTotal';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Registering schema with account:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Account balance:', ethers.formatEther(balance), 'ETH');
  if (balance === 0n) throw new Error('Account has no ETH');

  const registry = new ethers.Contract(
    SCHEMA_REGISTRY_ADDRESS,
    SCHEMA_REGISTRY_ABI,
    deployer,
  );

  console.log('\nSchema:', SCHEMA);
  console.log('Resolver: zero address | Revocable: false\n');

  const tx = await registry.register(SCHEMA, ethers.ZeroAddress, false);
  console.log('TX submitted:', tx.hash);

  const receipt = await tx.wait();
  console.log('Confirmed in block:', receipt.blockNumber);

  const iface = new ethers.Interface(SCHEMA_REGISTRY_ABI);
  let schemaUID: string | null = null;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'Registered') { schemaUID = parsed.args[0]; break; }
    } catch { /* skip */ }
  }

  if (!schemaUID) {
    console.warn('Could not parse event. Check TX on BaseScan:');
    console.log(`  https://basescan.org/tx/${tx.hash}`);
  } else {
    console.log('\n════════════════════════════════════════════════════════');
    console.log('✅ SCHEMA V2 REGISTERED');
    console.log('════════════════════════════════════════════════════════');
    console.log('UID         :', schemaUID);
    console.log('EAS Explorer:', `https://base.easscan.org/schema/view/${schemaUID}`);
    console.log('\nVercel + .env.local:');
    console.log(`  EAS_ACHIEVEMENT_SCHEMA_UID=${schemaUID}`);
    console.log('  (rename old UID to EAS_ACHIEVEMENT_SCHEMA_UID_V1)');
    console.log('════════════════════════════════════════════════════════\n');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
