const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy SealerStatement (Badge + Card — soulbound)
  console.log("\nDeploying SealerStatement...");
  const SealerStatement = await ethers.getContractFactory("SealerStatement");
  const statement = await SealerStatement.deploy(deployer.address);
  await statement.waitForDeployment();
  const statementAddress = await statement.getAddress();
  console.log("SealerStatement deployed to:", statementAddress);

  // Deploy SealerID (identity — soulbound, dynamic URI)
  console.log("\nDeploying SealerID...");
  const SealerID = await ethers.getContractFactory("SealerID");
  const sealerID = await SealerID.deploy(deployer.address);
  await sealerID.waitForDeployment();
  const sealerIDAddress = await sealerID.getAddress();
  console.log("SealerID deployed to:", sealerIDAddress);

  // Deploy SealerSealed (transferable)
  console.log("\nDeploying SealerSealed...");
  const SealerSealed = await ethers.getContractFactory("SealerSealed");
  const sealed = await SealerSealed.deploy(deployer.address);
  await sealed.waitForDeployment();
  const sealedAddress = await sealed.getAddress();
  console.log("SealerSealed deployed to:", sealedAddress);

  console.log("\n✅ All contracts deployed!");
  console.log("Add these to your .env.local:");
  console.log(`STATEMENT_CONTRACT_ADDRESS="${statementAddress}"`);
  console.log(`SEALER_ID_CONTRACT_ADDRESS="${sealerIDAddress}"`);
  console.log(`SEALED_CONTRACT_ADDRESS="${sealedAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
