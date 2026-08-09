require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const privateKey = process.env.BASE_SEPOLIA_PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 500 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: privateKey ? [privateKey] : [],
    },
  },
};
