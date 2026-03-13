// scripts/deploy-commitment-certificate.ts
//
// Deploys SealerCommitment and SealerCertificate to Base mainnet.
//
// Run AFTER registering the schema:
//   npx hardhat run scripts/deploy-commitment-certificate.ts --network base
//
// After running:
//   1. Copy both addresses from the output
//   2. Add to Vercel env and .env.local:
//        COMMITMENT_CONTRACT_ADDRESS=0x...
//        CERTIFICATE_CONTRACT_ADDRESS=0x...
//   3. Run the verify commands printed below

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying with account:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  if (balance < ethers.parseEther('0.002')) {
    throw new Error('Low ETH — fund account before deploying (need ~0.002 ETH)');
  }

  // ── SealerCommitment ─────────────────────────────────────────────────────
  console.log('\nDeploying SealerCommitment...');
  const Commitment = await ethers.getContractFactory('SealerCommitment');
  const commitment = await Commitment.deploy(deployer.address);
  await commitment.waitForDeployment();
  const commitmentAddress = await commitment.getAddress();
  console.log('✅ SealerCommitment:', commitmentAddress);

  // ── SealerCertificate ────────────────────────────────────────────────────
  console.log('\nDeploying SealerCertificate...');
  const Certificate = await ethers.getContractFactory('SealerCertificate');
  const certificate = await Certificate.deploy(deployer.address);
  await certificate.waitForDeployment();
  const certificateAddress = await certificate.getAddress();
  console.log('✅ SealerCertificate:', certificateAddress);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════');
  console.log('DEPLOYMENT COMPLETE');
  console.log('════════════════════════════════════════════════════════');
  console.log('SealerCommitment  :', commitmentAddress);
  console.log('SealerCertificate :', certificateAddress);
  console.log('\nAdd to Vercel + .env.local:');
  console.log(`  COMMITMENT_CONTRACT_ADDRESS=${commitmentAddress}`);
  console.log(`  CERTIFICATE_CONTRACT_ADDRESS=${certificateAddress}`);
  console.log('\nVerify on Basescan:');
  console.log(`  npx hardhat verify --network base ${commitmentAddress} "${deployer.address}"`);
  console.log(`  npx hardhat verify --network base ${certificateAddress} "${deployer.address}"`);
  console.log('\nBasescan:');
  console.log(`  https://basescan.org/address/${commitmentAddress}`);
  console.log(`  https://basescan.org/address/${certificateAddress}`);
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch((err) => { console.error(err); process.exit(1); });