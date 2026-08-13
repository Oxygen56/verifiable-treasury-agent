const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const U = (value) => ethers.parseUnits(String(value), 6);
const digest = (value) => ethers.keccak256(ethers.toUtf8Bytes(value));

function prng(seed) {
  let state = BigInt(seed);
  return () => {
    state = (state * 1103515245n + 12345n) & 0x7fffffffn;
    return Number(state);
  };
}

describe("VerifiableTreasuryV2 stateful invariants", function () {
  this.timeout(120000);
  async function deployFixture() {
    const [admin, payer, beneficiary, approverA, approverB, compliance, relayer] = await ethers.getSigners();
    const token = await ethers.deployContract("MockStablecoin");
    const treasury = await ethers.deployContract("VerifiableTreasuryV2", [token.target, admin.address, U(10000000), U(10), 5]);
    await treasury.grantRole(await treasury.APPROVER_ROLE(), approverA.address);
    await treasury.grantRole(await treasury.APPROVER_ROLE(), approverB.address);
    await treasury.grantRole(await treasury.COMPLIANCE_ROLE(), compliance.address);
    await token.mint(payer.address, U(1000000));
    await token.connect(payer).approve(treasury.target, ethers.MaxUint256);
    return { admin, payer, beneficiary, approverA, approverB, compliance, relayer, token, treasury };
  }

  it("preserves solvency, exact conservation, single terminal outcome, and nonce monotonicity across 64 generated paths", async function () {
    const ctx = await loadFixture(deployFixture);
    const next = prng(0x56c0de);
    const initialPayerBalance = await ctx.token.balanceOf(ctx.payer.address);
    let releasedTotal = 0n;
    let nextId = 1;

    for (let sequence = 0; sequence < 64; sequence += 1) {
      const now = await time.latest();
      const amount = U(11 + (next() % 90));
      const expiresAt = now + 60;
      const clientOrderId = 100000 + sequence;
      const corridorDigest = digest(`SG-CN:${sequence % 3}`);
      const policyDigest = digest(`PUBLIC-SCREENING-SNAPSHOT:${sequence}`);
      const invoiceData = ethers.toUtf8Bytes(`SYNTHETIC-INVOICE-${sequence}`);
      const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(next()) + 1n), 32);
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
        invoiceCommitment,
        policyDigest,
        corridorDigest,
        quoteDigest: digest(`SYNTHETIC-QUOTE-${sequence}`),
        clientOrderId,
        nonce: sequence,
      };
      const payerRisk = await ctx.treasury.subjectRisks(ctx.payer.address);
      if (!payerRisk.initialized) {
        await ctx.treasury.connect(ctx.compliance).attestInitialRisk(
          ctx.payer.address,
          false,
          digest("SYNTHETIC-PAYER-RISK:INITIAL"),
        );
      }
      const beneficiaryRisk = await ctx.treasury.subjectRisks(ctx.beneficiary.address);
      if (!beneficiaryRisk.initialized) {
        await ctx.treasury.connect(ctx.compliance).attestInitialRisk(
          ctx.beneficiary.address,
          false,
          digest("SYNTHETIC-BENEFICIARY-RISK:INITIAL"),
        );
      }
      const clearanceTx = await ctx.treasury.connect(ctx.compliance).issueClearance(
        ctx.payer.address,
        ctx.beneficiary.address,
        policyDigest,
        corridorDigest,
        amount,
        expiresAt + 60,
      );
      const clearanceReceipt = await clearanceTx.wait();
      const clearanceId = clearanceReceipt.logs
        .map((log) => { try { return ctx.treasury.interface.parseLog(log); } catch { return null; } })
        .find((event) => event?.name === "ClearanceIssued").args.clearanceId;
      intent.quoteValidUntil = expiresAt - 1;
      intent.clearanceId = clearanceId;
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
      await ctx.treasury.connect(ctx.relayer).proposeWithSignature(intent, signature);
      await ctx.treasury.connect(ctx.approverA).approveSettlement(nextId);
      await ctx.treasury.connect(ctx.approverB).approveSettlement(nextId);
      await ctx.treasury.connect(ctx.payer).fundSettlement(nextId);

      const action = next() % 4;
      if (action === 0) {
        await ctx.treasury.connect(ctx.payer).cancelSettlement(nextId, digest(`PAYER-CANCEL-${sequence}`));
      } else if (action === 1) {
        await ctx.treasury.connect(ctx.compliance).flagSubjectSanctioned(
          ctx.beneficiary.address,
          digest(`SYNTHETIC-SANCTIONS-HIT-${sequence}`),
        );
        await ctx.treasury.connect(ctx.payer).cancelSettlement(nextId, digest(`SANCTIONS-ROLLBACK-${sequence}`));
        await ctx.treasury.connect(ctx.compliance).proposeSubjectRiskClear(
          ctx.beneficiary.address,
          digest(`SYNTHETIC-FALSE-POSITIVE-${sequence}`),
        );
        await ctx.treasury.connect(ctx.admin).grantRole(await ctx.treasury.COMPLIANCE_ROLE(), ctx.relayer.address);
        await ctx.treasury.connect(ctx.relayer).confirmSubjectRiskClear(
          ctx.beneficiary.address,
          digest(`SYNTHETIC-FALSE-POSITIVE-${sequence}`),
        );
      } else if (action === 2) {
        await time.increaseTo(expiresAt);
        await ctx.treasury.connect(ctx.relayer).rollbackExpired(nextId);
      } else {
        const funded = await ctx.treasury.settlements(nextId);
        await time.increaseTo(funded.releaseAfter);
        await ctx.treasury.connect(ctx.relayer).releaseSettlement(nextId);
        releasedTotal += amount;
      }

      const settlement = await ctx.treasury.settlements(nextId);
      expect([4n, 5n]).to.include(settlement.state);
      expect(await ctx.treasury.escrowIsSolvent()).to.equal(true);
      expect(await ctx.token.balanceOf(ctx.treasury.target)).to.equal(await ctx.treasury.totalEscrowed());
      expect(await ctx.treasury.payerNonces(ctx.payer.address)).to.equal(sequence + 1);
      nextId += 1;
    }

    expect(await ctx.treasury.totalEscrowed()).to.equal(0);
    expect(await ctx.token.balanceOf(ctx.beneficiary.address)).to.equal(releasedTotal);
    expect(await ctx.token.balanceOf(ctx.payer.address)).to.equal(initialPayerBalance - releasedTotal);
  });
});
