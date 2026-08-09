const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

describe("VerifiableTreasury", function () {
  async function deployFixture() {
    const [admin, payer, beneficiary, approverA, approverB, compliance, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract("MockStablecoin");
    const treasury = await ethers.deployContract("VerifiableTreasury", [
      token.target, admin.address, U(100000), U(10000), 3600,
    ]);
    await treasury.grantRole(await treasury.APPROVER_ROLE(), approverA.address);
    await treasury.grantRole(await treasury.APPROVER_ROLE(), approverB.address);
    await treasury.grantRole(await treasury.COMPLIANCE_ROLE(), compliance.address);
    await token.mint(payer.address, U(200000));
    await token.connect(payer).approve(treasury.target, ethers.MaxUint256);
    return { admin, payer, beneficiary, approverA, approverB, compliance, outsider, token, treasury };
  }

  async function prepare(ctx, amount = U(5000), options = {}) {
    const now = await time.latest();
    const releaseAfter = now + 3700;
    const expiresAt = now + 86400;
    const policy = options.policy || digest("OFAC-UN-EU-snapshot:2026-08-10");
    const invoiceData = ethers.toUtf8Bytes("invoice-42|SG-CN|5000-USDC");
    const salt = digest("demo-salt-not-a-production-secret");
    const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes32"], [invoiceData, salt]));
    await ctx.treasury.connect(ctx.compliance).recordClearance(ctx.beneficiary.address, policy, expiresAt + 3600, false);
    await ctx.treasury.proposeSettlement(ctx.payer.address, ctx.beneficiary.address, amount, releaseAfter, expiresAt, commitment, policy);
    return { id: 1, releaseAfter, expiresAt, policy, invoiceData, salt, commitment };
  }

  it("executes a low-value settlement and verifies selective disclosure", async function () {
    const ctx = await deployFixture();
    const p = await prepare(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(p.id);
    await ctx.treasury.connect(ctx.payer).fundSettlement(p.id);
    expect((await ctx.treasury.settlements(p.id)).state).to.equal(3);
    await time.increaseTo(p.releaseAfter);
    await ctx.treasury.connect(ctx.outsider).releaseSettlement(p.id);
    expect(await ctx.token.balanceOf(ctx.beneficiary.address)).to.equal(U(5000));
    expect((await ctx.treasury.settlements(p.id)).state).to.equal(4);
    expect(await ctx.treasury.verifyInvoiceDisclosure(p.id, p.invoiceData, p.salt)).to.equal(true);
    expect(await ctx.treasury.verifyInvoiceDisclosure(p.id, ethers.toUtf8Bytes("tampered"), p.salt)).to.equal(false);
  });

  it("requires two distinct approvals above the high-value threshold", async function () {
    const ctx = await deployFixture();
    await prepare(ctx, U(25000));
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    expect((await ctx.treasury.settlements(1)).state).to.equal(1);
    await expect(ctx.treasury.connect(ctx.approverA).approveSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "AlreadyApproved");
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    expect((await ctx.treasury.settlements(1)).state).to.equal(2);
  });

  it("blocks sanctioned beneficiaries without mutating settlement state", async function () {
    const ctx = await deployFixture();
    const p = await prepare(ctx);
    await ctx.treasury.connect(ctx.compliance).recordClearance(ctx.beneficiary.address, p.policy, p.expiresAt + 3600, true);
    await expect(ctx.treasury.connect(ctx.approverA).approveSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "BeneficiarySanctioned");
    const settlement = await ctx.treasury.settlements(1);
    expect(settlement.state).to.equal(1);
    expect(settlement.approvals).to.equal(0);
  });

  it("cancels a funded settlement and refunds the payer before release", async function () {
    const ctx = await deployFixture();
    await prepare(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    const before = await ctx.token.balanceOf(ctx.payer.address);
    await ctx.treasury.connect(ctx.payer).cancelSettlement(1, digest("supplier-bank-details-changed"));
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(before + U(5000));
    expect((await ctx.treasury.settlements(1)).state).to.equal(5);
    await expect(ctx.treasury.releaseSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "InvalidState");
  });

  it("rolls an expired funded settlement back and reconciles balances", async function () {
    const ctx = await deployFixture();
    const p = await prepare(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    await time.increaseTo(p.expiresAt);
    await ctx.treasury.connect(ctx.outsider).rollbackExpired(1);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(U(200000));
  });

  it("reverts atomically when the daily limit would be exceeded", async function () {
    const ctx = await deployFixture();
    await prepare(ctx, U(100001));
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.approverB).approveSettlement(1);
    const payerBefore = await ctx.token.balanceOf(ctx.payer.address);
    await expect(ctx.treasury.connect(ctx.payer).fundSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "DailyLimitExceeded");
    expect((await ctx.treasury.settlements(1)).state).to.equal(2);
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(payerBefore);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(0);
  });

  it("invalidates release when compliance changes the attested policy digest", async function () {
    const ctx = await deployFixture();
    const p = await prepare(ctx);
    await ctx.treasury.connect(ctx.approverA).approveSettlement(1);
    await ctx.treasury.connect(ctx.payer).fundSettlement(1);
    await ctx.treasury.connect(ctx.compliance).recordClearance(ctx.beneficiary.address, digest("new-policy-snapshot"), p.expiresAt + 3600, false);
    await time.increaseTo(p.releaseAfter);
    await expect(ctx.treasury.releaseSettlement(1)).to.be.revertedWithCustomError(ctx.treasury, "ClearanceInvalid");
    expect((await ctx.treasury.settlements(1)).state).to.equal(3);
    expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(U(5000));
  });
});
