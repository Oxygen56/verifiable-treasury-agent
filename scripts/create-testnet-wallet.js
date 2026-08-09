const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  throw new Error(".env already exists; refusing to overwrite a possibly funded wallet");
}

const wallet = Wallet.createRandom();
const contents = [
  "BASE_SEPOLIA_RPC_URL=https://sepolia.base.org",
  `BASE_SEPOLIA_PRIVATE_KEY=${wallet.privateKey}`,
  "BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "",
].join("\n");
fs.writeFileSync(envPath, contents, { mode: 0o600, flag: "wx" });

const evidenceDir = path.join(root, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const publicRecord = {
  generatedAt: new Date().toISOString(),
  purpose: "Base Sepolia hackathon deployment only",
  address: wallet.address,
  network: "Base Sepolia",
  chainId: 84532,
  warning: "Test-only wallet. Never send mainnet assets. Private key is stored only in gitignored .env.",
};
fs.writeFileSync(path.join(evidenceDir, "testnet-wallet-public.json"), JSON.stringify(publicRecord, null, 2) + "\n");
console.log(wallet.address);
