const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SealerSleeve with account:", deployer.address);

  const SealerSleeve = await ethers.getContractFactory("SealerSleeve");
  const sleeve = await SealerSleeve.deploy(deployer.address);
  await sleeve.waitForDeployment();
  const sleeveAddress = await sleeve.getAddress();

  console.log("SealerSleeve deployed to:", sleeveAddress);
  console.log("\nUpdate your .env.local:");
  console.log(`SLEEVE_CONTRACT_ADDRESS="${sleeveAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
