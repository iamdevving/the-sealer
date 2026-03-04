import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || "";
const ALCHEMY_RPC = process.env.ALCHEMY_RPC_URL || "";

const config: HardhatUserConfig = {
  solidity: {
  version: "0.8.28",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    evmVersion: "cancun",
  },
},
  networks: {
    base: {
      url: ALCHEMY_RPC,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 8453,
    },
    "base-sepolia": {
      url: "https://sepolia.base.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 84532,
    },
  },
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
};

export default config;
