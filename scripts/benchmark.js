const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const { ethers, network } = hre;
const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

async function measured(label, txPromise) {
  const started = performance.now();
  const tx = await txPromise;
  const receipt = await tx.wait();
  return {
    label,
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
    status: receipt.status,
  };
}

async function main() {
  const [admin, payer, beneficiary, approverA, approverB, compliance] = await ethers.getSigners();
  const token = await ethers.deployContract("MockStablecoin");
  await token.waitForDeployment();
  const treasury = await ethers.deployContract("VerifiableTreasury", [token.target, admin.address, U(100000), U(10000), 60]);
  await treasury.waitForDeployment();
  await treasury.grantRole(await treasury.APPROVER_ROLE(), approverA.address);
  await treasury.grantRole(await treasury.APPROVER_ROLE(), approverB.address);
  await treasury.grantRole(await treasury.COMPLIANCE_ROLE(), compliance.address);
  await token.mint(payer.address, U(50000));
  await token.connect(payer).approve(treasury.target, ethers.MaxUint256);

  const block = await ethers.provider.getBlock("latest");
  const releaseAfter = block.timestamp + 120;
  const expiresAt = block.timestamp + 3600;
  const policyDigest = digest("OFAC-UN-EU-demo-snapshot:2026-08-10");
  const invoiceCommitment = digest("salted-invoice-commitment");
  const rows = [];
  rows.push(await measured("record clearance", treasury.connect(compliance).recordClearance(beneficiary.address, policyDigest, expiresAt + 3600, false)));
  rows.push(await measured("propose high-value settlement", treasury.proposeSettlement(payer.address, beneficiary.address, U(15000), releaseAfter, expiresAt, invoiceCommitment, policyDigest)));
  rows.push(await measured("approval 1/2", treasury.connect(approverA).approveSettlement(1)));
  rows.push(await measured("approval 2/2", treasury.connect(approverB).approveSettlement(1)));
  rows.push(await measured("fund escrow", treasury.connect(payer).fundSettlement(1)));

  const payerAfterFunding = await token.balanceOf(payer.address);
  const escrowAfterFunding = await token.balanceOf(treasury.target);
  await network.provider.send("evm_setNextBlockTimestamp", [releaseAfter]);
  await network.provider.send("evm_mine");
  rows.push(await measured("release after challenge window", treasury.releaseSettlement(1)));

  const beneficiaryFinal = await token.balanceOf(beneficiary.address);
  const escrowFinal = await token.balanceOf(treasury.target);
  const totalGas = rows.reduce((sum, row) => sum + BigInt(row.gasUsed), 0n);
  const report = {
    generatedAt: new Date().toISOString(),
    network: "hardhat-local",
    token: "Mock Test Dollar (no value)",
    scenario: "15,000 token cross-border settlement requiring two approvals",
    transactions: rows,
    totals: {
      transactionCount: rows.length,
      gasUsed: totalGas.toString(),
      observedWallClockLatencyMs: Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) * 100) / 100,
    },
    reconciliation: {
      payerAfterFunding: payerAfterFunding.toString(),
      escrowAfterFunding: escrowAfterFunding.toString(),
      beneficiaryFinal: beneficiaryFinal.toString(),
      escrowFinal: escrowFinal.toString(),
      invariant: "escrowFinal == 0 and beneficiaryFinal == 15000000000",
      passed: escrowFinal === 0n && beneficiaryFinal === U(15000),
    },
    limitations: [
      "Local latency excludes public RPC, mempool, sequencer, and wallet confirmation time.",
      "Gas units are reproducible, but fiat cost requires a live gas price and exchange rate.",
      "Compliance digest demonstrates policy binding; it is not a certified sanctions-screening service.",
    ],
  };
  const outDir = path.join(__dirname, "..", "evidence");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "benchmark.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
