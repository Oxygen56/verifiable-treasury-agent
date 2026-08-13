const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));
const abi = ethers.AbiCoder.defaultAbiCoder();

describe("VerifiableTreasuryV2", function () {
  async function deployFixture(tokenName = "MockStablecoin") {
    const [admin, operator, payer, beneficiary, approverA, approverB, compliance, relayer, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract(tokenName);
    const treasury = await ethers.deployContract("VerifiableTreasuryV2", [token.target, admin.address, U(100000), U(10000), 3600]);
    await treasury.connect(admin).grantRole(await treasury.OPERATOR_ROLE(), operator.address);
    await treasury.connect(admin).grantRole(await treasury.APPROVER_ROLE(), approverA.address);
    await treasury.connect(admin).grantRole(await treasury.APPROVER_ROLE(), approverB.address);
    await treasury.connect(admin).grantRole(await treasury.COMPLIANCE_ROLE(), compliance.address);
    await token.mint(payer.address, U(200000));
    await token.connect(payer).approve(treasury.target, ethers.MaxUint256);
    return { admin, operator, payer, beneficiary, approverA, approverB, compliance, relayer, outsider, token, treasury };
  }

  async function deployFeeTokenFixture() {
    return deployFixture("FeeOnTransferToken");
  }

  async function intentFor(ctx, options = {}) {
    const now = await time.latest();
    const policyDigest = options.policyDigest || digest("OFAC-UN-EU:2026-08-12T00:00Z");
    const invoiceData = ethers.toUtf8Bytes(options.invoice || "INV-8842|ACME-SG|SUPPLIER-CN|15000-USDC");
    const salt = options.salt || ethers.randomBytes(32);
    const corridorDigest = options.corridorDigest || digest("SGD-SG>USD-USDC>CN-CNY");
    const clientOrderId = options.clientOrderId ?? 8842;
    const amount = options.amount || U(15000);
    const expiresAt = options.expiresAt || now + 86400;
    const quoteValidUntil = options.quoteValidUntil || expiresAt - 1;
    const payerRisk = await ctx.treasury.subjectRisks(ctx.payer.address);
    if (!payerRisk.initialized) {
      await ctx.treasury.connect(ctx.compliance).attestInitialRisk(
        ctx.payer.address,
        false,
        digest("SYNTHETIC-PAYER-SCREENING-EVIDENCE:INITIAL"),
      );
    }
    const risk = await ctx.treasury.subjectRisks(ctx.beneficiary.address);
    if (!risk.initialized) {
      await ctx.treasury.connect(ctx.compliance).attestInitialRisk(
        ctx.beneficiary.address,
        false,
        digest("SYNTHETIC-SCREENING-EVIDENCE:INITIAL"),
      );
    }
    let clearanceId = options.clearanceId;
    if (!clearanceId) {
      const tx = await ctx.treasury.connect(options.clearanceIssuer || ctx.compliance).issueClearance(
        ctx.payer.address,
        ctx.beneficiary.address,
        policyDigest,
        corridorDigest,
        options.clearanceMaxAmount || amount,
        options.clearanceValidUntil || expiresAt + 3600,
      );
      const receipt = await tx.wait();
      clearanceId = receipt.logs
        .map((log) => { try { return ctx.treasury.interface.parseLog(log); } catch { return null; } })
        .find((event) => event?.name === "ClearanceIssued").args.clearanceId;
    }
    const invoiceCommitment = await ctx.treasury.computeInvoiceCommitment(
      ctx.payer.address,
      ctx.beneficiary.address,
      amount,
      corridorDigest,
      clientOrderId,
      invoiceData,
      salt,
    );
    const intent = {
      payer: ctx.payer.address,
      beneficiary: ctx.beneficiary.address,
      amount,
      expiresAt,
      quoteValidUntil,
      clearanceId,
      invoiceCommitment,
      policyDigest,
      corridorDigest,
      quoteDigest: options.quoteDigest || digest("QUOTE-20260812|FX=1.0000|FEE=0.15%|TTL=10m"),
      clientOrderId,
      nonce: options.nonce ?? 0,
    };
    const domain = { name: "VerifiableTreasury", version: "2", chainId: 31337, verifyingContract: ctx.treasury.target };
    const types = { SettlementIntent: [
      { name: "payer", type: "address" }, { name: "beneficiary", type: "address" },
      { name: "amount", type: "uint128" }, { name: "expiresAt", type: "uint48" },
      { name: "quoteValidUntil", type: "uint48" }, { name: "clearanceId", type: "bytes32" },
      { name: "invoiceCommitment", type: "bytes32" }, { name: "policyDigest", type: "bytes32" },
      { name: "corridorDigest", type: "bytes32" }, { name: "quoteDigest", type: "bytes32" },
      { name: "clientOrderId", type: "uint256" }, { name: "nonce", type: "uint256" },
    ] };
    const signature = await ctx.payer.signTypedData(domain, types, intent);
    return { intent, signature, invoiceData, salt, domain, types };
  }

  async function propose(ctx, options = {}) {
    const signed = await intentFor(ctx, options);
    const id = await ctx.treasury.nextSettlementId();
    await ctx.treasury.connect(ctx.relayer).proposeWithSignature(signed.intent, signed.signature);
    return { id, ...signed };
  }

  it("relays a payer-signed, corridor- and quote-bound intent without giving AI authority", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    const settlement = await ctx.treasury.settlements(p.id);
    expect(settlement.payer).to.equal(ctx.payer.address);
    expect(settlement.beneficiary).to.equal(ctx.beneficiary.address);
    expect(settlement.corridorDigest).to.equal(p.intent.corridorDigest);
    expect(await ctx.treasury.payerNonces(ctx.payer.address)).to.equal(1);
    expect(await ctx.treasury.verifyInvoiceDisclosure(p.id, p.invoiceData, p.salt)).to.equal(true);
  });

  it("rejects AI or relayer attempts to tamper with the signed beneficiary, amount, route or quote", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await intentFor(ctx);
    for (const patch of [
      { beneficiary: ctx.outsider.address }, { amount: U(1) },
      { corridorDigest: digest("OTHER-CORRIDOR") }, { quoteDigest: digest("WORSE-QUOTE") },
    ]) {
      await expect(ctx.treasury.connect(ctx.relayer).proposeWithSignature({ ...p.intent, ...patch }, p.signature))
        .to.be.revertedWithCustomError(ctx.treasury, "InvalidSignature");
    }
  });

  it("prevents replay, duplicate client orders and duplicate invoice payments", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    await expect(ctx.treasury.proposeWithSignature(p.intent, p.signature)).to.be.revertedWithCustomError(ctx.treasury, "InvalidNonce");

    const second = await intentFor(ctx, { nonce: 1, invoice: "INV-SECOND", clientOrderId: p.intent.clientOrderId });
    await expect(ctx.treasury.proposeWithSignature(second.intent, second.signature)).to.be.revertedWithCustomError(ctx.treasury, "DuplicateClientOrder");

    const thirdIntent = { ...p.intent, clientOrderId: 8843, nonce: 1 };
    const thirdSig = await ctx.payer.signTypedData(p.domain, p.types, thirdIntent);
    await expect(ctx.treasury.proposeWithSignature(thirdIntent, thirdSig)).to.be.revertedWithCustomError(ctx.treasury, "DuplicateInvoiceCommitment");
  });

  it("lets a payer invalidate leaked signed intents with a strictly monotonic nonce", async function () {
    const ctx = await loadFixture(deployFixture);
    const leaked = await intentFor(ctx);
    await ctx.treasury.connect(ctx.payer).invalidateNoncesUpTo(7);
    await expect(ctx.treasury.proposeWithSignature(leaked.intent, leaked.signature))
      .to.be.revertedWithCustomError(ctx.treasury, "InvalidNonce");
    await expect(ctx.treasury.connect(ctx.payer).invalidateNoncesUpTo(7))
      .to.be.revertedWithCustomError(ctx.treasury, "InvalidNonce");
    expect(await ctx.treasury.payerNonces(ctx.payer.address)).to.equal(7);
  });

  it("enforces independent high-value approval and rejects payer/operator/compliance conflicts", async function () {
    const ctx = await loadFixture(deployFixture);
    await propose(ctx);
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.APPROVER_ROLE(), ctx.payer.address);
    await expect(ctx.treasury.connect(ctx.payer).approveSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "ConflictOfInterest");
    for (const actor of [ctx.admin, ctx.operator, ctx.compliance]) {
      await expect(ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.APPROVER_ROLE(), actor.address))
        .to.be.revertedWithCustomError(ctx.treasury, "RoleOverlap");
    }
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await expect(ctx.treasury.connect(ctx.approverA).approveSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "AlreadyApproved");
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    expect((await ctx.treasury.settlements(1)).state).to.equal(2);
  });

  it("starts the challenge window at funding, not proposal, and releases to a distinct beneficiary", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await time.increase(7200);
    const fundedAt = await time.latest();
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    const funded = await ctx.treasury.settlements(1);
    expect(funded.releaseAfter).to.be.gte(fundedAt + 3600);
    await expect(ctx.treasury.releaseSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "ReleaseNotReady");
    await time.increaseTo(funded.releaseAfter);
    await ctx.treasury.connect(ctx.relayer).releaseSettlement(1);
    expect(await ctx.token.balanceOf(ctx.beneficiary.address)).to.equal(U(15000));
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
    expect(await ctx.treasury.totalEscrowed()).to.equal(0);
    expect(await ctx.treasury.escrowIsSolvent()).to.equal(true);
  });

  it("blocks release after a sanctions change and preserves revocable escrow", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    const funded = await ctx.treasury.settlements(1);
    await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(
      ctx.beneficiary.address,
      digest("SYNTHETIC-SCREENING-EVIDENCE:SANCTIONS-HIT"),
    );
    await time.increaseTo(funded.releaseAfter);
    await expect(ctx.treasury.releaseSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "BeneficiarySanctioned");
    expect((await ctx.treasury.settlements(1)).state).to.equal(3);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(U(15000));
    await ctx.treasury.connect(ctx.payer).cancelSettlement(1, digest("SANCTIONS-CHANGE"));
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(U(200000));
  });

  it("reverts daily-limit failures atomically", async function () {
    const ctx = await loadFixture(deployFixture);
    await propose(ctx, { amount: U(100001) });
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "DailyLimitExceeded");
    expect((await ctx.treasury.settlements(1)).state).to.equal(2);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
  });

  it("rejects fee-on-transfer assets so the ledger never promises more than escrow received", async function () {
    const ctx = await loadFixture(deployFeeTokenFixture);
    await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "DeflationaryAssetUnsupported");
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
  });

  it("rolls expired escrow back permissionlessly and reconciles exactly", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    await time.increaseTo(p.intent.expiresAt);
    await ctx.treasury.connect(ctx.outsider).rollbackExpired(1);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(U(200000));
    expect((await ctx.treasury.settlements(1)).state).to.equal(5);
  });

  it("invalidates credentials issued by a compliance identity after that identity is revoked", async function () {
    const ctx = await loadFixture(deployFixture);
    await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await ctx.treasury.connect(ctx.admin).revokeRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.compliance.address);
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.compliance.address);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(1))
      .to.be.revertedWithCustomError(ctx.treasury, "ClearanceVersionChanged");
    await ctx.treasury.connect(ctx.payer).cancelSettlement(1, digest("ISSUER-REVOKED"));
    expect((await ctx.treasury.settlements(1)).state).to.equal(5);
  });

  it("blocks a sanctioned payer at release and preserves a full refund path", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(p.id);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(p.id);
    await ctx.treasury.connect(ctx.payer).fundSettlement(p.id);
    const funded = await ctx.treasury.settlements(p.id);
    await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(
      ctx.payer.address,
      digest("SYNTHETIC-PAYER-SANCTIONS-HIT"),
    );
    await time.increaseTo(funded.releaseAfter);
    await expect(ctx.treasury.releaseSettlement(p.id))
      .to.be.revertedWithCustomError(ctx.treasury, "PayerSanctioned");
    await ctx.treasury.connect(ctx.payer).cancelSettlement(p.id, digest("PAYER-RISK-ROLLBACK"));
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(U(200000));
    expect(await ctx.treasury.totalEscrowed()).to.equal(0);
  });

  it("does not revive an old approval after revoke and re-grant, then supports a fresh round", async function () {
    const ctx = await loadFixture(deployFixture);
    await propose(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await ctx.treasury.connect(ctx.admin).revokeRole(await ctx.treasury.APPROVER_ROLE(), ctx.approverB.address);
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.APPROVER_ROLE(), ctx.approverB.address);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(1))
      .to.be.revertedWithCustomError(ctx.treasury, "ApprovalNoLongerValid");
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.APPROVER_ROLE(), ctx.outsider.address);
    await ctx.treasury.connect(ctx.payer).resetSettlementApprovals(1);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.outsider).approveSettlement(1);
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    expect(await ctx.treasury.totalEscrowed()).to.equal(U(15000));
  });

  it("requires two distinct compliance identities to clear a sanctions flag", async function () {
    const ctx = await loadFixture(deployFixture);
    await ctx.treasury.connect(ctx.compliance).attestInitialRisk(ctx.outsider.address, false, digest("INITIAL"));
    await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(ctx.outsider.address, digest("HIT"));
    await ctx.treasury.connect(ctx.compliance).proposeSubjectRiskClear(ctx.outsider.address, digest("FALSE-POSITIVE-REVIEW"));
    await expect(ctx.treasury.connect(ctx.compliance).confirmSubjectRiskClear(ctx.outsider.address, digest("FALSE-POSITIVE-REVIEW")))
      .to.be.revertedWithCustomError(ctx.treasury, "RiskClearanceRequiresTwoPeople");
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.relayer.address);
    await ctx.treasury.connect(ctx.relayer).confirmSubjectRiskClear(ctx.outsider.address, digest("FALSE-POSITIVE-REVIEW"));
    const risk = await ctx.treasury.subjectRisks(ctx.outsider.address);
    expect(risk.sanctioned).to.equal(false);
    expect(risk.epoch).to.equal(3);
  });

  it("rejects a stale first compliance vote after revoke/re-grant and rejects beneficiary self-clear", async function () {
    const ctx = await loadFixture(deployFixture);
    await ctx.treasury.connect(ctx.compliance).attestInitialRisk(ctx.outsider.address, false, digest("INITIAL"));
    await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(ctx.outsider.address, digest("HIT"));
    await ctx.treasury.connect(ctx.compliance).proposeSubjectRiskClear(ctx.outsider.address, digest("REVIEW"));
    await ctx.treasury.connect(ctx.admin).revokeRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.compliance.address);
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.compliance.address);
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.relayer.address);
    await expect(ctx.treasury.connect(ctx.relayer).confirmSubjectRiskClear(ctx.outsider.address, digest("REVIEW")))
      .to.be.revertedWithCustomError(ctx.treasury, "RiskClearanceRequiresTwoPeople");

    await ctx.treasury.connect(ctx.compliance).proposeSubjectRiskClear(ctx.outsider.address, digest("REVIEW-2"));
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.outsider.address);
    await expect(ctx.treasury.connect(ctx.outsider).confirmSubjectRiskClear(ctx.outsider.address, digest("REVIEW-2")))
      .to.be.revertedWithCustomError(ctx.treasury, "RiskClearanceRequiresTwoPeople");
  });

  it("invalidates a pending clear vote when new screening evidence is re-attested", async function () {
    const ctx = await loadFixture(deployFixture);
    await ctx.treasury.connect(ctx.compliance).attestInitialRisk(ctx.outsider.address, false, digest("INITIAL"));
    await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(ctx.outsider.address, digest("HIT-1"));
    await ctx.treasury.connect(ctx.compliance).proposeSubjectRiskClear(ctx.outsider.address, digest("REVIEW-1"));
    await ctx.treasury.connect(ctx.compliance).reattestSubjectRisk(ctx.outsider.address, digest("HIT-2"));
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.relayer.address);
    await expect(ctx.treasury.connect(ctx.relayer).confirmSubjectRiskClear(ctx.outsider.address, digest("REVIEW-1")))
      .to.be.revertedWithCustomError(ctx.treasury, "RiskClearanceRequiresTwoPeople");
  });

  it("fails closed when a clean risk attestation becomes stale and recovers after re-attestation", async function () {
    const ctx = await loadFixture(deployFixture);
    const now = await time.latest();
    const plan = await propose(ctx, { expiresAt: now + 8 * 24 * 60 * 60, quoteValidUntil: now + 8 * 24 * 60 * 60 - 1 });
    await ctx.treasury.connect(ctx.approverA).approveSettlement(plan.id);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(plan.id);
    await time.increase(7 * 24 * 60 * 60 + 1);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(plan.id))
      .to.be.revertedWithCustomError(ctx.treasury, "ClearanceVersionChanged");
    await ctx.treasury.connect(ctx.compliance).reattestSubjectRisk(ctx.payer.address, digest("PAYER-REFRESH"));
    await ctx.treasury.connect(ctx.compliance).reattestSubjectRisk(ctx.beneficiary.address, digest("BENEFICIARY-REFRESH"));
    await ctx.treasury.connect(ctx.payer).fundSettlement(plan.id);
    expect(await ctx.treasury.totalEscrowed()).to.equal(U(15000));
  });

  it("supports precise clearance revocation and invalidates old payer-risk credentials after a sanctions cycle", async function () {
    const ctx = await loadFixture(deployFixture);
    const first = await intentFor(ctx);
    await ctx.treasury.connect(ctx.compliance).revokeClearance(first.intent.clearanceId);
    await expect(ctx.treasury.proposeWithSignature(first.intent, first.signature))
      .to.be.revertedWithCustomError(ctx.treasury, "ClearanceVersionChanged");

    const second = await intentFor(ctx, { nonce: 0, clientOrderId: 8843, invoice: "PAYER-RISK-CYCLE" });
    await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(ctx.payer.address, digest("PAYER-HIT"));
    await ctx.treasury.connect(ctx.compliance).proposeSubjectRiskClear(ctx.payer.address, digest("PAYER-CLEARED"));
    await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.relayer.address);
    await ctx.treasury.connect(ctx.relayer).confirmSubjectRiskClear(ctx.payer.address, digest("PAYER-CLEARED"));
    await expect(ctx.treasury.proposeWithSignature(second.intent, second.signature))
      .to.be.revertedWithCustomError(ctx.treasury, "ClearanceVersionChanged");
  });

  it("enforces route, amount and quote expiry from the signed clearance and quote", async function () {
    const ctx = await loadFixture(deployFixture);
    const now = await time.latest();
    const p = await intentFor(ctx, { expiresAt: now + 86400, quoteValidUntil: now + 60 });
    const wrongRoute = { ...p.intent, corridorDigest: digest("UNSCREENED-ROUTE") };
    const wrongRouteSig = await ctx.payer.signTypedData(p.domain, p.types, wrongRoute);
    await expect(ctx.treasury.proposeWithSignature(wrongRoute, wrongRouteSig))
      .to.be.revertedWithCustomError(ctx.treasury, "ClearanceInvalid");

    await ctx.treasury.proposeWithSignature(p.intent, p.signature);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    await time.increaseTo(p.intent.quoteValidUntil);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(1))
      .to.be.revertedWithCustomError(ctx.treasury, "QuoteExpired");
  });

  it("scopes invoice replay protection by payer so copied mempool commitments cannot block the victim", async function () {
    const ctx = await loadFixture(deployFixture);
    const victim = await intentFor(ctx);
    await ctx.treasury.connect(ctx.compliance).attestInitialRisk(
      ctx.relayer.address,
      false,
      digest("SYNTHETIC-ATTACKER-PAYER-SCREENING:INITIAL"),
    );
    const now = await time.latest();
    const attackerClearanceTx = await ctx.treasury.connect(ctx.compliance).issueClearance(
      ctx.relayer.address,
      ctx.beneficiary.address,
      victim.intent.policyDigest,
      victim.intent.corridorDigest,
      victim.intent.amount,
      now + 90000,
    );
    const attackerClearanceReceipt = await attackerClearanceTx.wait();
    const attackerClearanceId = attackerClearanceReceipt.logs
      .map((log) => { try { return ctx.treasury.interface.parseLog(log); } catch { return null; } })
      .find((event) => event?.name === "ClearanceIssued").args.clearanceId;
    const attackerIntent = {
      ...victim.intent,
      payer: ctx.relayer.address,
      clearanceId: attackerClearanceId,
    };
    const attackerSig = await ctx.relayer.signTypedData(victim.domain, victim.types, attackerIntent);
    await ctx.treasury.connect(ctx.outsider).proposeWithSignature(attackerIntent, attackerSig);
    await ctx.treasury.connect(ctx.outsider).proposeWithSignature(victim.intent, victim.signature);
    expect(await ctx.treasury.nextSettlementId()).to.equal(3);
  });

  it("binds disclosure to the chain, contract, parties, amount, route, and client order", async function () {
    const ctx = await loadFixture(deployFixture);
    const p = await propose(ctx);
    expect(await ctx.treasury.verifyInvoiceDisclosure(1, p.invoiceData, p.salt)).to.equal(true);
    expect(await ctx.treasury.verifyInvoiceDisclosure(1, p.invoiceData, ethers.randomBytes(32))).to.equal(false);
    const other = await ethers.deployContract("VerifiableTreasuryV2", [ctx.token.target, ctx.admin.address, U(100000), U(10000), 3600]);
    const crossContractCommitment = await other.computeInvoiceCommitment(
      p.intent.payer,
      p.intent.beneficiary,
      p.intent.amount,
      p.intent.corridorDigest,
      p.intent.clientOrderId,
      p.invoiceData,
      p.salt,
    );
    expect(crossContractCommitment).not.to.equal(p.intent.invoiceCommitment);
    const mutations = [
      [ctx.outsider.address, p.intent.beneficiary, p.intent.amount, p.intent.corridorDigest, p.intent.clientOrderId],
      [p.intent.payer, ctx.outsider.address, p.intent.amount, p.intent.corridorDigest, p.intent.clientOrderId],
      [p.intent.payer, p.intent.beneficiary, U(1), p.intent.corridorDigest, p.intent.clientOrderId],
      [p.intent.payer, p.intent.beneficiary, p.intent.amount, digest("OTHER-ROUTE"), p.intent.clientOrderId],
      [p.intent.payer, p.intent.beneficiary, p.intent.amount, p.intent.corridorDigest, 999999],
    ];
    for (const [payer, beneficiary, amount, route, order] of mutations) {
      expect(await ctx.treasury.computeInvoiceCommitment(payer, beneficiary, amount, route, order, p.invoiceData, p.salt))
        .not.to.equal(p.intent.invoiceCommitment);
    }
  });

  it("reconciles three concurrently funded settlements across release, payer cancel, and expiry rollback", async function () {
    const ctx = await loadFixture(deployFixture);
    const plans = [];
    for (let index = 0; index < 3; index += 1) {
      const plan = await propose(ctx, {
        amount: U(11000 + index),
        nonce: index,
        clientOrderId: 9001 + index,
        invoice: `CONCURRENT-INVOICE-${index}`,
      });
      await ctx.treasury.connect(ctx.approverA).approveSettlement(plan.id);
      await ctx.treasury.connect(ctx.approverB).approveSettlement(plan.id);
      await ctx.treasury.connect(ctx.payer).fundSettlement(plan.id);
      plans.push(plan);
    }
    expect(await ctx.treasury.totalEscrowed()).to.equal(U(33003));
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(U(33003));

    const first = await ctx.treasury.settlements(plans[0].id);
    await time.increaseTo(first.releaseAfter);
    await ctx.treasury.releaseSettlement(plans[0].id);
    await expect(ctx.treasury.releaseSettlement(plans[0].id))
      .to.be.revertedWithCustomError(ctx.treasury, "InvalidState");
    await ctx.treasury.connect(ctx.payer).cancelSettlement(plans[1].id, digest("CONCURRENT-PAYER-CANCEL"));
    await time.increaseTo(plans[2].intent.expiresAt);
    await ctx.treasury.connect(ctx.outsider).rollbackExpired(plans[2].id);

    expect(await ctx.treasury.totalEscrowed()).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.beneficiary.address)).to.equal(U(11000));
    expect(await ctx.treasury.escrowIsSolvent()).to.equal(true);
  });

  it("enforces cumulative lifetime allowance on a reusable payer-bound clearance", async function () {
    const ctx = await loadFixture(deployFixture);
    const first = await propose(ctx, { amount: U(15000), clearanceMaxAmount: U(20000) });
    await ctx.treasury.connect(ctx.approverA).approveSettlement(first.id);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(first.id);
    await ctx.treasury.connect(ctx.payer).fundSettlement(first.id);

    const second = await propose(ctx, {
      amount: U(10000),
      clearanceId: first.intent.clearanceId,
      nonce: 1,
      clientOrderId: 8843,
      invoice: "ALLOWANCE-INVOICE-2",
    });
    await ctx.treasury.connect(ctx.approverA).approveSettlement(second.id);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(second.id);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(second.id))
      .to.be.revertedWithCustomError(ctx.treasury, "ClearanceInvalid");

    await ctx.treasury.connect(ctx.payer).cancelSettlement(first.id, digest("FREE-UNSETTLED-ALLOWANCE"));
    await ctx.treasury.connect(ctx.payer).fundSettlement(second.id);
    const clearance = await ctx.treasury.clearances(first.intent.clearanceId);
    expect(clearance.consumedAmount).to.equal(U(10000));
  });
});
