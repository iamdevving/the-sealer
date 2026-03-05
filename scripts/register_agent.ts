const { ethers } = require("hardhat");

// ERC-8004 Identity Registry on Base mainnet
const REGISTRY_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

// Minimal ABI — just the register function
const REGISTRY_ABI = [
  "function register(string calldata agentURI) external returns (uint256 agentId)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Registering agent with wallet:", deployer.address);

  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, deployer);

  // Check if already registered
  const balance = await registry.balanceOf(deployer.address).catch(() => 0n);
  if (balance > 0n) {
    const agentId = await registry.tokenOfOwnerByIndex(deployer.address, 0);
    console.log(`Already registered! Agent ID: ${agentId}`);
    return;
  }

  // Registration file hosted at our domain
  const agentURI = "https://www.thesealer.xyz/agent.json";

  console.log(`Registering with URI: ${agentURI}`);
  const tx = await registry.register(agentURI);
  console.log(`TX submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`✅ Registered! TX: ${receipt.hash}`);
  console.log(`Check: https://basescan.org/tx/${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
