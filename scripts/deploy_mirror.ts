import pkg from "hardhat";
const { ethers } = pkg;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SealerMirror with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const Factory = await ethers.getContractFactory("SealerMirror");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ SealerMirror deployed to:", address);
  console.log("Add to .env.local: MIRROR_CONTRACT_ADDRESS=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
