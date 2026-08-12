const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const { ethers } = hre;
const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));
const explorer = (hash) => `https://sepolia.basescan.org/tx/${hash}`;

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("BASE_SEPOLIA_PRIVATE_KEY is required");
  const provider = deployer.provider;
  const network = await provider.getNetwork();
  if (network.chainId !== 84532n) throw new Error(`Refusing chain ${network.chainId}; expected Base Sepolia 84532`);
  if ((await provider.getBalance(deployer.address)) === 0n) throw new Error("Test wallet has no Base Sepolia ETH");

  const startedAt = Date.now();
  const transactions = [];
  async function record(label, txPromise) {
    const started = Date.now();
    const tx = await txPromise;
    const receipt = await tx.wait();
    const gasPrice = receipt.gasPrice || tx.gasPrice || 0n;
    const row = {
      label,
      hash: receipt.hash,
      explorer: explorer(receipt.hash),
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      gasPriceWei: gasPrice.toString(),
      feeWei: (receipt.gasUsed * gasPrice).toString(),
      observedConfirmationLatencyMs: Date.now() - started,
    };
    transactions.push(row);
    console.log(`${label}: ${row.explorer}`);
    return receipt;
  }

  const roleWallets = {
    approverA: ethers.Wallet.createRandom().connect(provider),
    approverB: ethers.Wallet.createRandom().connect(provider),
    compliance: ethers.Wallet.createRandom().connect(provider),
  };
  const roleFunding = ethers.parseEther("0.00002");
  for (const [label, wallet] of Object.entries(roleWallets)) {
    await record(`fund ephemeral ${label} gas`, deployer.sendTransaction({ to: wallet.address, value: roleFunding }));
  }

  const token = await ethers.deployContract("MockStablecoin");
  await record("deploy explicitly labeled demo token", token.deploymentTransaction());
  await token.waitForDeployment();
  const treasury = await ethers.deployContract("VerifiableTreasury", [token.target, deployer.address, U(100000), U(10000), 20]);
  await record("deploy verifiable treasury", treasury.deploymentTransaction());
  await treasury.waitForDeployment();

  await record("grant approver A", treasury.grantRole(await treasury.APPROVER_ROLE(), roleWallets.approverA.address));
  await record("grant approver B", treasury.grantRole(await treasury.APPROVER_ROLE(), roleWallets.approverB.address));
  await record("grant compliance", treasury.grantRole(await treasury.COMPLIANCE_ROLE(), roleWallets.compliance.address));
  await record("mint valueless demo token", token.mint(deployer.address, U(15000)));
  await record("approve escrow allowance", token.approve(treasury.target, U(15000)));

  const latest = await provider.getBlock("latest");
  const releaseAfter = latest.timestamp + 45;
  const expiresAt = latest.timestamp + 3600;
  const policyDigest = digest("DEMO-OFAC-UN-EU-SNAPSHOT:2026-08-10");
  const invoiceCommitment = digest("SALTED-DEMO-INVOICE:SG-CN:15000");
  await record("record expiring compliance attestation", treasury.connect(roleWallets.compliance).recordClearance(deployer.address, policyDigest, expiresAt + 3600, false));
  await record("propose 15,000-token settlement", treasury.proposeSettlement(deployer.address, deployer.address, U(15000), releaseAfter, expiresAt, invoiceCommitment, policyDigest));
  await record("distinct approval 1 of 2", treasury.connect(roleWallets.approverA).approveSettlement(1));
  await record("distinct approval 2 of 2", treasury.connect(roleWallets.approverB).approveSettlement(1));
  await record("fund revocable escrow", treasury.fundSettlement(1));

  const funded = {
    payer: (await token.balanceOf(deployer.address)).toString(),
    escrow: (await token.balanceOf(treasury.target)).toString(),
    state: Number((await treasury.settlements(1)).state),
  };
  while ((await provider.getBlock("latest")).timestamp < releaseAfter) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await treasury.releaseSettlement.staticCall(1);
  await record("release after challenge window", treasury.releaseSettlement(1, { gasLimit: 300000 }));
  const final = {
    beneficiary: (await token.balanceOf(deployer.address)).toString(),
    escrow: (await token.balanceOf(treasury.target)).toString(),
    state: Number((await treasury.settlements(1)).state),
  };
  const passed = funded.escrow === U(15000).toString() && final.escrow === "0" && final.beneficiary === U(15000).toString() && final.state === 4;
  if (!passed) throw new Error("Public-testnet reconciliation invariant failed");

  const totalGas = transactions.reduce((sum, row) => sum + BigInt(row.gasUsed), 0n);
  const totalFee = transactions.reduce((sum, row) => sum + BigInt(row.feeWei), 0n);
  const evidence = {
    generatedAt: new Date().toISOString(),
    network: "Base Sepolia",
    chainId: "84532",
    deployer: deployer.address,
    token: {
      address: token.target,
      name: "Mock Test Dollar",
      symbol: "mUSD",
      financialValue: "none",
      warning: "Project-deployed demo token; not USDC and not backed by fiat.",
    },
    treasury: treasury.target,
    ephemeralRoleAddresses: Object.fromEntries(Object.entries(roleWallets).map(([name, wallet]) => [name, wallet.address])),
    settlement: { id: 1, amountBaseUnits: U(15000).toString(), requiredDistinctApprovals: 2, releaseAfter, expiresAt },
    transactions,
    totals: {
      transactionCount: transactions.length,
      gasUsed: totalGas.toString(),
      feeWei: totalFee.toString(),
      observedWallClockMs: Date.now() - startedAt,
    },
    reconciliation: { funded, final, passed },
    claimBoundary: [
      "Receipts prove public Base Sepolia execution only.",
      "The demo token has no financial value and is not USDC.",
      "Compliance data is a synthetic policy digest, not certified screening.",
      "Ephemeral role keys exist only in this process and are not production key management.",
    ],
  };
  const out = path.join(__dirname, "..", "evidence", "base-sepolia.json");
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
