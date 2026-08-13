const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ethers } = require("hardhat");

const {
  SETTLEMENT_INTENT_TYPES,
  encodeInvoiceData,
  planSettlementV2,
} = require("../src/orchestrator-v2");

const samplePath = path.join(__dirname, "..", "evidence", "sample-invoice-v2.json");

function sample() {
  return JSON.parse(fs.readFileSync(samplePath, "utf8"));
}

function hardhatSample() {
  const input = sample();
  input.planning.chainId = "31337";
  input.route.chainId = "31337";
  return input;
}

async function deployV2() {
  const [admin] = await ethers.getSigners();
  const token = await ethers.deployContract("MockStablecoin");
  const treasury = await ethers.deployContract("VerifiableTreasuryV2", [
    token.target,
    admin.address,
    ethers.parseUnits("100000", 6),
    ethers.parseUnits("10000", 6),
    3600,
  ]);
  return treasury;
}

describe("SettlementIntent orchestrator V2", function () {
  it("matches the contract's domain-separated commitment and EIP-712 digest exactly", async function () {
    const treasury = await deployV2();
    const input = hardhatSample();
    const plan = planSettlementV2(input, { chainId: 31337, verifyingContract: treasury.target });
    const intent = plan.settlementIntent;

    const contractCommitment = await treasury.computeInvoiceCommitment(
      intent.payer,
      intent.beneficiary,
      intent.amount,
      intent.corridorDigest,
      intent.clientOrderId,
      encodeInvoiceData(input.invoiceData),
      input.commitmentSalt,
    );
    expect(plan.commitment.invoiceCommitment).to.equal(contractCommitment);
    expect(await treasury.hashIntent(intent)).to.equal(plan.eip712.digest);
    expect(plan.eip712.types).to.deep.equal(SETTLEMENT_INTENT_TYPES);
    const solidityType = "SettlementIntent(address payer,address beneficiary,uint128 amount,uint48 expiresAt,uint48 quoteValidUntil,bytes32 clearanceId,bytes32 invoiceCommitment,bytes32 policyDigest,bytes32 corridorDigest,bytes32 quoteDigest,uint256 clientOrderId,uint256 nonce)";
    expect(await treasury.SETTLEMENT_INTENT_TYPEHASH()).to.equal(ethers.id(solidityType));
  });

  it("is deterministic across object-key ordering and excludes private preimages from output", async function () {
    const treasury = await deployV2();
    const input = hardhatSample();
    const reordered = { ...input, invoiceData: Object.fromEntries(Object.entries(input.invoiceData).reverse()) };
    const first = planSettlementV2(input, { chainId: 31337, verifyingContract: treasury.target });
    const second = planSettlementV2(reordered, { chainId: 31337, verifyingContract: treasury.target });
    expect(second).to.deep.equal(first);
    const publicJson = JSON.stringify(first);
    expect(publicJson).not.to.include(input.commitmentSalt);
    expect(publicJson).not.to.include(input.invoiceData.supplierEntity);
    expect(first.status).to.equal("UNSIGNED_REVIEW_REQUIRED");
    expect(first.authorityBoundary).to.deep.include({
      plannerCanAuthorize: false,
      plannerCanSign: false,
      plannerCanBroadcast: false,
      networkCallsPerformed: 0,
    });
  });

  it("does not expose an invoice-only digest that links the same invoice across salts", async function () {
    const treasury = await deployV2();
    const firstInput = hardhatSample();
    const secondInput = hardhatSample();
    secondInput.commitmentSalt = `0x${"44".repeat(32)}`;
    const first = planSettlementV2(firstInput, { chainId: 31337, verifyingContract: treasury.target });
    const second = planSettlementV2(secondInput, { chainId: 31337, verifyingContract: treasury.target });
    const unsaltedInvoiceHash = ethers.keccak256(encodeInvoiceData(firstInput.invoiceData));

    for (const [plan, input] of [[first, firstInput], [second, secondInput]]) {
      const publicJson = JSON.stringify(plan);
      expect(publicJson).not.to.include(unsaltedInvoiceHash);
      expect(publicJson).not.to.include(input.commitmentSalt);
      expect(publicJson).not.to.include(input.invoiceData.invoiceId);
      expect(plan.source).not.to.have.property("invoiceDataHash");
      expect(plan.commitment).not.to.have.property("invoiceDataHash");
      expect(plan.source.invoiceOnlyDigestIncluded).to.equal(false);
    }
    expect(first.commitment.invoiceCommitment).not.to.equal(second.commitment.invoiceCommitment);
    expect(first.settlementIntent.invoiceCommitment).not.to.equal(second.settlementIntent.invoiceCommitment);
  });

  it("rejects same-party, invalid amount, route, quote, validity, order, and authorization material", async function () {
    const treasury = await deployV2();
    const address = treasury.target;
    const cases = [
      ["SAME_PARTY", (x) => { x.settlement.beneficiary = x.settlement.payer; }],
      ["INVALID_AMOUNT", (x) => { x.settlement.amount = "0"; }],
      ["INVALID_VALIDITY", (x) => { x.settlement.expiresAt = "2026-08-12T12:30:00Z"; }],
      ["INVALID_TIMESTAMP", (x) => { x.settlement.expiresAt = "2026-08-12T17:30:00"; }],
      ["INVALID_ROUTE", (x) => { x.route.destinationCountry = "SG"; }],
      ["INVALID_QUOTE_VALIDITY", (x) => { x.quote.validUntil = "2026-08-12T18:00:00Z"; }],
      ["QUOTE_AMOUNT_MISMATCH", (x) => { x.quote.inputAmount = "14000.00"; }],
      ["QUOTE_RECONCILIATION_FAILED", (x) => { x.quote.outputAmount = "14978.00"; }],
      ["PROTOCOL_FEE_UNSUPPORTED", (x) => {
        x.quote.outputAmount = "14977.50";
        x.quote.feeAmount = "22.50";
        x.quote.feeBps = "15";
      }],
      ["INVALID_CLIENT_ORDER", (x) => { x.settlement.clientOrderId = "0"; }],
      ["ZERO_BYTES32", (x) => { x.policy.clearanceId = `0x${"00".repeat(32)}`; }],
      ["AUTHORIZATION_MATERIAL_FORBIDDEN", (x) => { x.signature = "0xdead"; }],
      ["AUTHORIZATION_MATERIAL_FORBIDDEN", (x) => { x.private_key = "0xdead"; }],
    ];
    for (const [code, mutate] of cases) {
      const input = hardhatSample();
      mutate(input);
      expect(() => planSettlementV2(input, { chainId: 31337, verifyingContract: address }))
        .to.throw().with.property("code", code);
    }
  });

  it("CLI emits the same unsigned plan without requiring a network connection", async function () {
    const treasury = await deployV2();
    const script = path.join(__dirname, "..", "scripts", "plan-settlement-v2.js");
    const output = execFileSync(process.execPath, [
      script,
      samplePath,
      "--verifying-contract",
      treasury.target,
      "--chain-id",
      "84532",
    ], { encoding: "utf8", env: {} });
    const plan = JSON.parse(output);
    expect(plan.status).to.equal("UNSIGNED_REVIEW_REQUIRED");
    expect(plan.authorityBoundary.networkCallsPerformed).to.equal(0);
    expect(plan.executionEconomics).to.deep.include({
      contractTransferAmountBaseUnits: plan.settlementIntent.amount,
      beneficiaryReceivesBaseUnits: plan.settlementIntent.amount,
      protocolFeeBaseUnits: "0",
    });
    expect(plan.eip712.digest).to.equal(
      ethers.TypedDataEncoder.hash(plan.eip712.domain, plan.eip712.types, plan.eip712.message),
    );

    const sampleDefault = JSON.parse(execFileSync(process.execPath, [script, samplePath], {
      encoding: "utf8",
      env: {},
    }));
    expect(sampleDefault.eip712.domain.verifyingContract).to.equal(sample().planning.verifyingContract);
    expect(sampleDefault.authorityBoundary.networkCallsPerformed).to.equal(0);
  });

  it("contains no signer, wallet, provider, contract call, or transaction transport primitive", function () {
    const files = [
      path.join(__dirname, "..", "src", "orchestrator-v2.js"),
      path.join(__dirname, "..", "scripts", "plan-settlement-v2.js"),
    ];
    const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
    for (const forbidden of [
      /new\s+Wallet\b/,
      /signTypedData\s*\(/,
      /sendTransaction\s*\(/,
      /broadcastTransaction\s*\(/,
      /JsonRpcProvider\s*\(/,
      /new\s+Contract\s*\(/,
      /BASE_SEPOLIA_PRIVATE_KEY/,
    ]) {
      expect(source).not.to.match(forbidden);
    }
  });
});
