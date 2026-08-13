const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");

describe("browser live verifier", function () {
  let verifier;
  let evidence;

  before(async function () {
    verifier = await import("../demo/live-verifier.mjs");
    evidence = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evidence", "base-sepolia-v2.json"), "utf8"));
  });

  function word(value) {
    return BigInt(value).toString(16).padStart(64, "0");
  }

  function settlement(state) {
    return `0x${Array.from({ length: 22 }, (_, index) => word(index === 14 ? state : 0)).join("")}`;
  }

  function rpcFixture({ wrongReceipt = false } = {}) {
    const receiptByHash = new Map(evidence.transactions.map((row, index) => [row.hash.toLowerCase(), {
      transactionHash: row.hash,
      status: wrongReceipt && index === 0 ? "0x0" : (verifier.expectedReceiptStatus(row) === 0n ? "0x0" : "0x1"),
      blockNumber: `0x${(45_000_000 + index).toString(16)}`,
    }]));
    return async (method, params) => {
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_getTransactionReceipt") return receiptByHash.get(params[0].toLowerCase());
      if (method === "eth_getCode") return "0x60016000";
      if (method === "eth_blockNumber") return "0x2aea5ff";
      if (method === "eth_call") {
        const [{ to, data }] = params;
        if (to.toLowerCase() === evidence.treasury.toLowerCase()) {
          if (data.startsWith("0x08df7dc8")) return settlement(BigInt(data) === BigInt(`0x08df7dc8${word(1)}`) ? 4 : 5);
          if (data === "0xf9168231") return `0x${word(0)}`;
          if (data === "0x67d4cf15") return `0x${word(1)}`;
        }
        const address = `0x${data.slice(-40)}`.toLowerCase();
        const final = evidence.reconciliation.final;
        const balances = new Map([
          [evidence.roles.payer.toLowerCase(), final.payer],
          [evidence.roles.beneficiaryClean.toLowerCase(), final.beneficiaryClean],
          [evidence.roles.beneficiaryBlocked.toLowerCase(), final.beneficiaryBlocked],
          [evidence.treasury.toLowerCase(), final.escrow],
        ]);
        return `0x${word(balances.get(address))}`;
      }
      throw new Error(`Unexpected RPC method ${method}`);
    };
  }

  it("verifies the closed receipt transcript and reconciled final state", async function () {
    const result = await verifier.verifyLiveEvidence(evidence, { rpc: rpcFixture() });
    expect(result.receiptCount).to.equal(26);
    expect(result.successful).to.equal(25);
    expect(result.failed).to.equal(1);
    expect(result.cleanState).to.equal(4n);
    expect(result.blockedState).to.equal(5n);
    expect(result.totalEscrowed).to.equal(0n);
    expect(result.solvent).to.equal(true);
  });

  it("fails closed when any receipt status changes", async function () {
    await expect(verifier.verifyLiveEvidence(evidence, { rpc: rpcFixture({ wrongReceipt: true }) }))
      .to.be.rejectedWith("Unexpected status for deploy mUSD");
  });

  it("encodes and decodes raw read-only contract calls", function () {
    expect(verifier.encodeUintCall("08df7dc8", 2n)).to.equal(`0x08df7dc8${word(2)}`);
    expect(verifier.encodeAddressCall("70a08231", evidence.roles.payer)).to.have.length(74);
    expect(verifier.decodeWord(`0x${word(7)}`)).to.equal(7n);
  });
});
