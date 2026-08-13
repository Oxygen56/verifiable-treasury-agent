const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const { ethers } = hre;
const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));
const explorer = (hash) => `https://sepolia.basescan.org/tx/${hash}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const treasuryAddress = "0x7B92aB3D8BA17cF5f28C60E5c1FC326862dD6395";
const tokenAddress = "0x2254a6A25f3284faaF79522bc1162743e0c39157";

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
  const provider = deployer.provider;
  if ((await provider.getNetwork()).chainId !== 84532n) throw new Error("Wrong network");
  const recoveryPath = path.join(__dirname, "..", "evidence", "private", "base-sepolia-v2-recovery.json");
  const recovery = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
  const roles = Object.fromEntries(Object.entries(recovery.roles).map(([name, value]) => [name, new ethers.Wallet(value.privateKey, provider)]));
  const treasury = await ethers.getContractAt("VerifiableTreasuryV2", treasuryAddress);
  const token = await ethers.getContractAt("MockStablecoin", tokenAddress);
  const transactions = [];
  async function record(label, txPromise) {
    const started = Date.now();
    const tx = await txPromise;
    const receipt = await tx.wait();
    const gasPrice = receipt.gasPrice || tx.gasPrice || 0n;
    const row = { label, hash: receipt.hash, explorer: explorer(receipt.hash), blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString(), gasPriceWei: gasPrice.toString(), feeWei: (receipt.gasUsed * gasPrice).toString(), observedConfirmationLatencyMs: Date.now() - started };
    transactions.push(row);
    process.stdout.write(`${label}: ${row.explorer}\n`);
    return receipt;
  }
  async function expectedRevert(label, signer, id) {
    const data = treasury.interface.encodeFunctionData("releaseSettlement", [id]);
    const started = Date.now();
    const tx = await signer.sendTransaction({ to: treasury.target, data, gasLimit: 750000 });
    try { await tx.wait(); } catch (error) {
      const receipt = error.receipt;
      if (!receipt || receipt.status !== 0) throw error;
      const gasPrice = receipt.gasPrice || 0n;
      const row = { label, hash: receipt.hash, explorer: explorer(receipt.hash), blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString(), gasPriceWei: gasPrice.toString(), feeWei: (receipt.gasUsed * gasPrice).toString(), observedConfirmationLatencyMs: Date.now() - started, expectedRevert: true };
      transactions.push(row);
      process.stdout.write(`${label}: ${row.explorer}\n`);
      return;
    }
    throw new Error("Expected release to revert");
  }

  const first = await treasury.settlements(1);
  if (first.state !== 3n) throw new Error(`Settlement 1 expected Funded, got ${first.state}`);
  const now = (await provider.getBlock("latest")).timestamp;
  const expiresAt = now + 3600;
  const quoteValidUntil = now + 1800;
  const policyDigest = digest("SYNTHETIC-OFAC-UN-SNAPSHOT:2026-08-12T13:00Z");
  const corridorDigest = digest("SCENARIO:SG-SGD>BASE-mUSD>CN-CNY");
  const clearanceReceipt = await record("2 issue payer-bound blocked-path clearance", treasury.connect(roles.complianceA).issueClearance(roles.payer.address, roles.beneficiaryBlocked.address, policyDigest, corridorDigest, U(15000), expiresAt + 600));
  const clearanceId = clearanceReceipt.logs.map((log) => { try { return treasury.interface.parseLog(log); } catch { return null; } }).find((event) => event?.name === "ClearanceIssued").args.clearanceId;
  const invoiceData = ethers.toUtf8Bytes("SYNTHETIC|INV-8842-B|SG-CN|15000-mUSD");
  const salt = ethers.randomBytes(32);
  const clientOrderId = 8842002;
  const intent = {
    payer: roles.payer.address,
    beneficiary: roles.beneficiaryBlocked.address,
    amount: U(15000),
    expiresAt,
    quoteValidUntil,
    clearanceId,
    invoiceCommitment: await treasury.computeInvoiceCommitment(roles.payer.address, roles.beneficiaryBlocked.address, U(15000), corridorDigest, clientOrderId, invoiceData, salt),
    policyDigest,
    corridorDigest,
    quoteDigest: digest("ZERO-FEE-QUOTE:8842002:INPUT=OUTPUT"),
    clientOrderId,
    nonce: 1,
  };
  const domain = { name: "VerifiableTreasury", version: "2", chainId: 84532, verifyingContract: treasury.target };
  const signature = await roles.payer.signTypedData(domain, intentTypes, intent);
  await record("2 relayer submits payer-signed intent", treasury.connect(roles.relayer).proposeWithSignature(intent, signature));
  await record("2 distinct approval wallet 1 of 2", treasury.connect(roles.approverA).approveSettlement(2));
  await record("2 distinct approval wallet 2 of 2", treasury.connect(roles.approverB).approveSettlement(2));
  await record("2 payer funds revocable escrow", treasury.connect(roles.payer).fundSettlement(2));
  await record("2 synthetic sanctions update freezes beneficiary", treasury.connect(roles.complianceA).flagSubjectSanctioned(roles.beneficiaryBlocked.address, digest("SYNTHETIC-SANCTIONS-HIT:PUBLIC-NEGATIVE-CONTROL")));
  const second = await treasury.settlements(2);
  while ((await provider.getBlock("latest")).timestamp < Number(second.releaseAfter)) await sleep(2000);
  await expectedRevert("2 release blocked on-chain after sanctions update", roles.relayer, 2);
  await record("2 payer cancels and receives full refund", treasury.connect(roles.payer).cancelSettlement(2, digest("SANCTIONS-ROLLBACK")));
  await record("1 clean settlement releases to distinct beneficiary", treasury.connect(roles.relayer).releaseSettlement(1));

  const final = {
    payer: (await token.balanceOf(roles.payer.address)).toString(), beneficiaryClean: (await token.balanceOf(roles.beneficiaryClean.address)).toString(), beneficiaryBlocked: (await token.balanceOf(roles.beneficiaryBlocked.address)).toString(), escrow: (await token.balanceOf(treasury.target)).toString(), totalEscrowed: (await treasury.totalEscrowed()).toString(), solvent: await treasury.escrowIsSolvent(), cleanState: Number((await treasury.settlements(1)).state), blockedState: Number((await treasury.settlements(2)).state), invoiceDisclosureVerified: await treasury.verifyInvoiceDisclosure(2, invoiceData, salt),
  };
  const passed = final.payer === U(15000).toString() && final.beneficiaryClean === U(15000).toString() && final.beneficiaryBlocked === "0" && final.escrow === "0" && final.totalEscrowed === "0" && final.solvent && final.cleanState === 4 && final.blockedState === 5 && final.invoiceDisclosureVerified;
  if (!passed) throw new Error(`Reconciliation failed: ${JSON.stringify(final)}`);
  const safeIntent = Object.fromEntries(Object.entries(intent).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]));
  const historicalHashes = [
    ["deploy mUSD", "0x4b85f00682fa8a5aac651befd07b9e01408cd1330d0c2055d90b0a1572c20c77"], ["deploy V2", "0x538ac7ec618ee8646bc1932a2243741da8caaeaa28ce7cd1824766c7ae56657d"], ["grant approver A", "0x636538cdd4ed6ccbe86621d052b1dd359a7a1d28910fdfcfcbc4924a31157ef2"], ["grant approver B", "0x8bea52aaafa840c9508be9de647cf010538ecfb7eaed5fadf2c864132991ed50"], ["grant compliance A", "0x1964e475563e821a3b47f1c2e741750d6bcb0a991f4c75ec808117a2d928eaba"], ["grant compliance B", "0xaa47e6bd8502382f9b30c7daa0d67794311cb192de956118eb8858e1396cfc5e"], ["mint payer", "0x1372f270859b4f4d17c0b79bc5355844fa3b456a99d38f7496a7aa476f0ddaf9"], ["payer approve", "0xf3e2acd07516c90b94d3d5fead4dcdf5d3748b01bb46a1a5d1080a6a0f4d22ce"], ["risk payer", "0x8c0db72e54139c04812463f233e580b0961e8e33c18806d8d5863f06ab39bdc9"], ["risk clean beneficiary", "0x1811f66a256d4421f4c2f79eda1b54c5766f75942b66a0ba829398f15e6b53c5"], ["risk blocked beneficiary", "0x40223e0c9e7d02252258e2abd5c68f1a3e3970f17e7c9aba80ecfb046311301b"], ["clearance clean", "0xc7a7fbc282fdad9871fcfaddea46af0297f94adf820bcdf19aa8869086e536b3"], ["clearance blocked unused", "0x8e5a4aa209cf0cffc553d1a4b6816386eb0da5c9b7fb236a999990d6d8138bed"], ["intent clean", "0xb2634bc1911c2ae159dbd490bbe7203f796b96d7888dfe7a1fbcf1a09e279c7c"], ["approval clean A", "0x7513e17b3a791fd775ea04166a0df1e9c273c32d79be7cb52cc86650a04471a0"], ["approval clean B", "0x59845cd0e7516b9a46c94829467bca9dd0a86698b41ef5f80e7b750b088f87d7"], ["fund clean", "0x3daa6fd5ecf0fd5491b907ece3dbf7650fa72c6fbc18d0f897c4bd3c898e26da"],
  ].map(([label, hash]) => ({ label, hash, explorer: explorer(hash) }));
  const evidence = { generatedAt: new Date().toISOString(), network: "Base Sepolia", chainId: "84532", token: { address: tokenAddress, symbol: "mUSD", financialValue: "none", warning: "Project-deployed demo token; not USDC." }, treasury: treasuryAddress, roles: Object.fromEntries(Object.entries(roles).map(([name, wallet]) => [name, wallet.address])), payerAndBeneficiariesAreDistinct: true, scenarios: { clean: { settlementId: 1 }, sanctionsRollback: { settlementId: 2, clearanceId, intent: safeIntent } }, transactions: [...historicalHashes, ...transactions], reconciliation: { final, passed }, publicInvoiceDisclosure: { settlementId: 2, invoiceDataUtf8: ethers.toUtf8String(invoiceData), salt: ethers.hexlify(salt), verified: true, warning: "Synthetic demo invoice intentionally disclosed." }, claimBoundary: ["Public Base Sepolia proof only, not production or financial settlement.", "mUSD is valueless and not Circle USDC.", "SG-to-CN and sanctions inputs are synthetic scenarios; no fiat, FX, off-ramp, KYC provider, or certified screening feed.", "Ephemeral keys are test-only and not production key management."] };
  const serialized = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(path.join(__dirname, "..", "evidence", "base-sepolia-v2.json"), `${serialized}\n`);
  process.stdout.write(`${serialized}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
