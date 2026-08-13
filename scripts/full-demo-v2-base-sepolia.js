const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const { ethers } = hre;
const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));
const explorer = (hash) => `https://sepolia.basescan.org/tx/${hash}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROLE_NAMES = [
  "payer", "beneficiaryClean", "beneficiaryBlocked", "approverA", "approverB",
  "complianceA", "complianceB", "relayer",
];

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function writeRecoveryFileExclusive(recoveryPath, recovery) {
  const descriptor = fs.openSync(recoveryPath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(recovery, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.chmodSync(recoveryPath, 0o600);
}

function loadRecoveryFile(recoveryPath, provider) {
  const stat = fs.statSync(recoveryPath);
  if (!stat.isFile()) throw new Error(`Recovery path is not a regular file: ${recoveryPath}`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`Recovery file permissions must be 0600: ${recoveryPath}`);

  const recovery = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
  if (String(recovery.chainId) !== "84532" || recovery.network !== "Base Sepolia") {
    throw new Error(`Recovery file is not for Base Sepolia chain 84532: ${recoveryPath}`);
  }
  const roles = {};
  for (const name of ROLE_NAMES) {
    const entry = recovery.roles?.[name];
    if (!entry?.address || !entry?.privateKey) throw new Error(`Recovery file is missing role ${name}`);
    const wallet = new ethers.Wallet(entry.privateKey, provider);
    if (wallet.address !== ethers.getAddress(entry.address)) {
      throw new Error(`Recovery address/private-key mismatch for role ${name}`);
    }
    roles[name] = wallet;
  }
  return { recovery, roles };
}

const intentTypes = { SettlementIntent: [
  { name: "payer", type: "address" }, { name: "beneficiary", type: "address" },
  { name: "amount", type: "uint128" }, { name: "expiresAt", type: "uint48" },
  { name: "quoteValidUntil", type: "uint48" }, { name: "clearanceId", type: "bytes32" },
  { name: "invoiceCommitment", type: "bytes32" }, { name: "policyDigest", type: "bytes32" },
  { name: "corridorDigest", type: "bytes32" }, { name: "quoteDigest", type: "bytes32" },
  { name: "clientOrderId", type: "uint256" }, { name: "nonce", type: "uint256" },
] };

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("BASE_SEPOLIA_PRIVATE_KEY is required");
  const provider = deployer.provider;
  const network = await provider.getNetwork();
  if (network.chainId !== 84532n) throw new Error(`Refusing chain ${network.chainId}; expected Base Sepolia 84532`);
  if ((await provider.getBalance(deployer.address)) < ethers.parseEther("0.001")) throw new Error("Insufficient Base Sepolia test ETH");

  const startedAt = Date.now();
  const resumeTokenAddress = process.env.V2_RESUME_TOKEN_ADDRESS;
  const resumeTreasuryAddress = process.env.V2_RESUME_TREASURY_ADDRESS;
  const isResume = Boolean(resumeTokenAddress || resumeTreasuryAddress);
  const allowNewRun = process.env.V2_ALLOW_NEW_RUN === "1";
  if (isResume && (!resumeTokenAddress || !resumeTreasuryAddress)) throw new Error("Both V2 resume addresses are required");
  if (isResume && allowNewRun) throw new Error("V2_ALLOW_NEW_RUN=1 cannot be combined with resume mode");
  const transactions = [];
  const recoveryDirectory = path.join(__dirname, "..", "evidence", "private");
  fs.mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(recoveryDirectory, 0o700);
  const requestedRecoveryFilename = process.env.V2_RECOVERY_FILE || "base-sepolia-v2-recovery.json";
  if (path.basename(requestedRecoveryFilename) !== requestedRecoveryFilename) {
    throw new Error("V2_RECOVERY_FILE must be a filename inside evidence/private, not a path");
  }
  let recoveryPath = path.join(recoveryDirectory, requestedRecoveryFilename);
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
    process.stdout.write(`${label}: ${row.explorer}\n`);
    return receipt;
  }

  async function recordExpectedRevert(label, signer, contract, method, args) {
    const data = contract.interface.encodeFunctionData(method, args);
    const tx = await signer.sendTransaction({ to: contract.target, data, gasLimit: 750000 });
    try {
      await tx.wait();
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      const receipt = error.receipt;
      if (!receipt || receipt.status !== 0) throw error;
      const row = {
        label,
        hash: receipt.hash,
        explorer: explorer(receipt.hash),
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        gasPriceWei: (receipt.gasPrice || 0n).toString(),
        feeWei: (receipt.gasUsed * (receipt.gasPrice || 0n)).toString(),
        observedConfirmationLatencyMs: null,
        expectedRevert: true,
      };
      transactions.push(row);
      process.stdout.write(`${label}: ${row.explorer}\n`);
      return receipt;
    }
  }

  let roles;
  if (isResume) {
    if (!fs.existsSync(recoveryPath)) throw new Error(`Resume requires the original recovery file: ${recoveryPath}`);
    ({ roles } = loadRecoveryFile(recoveryPath, provider));
    process.stdout.write(`loaded and verified recovery wallets from ${recoveryPath}\n`);
  } else {
    if (fs.existsSync(recoveryPath)) {
      if (!allowNewRun) {
        throw new Error(`Recovery file already exists; refusing to overwrite it: ${recoveryPath}. Set V2_ALLOW_NEW_RUN=1 for a separate fresh run.`);
      }
      recoveryPath = path.join(recoveryDirectory, `base-sepolia-v2-recovery-${timestampForFilename()}.json`);
    }
    roles = Object.fromEntries(ROLE_NAMES.map((name) => [name, ethers.Wallet.createRandom().connect(provider)]));
    writeRecoveryFileExclusive(recoveryPath, {
      createdAt: new Date().toISOString(),
      network: "Base Sepolia",
      chainId: "84532",
      warning: "Private recovery material for test-only ephemeral wallets. Never commit.",
      roles: Object.fromEntries(Object.entries(roles).map(([name, wallet]) => [name, { address: wallet.address, privateKey: wallet.privateKey }])),
    });
    process.stdout.write(`persisted recovery wallets with mode 0600 at ${recoveryPath}\n`);
  }

  let token;
  let treasury;
  if (isResume) {
    token = await ethers.getContractAt("MockStablecoin", resumeTokenAddress);
    treasury = await ethers.getContractAt("VerifiableTreasuryV2", resumeTreasuryAddress);
    process.stdout.write(`resuming token ${token.target} and treasury ${treasury.target}\n`);
  } else {
    token = await ethers.deployContract("MockStablecoin");
    await record("deploy valueless mUSD demo asset", token.deploymentTransaction());
    await token.waitForDeployment();
    treasury = await ethers.deployContract("VerifiableTreasuryV2", [token.target, deployer.address, U(100000), U(10000), 20]);
    await record("deploy hardened VerifiableTreasuryV2", treasury.deploymentTransaction());
    await treasury.waitForDeployment();
  }
  if ((await provider.getCode(token.target)) === "0x") throw new Error("Token deployment has no runtime code");
  if ((await provider.getCode(treasury.target)) === "0x") throw new Error("Treasury deployment has no runtime code");
  if (ethers.getAddress(await treasury.stablecoin()) !== ethers.getAddress(token.target)) {
    throw new Error("Resume token does not match the treasury stablecoin");
  }
  if (isResume) {
    const defaultAdminRole = await treasury.DEFAULT_ADMIN_ROLE();
    if (!(await treasury.hasRole(defaultAdminRole, deployer.address))) {
      throw new Error("Connected deployer is not the treasury admin recorded by the resumed deployment");
    }
    const state1 = Number((await treasury.settlements(1)).state);
    const state2 = Number((await treasury.settlements(2)).state);
    if (state1 !== 0 || state2 !== 0) {
      throw new Error("The resumed demo already has settlement state; use the read-only evidence verifier or the dedicated recovery script instead of replaying it");
    }
  }

  const gasActors = ["payer", "approverA", "approverB", "complianceA", "complianceB", "relayer"];
  const minimumGasBalance = ethers.parseEther("0.00012");
  for (const name of gasActors) {
    const balance = await provider.getBalance(roles[name].address);
    if (balance < minimumGasBalance) {
      await record(`fund ${name} test gas`, deployer.sendTransaction({ to: roles[name].address, value: minimumGasBalance - balance }));
    }
  }

  for (const [label, role, actor] of [
    ["grant approver A", await treasury.APPROVER_ROLE(), roles.approverA],
    ["grant approver B", await treasury.APPROVER_ROLE(), roles.approverB],
    ["grant compliance A", await treasury.COMPLIANCE_ROLE(), roles.complianceA],
    ["grant compliance B", await treasury.COMPLIANCE_ROLE(), roles.complianceB],
  ]) {
    if (!(await treasury.hasRole(role, actor.address))) await record(label, treasury.grantRole(role, actor.address));
  }
  const targetPayerBalance = U(30000);
  const payerBalance = await token.balanceOf(roles.payer.address);
  if (payerBalance > targetPayerBalance) throw new Error("Resumed payer balance exceeds the expected pre-demo balance; refusing ambiguous replay");
  if (payerBalance < targetPayerBalance) {
    await record("mint mUSD to distinct payer", token.mint(roles.payer.address, targetPayerBalance - payerBalance));
  }
  if ((await token.allowance(roles.payer.address, treasury.target)) !== targetPayerBalance) {
    await record("payer approves exact escrow allowance", token.connect(roles.payer).approve(treasury.target, targetPayerBalance));
  }

  const now = (await provider.getBlock("latest")).timestamp;
  const expiresAt = now + 3600;
  const quoteValidUntil = now + 1800;
  const policyDigest = digest("SYNTHETIC-OFAC-UN-SNAPSHOT:2026-08-12T13:00Z");
  const corridorDigest = digest("SCENARIO:SG-SGD>BASE-mUSD>CN-CNY");
  const domain = { name: "VerifiableTreasury", version: "2", chainId: 84532, verifyingContract: treasury.target };

  for (const [name, subject] of [["payer", roles.payer], ["clean beneficiary", roles.beneficiaryClean], ["blocked beneficiary", roles.beneficiaryBlocked]]) {
    await record(
      `attest synthetic risk for ${name}`,
      treasury.connect(roles.complianceA).attestInitialRisk(subject.address, false, digest(`SYNTHETIC-RISK-EVIDENCE:${name}:2026-08-12`)),
    );
  }

  async function issueClearance(beneficiary, amount, label) {
    const receipt = await record(
      `issue ${label} payer-bound corridor clearance`,
      treasury.connect(roles.complianceA).issueClearance(
        roles.payer.address,
        beneficiary.address,
        policyDigest,
        corridorDigest,
        amount,
        expiresAt + 600,
      ),
    );
    return receipt.logs
      .map((log) => { try { return treasury.interface.parseLog(log); } catch { return null; } })
      .find((event) => event?.name === "ClearanceIssued").args.clearanceId;
  }

  async function propose(id, beneficiary, amount, clientOrderId, invoice, salt, clearanceId, nonce) {
    const invoiceData = ethers.toUtf8Bytes(invoice);
    const invoiceCommitment = await treasury.computeInvoiceCommitment(
      roles.payer.address,
      beneficiary.address,
      amount,
      corridorDigest,
      clientOrderId,
      invoiceData,
      salt,
    );
    const intent = {
      payer: roles.payer.address,
      beneficiary: beneficiary.address,
      amount,
      expiresAt,
      quoteValidUntil,
      clearanceId,
      invoiceCommitment,
      policyDigest,
      corridorDigest,
      quoteDigest: digest(`ZERO-FEE-QUOTE:${clientOrderId}:INPUT=OUTPUT`),
      clientOrderId,
      nonce,
    };
    const signature = await roles.payer.signTypedData(domain, intentTypes, intent);
    await record(`${id} relayer submits payer-signed intent`, treasury.connect(roles.relayer).proposeWithSignature(intent, signature));
    await record(`${id} distinct approval wallet 1 of 2`, treasury.connect(roles.approverA).approveSettlement(id));
    await record(`${id} distinct approval wallet 2 of 2`, treasury.connect(roles.approverB).approveSettlement(id));
    await record(`${id} payer funds revocable escrow`, treasury.connect(roles.payer).fundSettlement(id));
    return {
      intent: Object.fromEntries(Object.entries(intent).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])),
      invoiceData,
      salt,
    };
  }

  const cleanSalt = ethers.randomBytes(32);
  const blockedSalt = ethers.randomBytes(32);
  const cleanClearance = await issueClearance(roles.beneficiaryClean, U(15000), "clean-path");
  const blockedClearance = await issueClearance(roles.beneficiaryBlocked, U(15000), "blocked-path");
  const clean = await propose(1, roles.beneficiaryClean, U(15000), 8842001, "SYNTHETIC|INV-8842-A|SG-CN|15000-mUSD", cleanSalt, cleanClearance, 0);
  const blocked = await propose(2, roles.beneficiaryBlocked, U(15000), 8842002, "SYNTHETIC|INV-8842-B|SG-CN|15000-mUSD", blockedSalt, blockedClearance, 1);

  await record(
    "2 synthetic sanctions update freezes beneficiary",
    treasury.connect(roles.complianceA).flagSubjectSanctioned(
      roles.beneficiaryBlocked.address,
      digest("SYNTHETIC-SANCTIONS-HIT:PUBLIC-NEGATIVE-CONTROL"),
    ),
  );
  const cleanSettlement = await treasury.settlements(1);
  while ((await provider.getBlock("latest")).timestamp < Number(cleanSettlement.releaseAfter)) await sleep(2000);
  await recordExpectedRevert("2 release blocked on-chain after sanctions update", roles.relayer, treasury, "releaseSettlement", [2]);
  await record("2 payer cancels and receives full refund", treasury.connect(roles.payer).cancelSettlement(2, digest("SANCTIONS-ROLLBACK")));
  await record("1 clean settlement releases to distinct beneficiary", treasury.connect(roles.relayer).releaseSettlement(1));

  const final = {
    payer: (await token.balanceOf(roles.payer.address)).toString(),
    beneficiaryClean: (await token.balanceOf(roles.beneficiaryClean.address)).toString(),
    beneficiaryBlocked: (await token.balanceOf(roles.beneficiaryBlocked.address)).toString(),
    escrow: (await token.balanceOf(treasury.target)).toString(),
    totalEscrowed: (await treasury.totalEscrowed()).toString(),
    solvent: await treasury.escrowIsSolvent(),
    cleanState: Number((await treasury.settlements(1)).state),
    blockedState: Number((await treasury.settlements(2)).state),
    invoiceDisclosureVerified: await treasury.verifyInvoiceDisclosure(1, clean.invoiceData, clean.salt),
  };
  const passed = final.payer === U(15000).toString()
    && final.beneficiaryClean === U(15000).toString()
    && final.beneficiaryBlocked === "0"
    && final.escrow === "0"
    && final.totalEscrowed === "0"
    && final.solvent
    && final.cleanState === 4
    && final.blockedState === 5
    && final.invoiceDisclosureVerified;
  if (!passed) throw new Error(`V2 reconciliation failed: ${JSON.stringify(final)}`);

  const totalGas = transactions.reduce((sum, row) => sum + BigInt(row.gasUsed), 0n);
  const totalFee = transactions.reduce((sum, row) => sum + BigInt(row.feeWei), 0n);
  const publicInvoiceDisclosure = {
    settlementId: 1,
    invoiceDataUtf8: ethers.toUtf8String(clean.invoiceData),
    salt: ethers.hexlify(clean.salt),
    verified: final.invoiceDisclosureVerified,
    warning: "Synthetic demo invoice disclosed intentionally; no real business or personal data.",
  };
  const evidence = {
    generatedAt: new Date().toISOString(),
    network: "Base Sepolia",
    chainId: "84532",
    deployer: deployer.address,
    token: { address: token.target, symbol: "mUSD", financialValue: "none", warning: "Project-deployed demo token; not USDC or fiat-backed." },
    treasury: treasury.target,
    roles: Object.fromEntries(Object.entries(roles).map(([name, wallet]) => [name, wallet.address])),
    payerAndBeneficiariesAreDistinct: roles.payer.address !== roles.beneficiaryClean.address && roles.payer.address !== roles.beneficiaryBlocked.address,
    scenarios: {
      clean: { settlementId: 1, clearanceId: cleanClearance, intent: clean.intent },
      sanctionsRollback: { settlementId: 2, clearanceId: blockedClearance, intent: blocked.intent },
    },
    transactions,
    totals: { transactionCount: transactions.length, gasUsed: totalGas.toString(), feeWei: totalFee.toString(), observedWallClockMs: Date.now() - startedAt },
    reconciliation: { final, passed },
    publicInvoiceDisclosure,
    claimBoundary: [
      "Receipts prove public Base Sepolia execution, not production deployment or financial settlement.",
      "mUSD is a valueless project-deployed demo asset, not Circle USDC.",
      "SG-to-CN is a synthetic scenario; no fiat FX, off-ramp, KYC provider, or certified sanctions feed was used.",
      "Role wallets were ephemeral for this public proof; this is not production key management.",
      "The expected-revert receipt proves the EVM rejected release after a synthetic sanctions update.",
    ],
  };
  const out = path.join(__dirname, "..", "evidence", "base-sepolia-v2.json");
  const serialized = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(out, `${serialized}\n`);
  process.stdout.write(`${serialized}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
