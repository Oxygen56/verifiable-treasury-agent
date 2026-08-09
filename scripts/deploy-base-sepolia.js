const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const { ethers } = hre;
const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const U = (value) => ethers.parseUnits(String(value), 6);

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("BASE_SEPOLIA_PRIVATE_KEY is required");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 84532n) throw new Error(`Refusing to deploy to chain ${network.chainId}; expected Base Sepolia 84532`);
  const usdc = process.env.BASE_SEPOLIA_USDC || DEFAULT_USDC;
  if ((await ethers.provider.getCode(usdc)) === "0x") throw new Error("Configured USDC address has no contract code");
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error("Deployer has no Base Sepolia ETH; use a free faucet, never mainnet funds");

  const started = Date.now();
  const treasury = await ethers.deployContract("VerifiableTreasury", [usdc, deployer.address, U(100000), U(10000), 300]);
  const deployment = await treasury.deploymentTransaction().wait();
  const address = await treasury.getAddress();
  const evidence = {
    generatedAt: new Date().toISOString(),
    network: "Base Sepolia",
    chainId: network.chainId.toString(),
    contract: address,
    testUsdc: usdc,
    deployer: deployer.address,
    deploymentTx: deployment.hash,
    blockNumber: deployment.blockNumber,
    gasUsed: deployment.gasUsed.toString(),
    observedConfirmationLatencyMs: Date.now() - started,
    explorer: `https://sepolia.basescan.org/tx/${deployment.hash}`,
    claimBoundary: "Public testnet deployment using test assets with no financial value; not a production or regulatory claim.",
  };
  const outDir = path.join(__dirname, "..", "evidence");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "base-sepolia.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
