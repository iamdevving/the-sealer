const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SealerSealed with account:", deployer.address);

  const SealerSealed = await ethers.getContractFactory("SealerSealed");
  const sealed = await SealerSealed.deploy(deployer.address);
  await sealed.waitForDeployment();
  const sealedAddress = await sealed.getAddress();

  console.log("SealerSealed (soulbound) deployed to:", sealedAddress);
  console.log("\nUpdate your .env.local:");
  console.log(`SEALED_CONTRACT_ADDRESS="${sealedAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
