const fs = require("node:fs");
const path = require("node:path");
const {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  id,
  toQuantity,
} = require("ethers");

const evidencePath = path.join(__dirname, "..", "evidence", "base-sepolia-v2.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const archiveRpc = process.env.BASE_SEPOLIA_ARCHIVE_RPC_URL || "https://sepolia.base.org";
const provider = makeProvider(rpc);
const archiveProvider = rpc === archiveRpc ? provider : makeProvider(archiveRpc);

const treasuryAbi = [
  "function stablecoin() view returns (address)",
  "function nextSettlementId() view returns (uint256)",
  "function payerNonces(address) view returns (uint256)",
  "function settlements(uint256) view returns (address payer,address beneficiary,uint128 amount,uint48 createdAt,uint48 fundedAt,uint48 releaseAfter,uint48 expiresAt,uint48 quoteValidUntil,bytes32 clearanceId,bytes32 invoiceCommitment,bytes32 policyDigest,bytes32 corridorDigest,bytes32 quoteDigest,uint256 clientOrderId,uint8 state,uint8 approvals,uint64 approvalRound,uint64 payerRiskEpoch,address approver1,address approver2,uint64 approver1Epoch,uint64 approver2Epoch)",
  "function clearances(bytes32) view returns (address payer,address beneficiary,bytes32 policyDigest,bytes32 corridorDigest,uint128 maxAmount,uint128 consumedAmount,uint48 validUntil,address issuer,uint64 issuerEpoch,uint64 payerRiskEpoch,uint64 subjectRiskEpoch)",
  "function subjectRisks(address) view returns (bool initialized,bool sanctioned,uint64 epoch,bytes32 evidenceDigest,address attestor,uint64 attestorEpoch,uint48 screenedAt)",
  "function totalEscrowed() view returns (uint256)",
  "function escrowIsSolvent() view returns (bool)",
  "function verifyInvoiceDisclosure(uint256,bytes,bytes32) view returns (bool)",
  "function grantRole(bytes32 role,address account)",
  "function attestInitialRisk(address beneficiary,bool sanctioned,bytes32 evidenceDigest)",
  "function issueClearance(address payer,address beneficiary,bytes32 policyDigest,bytes32 corridorDigest,uint128 maxAmount,uint48 validUntil) returns (bytes32 clearanceId)",
  "function proposeWithSignature((address payer,address beneficiary,uint128 amount,uint48 expiresAt,uint48 quoteValidUntil,bytes32 clearanceId,bytes32 invoiceCommitment,bytes32 policyDigest,bytes32 corridorDigest,bytes32 quoteDigest,uint256 clientOrderId,uint256 nonce) intent,bytes signature) returns (uint256 id)",
  "function approveSettlement(uint256 id)",
  "function fundSettlement(uint256 id)",
  "function flagSubjectSanctioned(address beneficiary,bytes32 evidenceDigest)",
  "function releaseSettlement(uint256 id)",
  "function cancelSettlement(uint256 id,bytes32 reasonDigest)",
  "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
  "event SubjectRiskRecorded(address indexed beneficiary,bool sanctioned,uint64 epoch,bytes32 evidenceDigest,uint48 screenedAt)",
  "event ClearanceIssued(bytes32 indexed clearanceId,address indexed payer,address indexed beneficiary,address issuer,bytes32 policyDigest,bytes32 corridorDigest,uint128 maxAmount,uint48 validUntil,uint64 subjectRiskEpoch)",
  "event ClearanceConsumptionChanged(bytes32 indexed clearanceId,uint128 consumedAmount,uint128 maxAmount)",
  "event SettlementProposed(uint256 indexed id,address indexed payer,address indexed beneficiary,uint256 amount,uint256 clientOrderId,bytes32 clearanceId,bytes32 intentHash,bytes32 invoiceCommitment,bytes32 corridorDigest,bytes32 quoteDigest,uint48 expiresAt,uint48 quoteValidUntil)",
  "event SettlementApproved(uint256 indexed id,address indexed approver,uint8 approvals,uint8 requiredApprovals,uint64 approvalRound,uint64 membershipEpoch)",
  "event SettlementFunded(uint256 indexed id,uint256 amount,uint48 fundedAt,uint48 releaseAfter)",
  "event SettlementReleased(uint256 indexed id,address indexed beneficiary,uint256 amount)",
  "event SettlementCancelled(uint256 indexed id,address indexed actor,bytes32 indexed reasonDigest,uint256 refundedAmount)",
  "error BeneficiarySanctioned()",
];
const tokenAbi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function mint(address to,uint256 amount)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
];
const treasuryInterface = new Interface(treasuryAbi);
const tokenInterface = new Interface(tokenAbi);
const AMOUNT = 15_000_000_000n;
const MINTED = AMOUNT * 2n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const APPROVER_ROLE = id("APPROVER_ROLE");
const COMPLIANCE_ROLE = id("COMPLIANCE_ROLE");

// This is deliberately a closed, ordered transcript. A manifest cannot gain
// credibility merely by adding a receipt: every row must be the expected action.
const expectedActions = [
  { label: "deploy mUSD", kind: "deployToken", from: "deployer", events: [] },
  { label: "deploy V2", kind: "deployTreasury", from: "deployer", events: ["RoleGranted"] },
  { label: "grant approver A", method: "grantRole", from: "deployer", events: ["RoleGranted"], grantRole: APPROVER_ROLE, account: "approverA" },
  { label: "grant approver B", method: "grantRole", from: "deployer", events: ["RoleGranted"], grantRole: APPROVER_ROLE, account: "approverB" },
  { label: "grant compliance A", method: "grantRole", from: "deployer", events: ["RoleGranted"], grantRole: COMPLIANCE_ROLE, account: "complianceA" },
  { label: "grant compliance B", method: "grantRole", from: "deployer", events: ["RoleGranted"], grantRole: COMPLIANCE_ROLE, account: "complianceB" },
  { label: "mint payer", method: "mint", from: "deployer", to: "token", events: ["Transfer"] },
  { label: "payer approve", method: "approve", from: "payer", to: "token", events: ["Approval"] },
  { label: "risk payer", method: "attestInitialRisk", from: "complianceA", events: ["SubjectRiskRecorded"], subject: "payer" },
  { label: "risk clean beneficiary", method: "attestInitialRisk", from: "complianceA", events: ["SubjectRiskRecorded"], subject: "beneficiaryClean" },
  { label: "risk blocked beneficiary", method: "attestInitialRisk", from: "complianceA", events: ["SubjectRiskRecorded"], subject: "beneficiaryBlocked" },
  { label: "clearance clean", method: "issueClearance", from: "complianceA", events: ["ClearanceIssued"], scenario: "clean", beneficiary: "beneficiaryClean" },
  { label: "clearance blocked unused", method: "issueClearance", from: "complianceA", events: ["ClearanceIssued"], scenario: "blockedUnused", beneficiary: "beneficiaryBlocked" },
  { label: "intent clean", method: "proposeWithSignature", from: "relayer", events: ["SettlementProposed"], settlementId: 1, beneficiary: "beneficiaryClean" },
  { label: "approval clean A", method: "approveSettlement", from: "approverA", events: ["SettlementApproved"], settlementId: 1, approvalNumber: 1 },
  { label: "approval clean B", method: "approveSettlement", from: "approverB", events: ["SettlementApproved"], settlementId: 1, approvalNumber: 2 },
  { label: "fund clean", method: "fundSettlement", from: "payer", events: ["Transfer", "ClearanceConsumptionChanged", "SettlementFunded"], settlementId: 1 },
  { label: "2 issue payer-bound blocked-path clearance", method: "issueClearance", from: "complianceA", events: ["ClearanceIssued"], scenario: "blockedUsed", beneficiary: "beneficiaryBlocked" },
  { label: "2 relayer submits payer-signed intent", method: "proposeWithSignature", from: "relayer", events: ["SettlementProposed"], settlementId: 2, beneficiary: "beneficiaryBlocked" },
  { label: "2 distinct approval wallet 1 of 2", method: "approveSettlement", from: "approverA", events: ["SettlementApproved"], settlementId: 2, approvalNumber: 1 },
  { label: "2 distinct approval wallet 2 of 2", method: "approveSettlement", from: "approverB", events: ["SettlementApproved"], settlementId: 2, approvalNumber: 2 },
  { label: "2 payer funds revocable escrow", method: "fundSettlement", from: "payer", events: ["Transfer", "ClearanceConsumptionChanged", "SettlementFunded"], settlementId: 2 },
  { label: "2 synthetic sanctions update freezes beneficiary", method: "flagSubjectSanctioned", from: "complianceA", events: ["SubjectRiskRecorded"], subject: "beneficiaryBlocked" },
  { label: "2 release blocked on-chain after sanctions update", method: "releaseSettlement", from: "relayer", events: [], settlementId: 2, expectedStatus: 0 },
  { label: "2 payer cancels and receives full refund", method: "cancelSettlement", from: "payer", events: ["Transfer", "ClearanceConsumptionChanged", "SettlementCancelled"], settlementId: 2 },
  { label: "1 clean settlement releases to distinct beneficiary", method: "releaseSettlement", from: "relayer", events: ["Transfer", "SettlementReleased"], settlementId: 1 },
];

function makeProvider(url) {
  return new JsonRpcProvider(url, 84532, {
    staticNetwork: true,
    // Public Base RPCs commonly reject JSON-RPC batches. Keep every read serial.
    batchMaxCount: 1,
  });
}

function sameAddress(left, right) {
  return getAddress(left) === getAddress(right);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertAddress(actual, expected, context) {
  assert(actual && expected && sameAddress(actual, expected), `${context}: expected ${expected}, got ${actual}`);
}

function assertBigInt(actual, expected, context) {
  assert(BigInt(actual) === BigInt(expected), `${context}: expected ${expected}, got ${actual}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRpc(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(250 * attempt);
    }
  }
  throw new Error(`${label} failed after 3 serial attempts: ${lastError.shortMessage || lastError.message}`, { cause: lastError });
}

function decodeReceiptLogs(receipt) {
  return receipt.logs.map((log, logIndex) => {
    let parser;
    if (sameAddress(log.address, evidence.treasury)) parser = treasuryInterface;
    else if (sameAddress(log.address, evidence.token.address)) parser = tokenInterface;
    else throw new Error(`Unexpected log emitter ${log.address} in ${receipt.hash} log ${logIndex}`);
    const parsed = parser.parseLog(log);
    assert(parsed, `Undecodable log in ${receipt.hash} log ${logIndex}`);
    return { name: parsed.name, args: parsed.args, address: getAddress(log.address), logIndex };
  });
}

function extractErrorData(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.error?.error?.data,
  ];
  return candidates.find((value) => typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) || null;
}

async function replayHistoricalFailure(tx, receipt) {
  const call = {
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value: toQuantity(tx.value),
    gas: toQuantity(tx.gasLimit),
  };
  const blockTag = toQuantity(receipt.blockNumber - 1);
  let callData;
  let callError;
  for (let attempt = 1; attempt <= 3 && !callData; attempt += 1) {
    try {
      await archiveProvider.send("eth_call", [call, blockTag]);
      throw new Error("Historical release eth_call unexpectedly succeeded");
    } catch (error) {
      const data = extractErrorData(error);
      if (data) callData = data;
      else {
        callError = error;
        if (attempt < 3) await sleep(250 * attempt);
      }
    }
  }
  if (!callData) {
    throw new Error(`Historical eth_call did not return revert data: ${callError?.shortMessage || callError?.message}`);
  }
  const callDecoded = treasuryInterface.parseError(callData);
  assert(callDecoded?.name === "BeneficiarySanctioned", `Historical eth_call reverted with ${callDecoded?.name || callData}`);

  const trace = await readRpc("debug_traceTransaction", () => archiveProvider.send(
    "debug_traceTransaction",
    [receipt.hash, { disableMemory: true, disableStack: true, disableStorage: true }],
  ));
  const traceData = typeof trace?.returnValue === "string" && trace.returnValue.startsWith("0x")
    ? trace.returnValue
    : null;
  assert(trace?.failed === true, "Historical transaction trace did not report failure");
  assert(traceData, "Historical transaction trace omitted revert data");
  const traceDecoded = treasuryInterface.parseError(traceData);
  assert(traceDecoded?.name === "BeneficiarySanctioned", `Historical trace reverted with ${traceDecoded?.name || traceData}`);
  assert(trace.structLogs?.at(-1)?.op === "REVERT", "Historical trace did not terminate at REVERT");

  return {
    callBlock: receipt.blockNumber - 1,
    selector: callData.slice(0, 10),
    decodedError: callDecoded.name,
    traceFailed: trace.failed,
    traceGasUsed: String(trace.gas),
    traceSteps: trace.structLogs.length,
    traceTerminalOpcode: trace.structLogs.at(-1).op,
    traceDecodedError: traceDecoded.name,
  };
}

function verifyMetadata(row, receipt) {
  if (row.blockNumber !== undefined) assertBigInt(receipt.blockNumber, row.blockNumber, `${row.label} blockNumber`);
  if (row.status !== undefined) assertBigInt(receipt.status, row.status, `${row.label} status`);
  if (row.gasUsed !== undefined) assertBigInt(receipt.gasUsed, row.gasUsed, `${row.label} gasUsed`);
  if (row.gasPriceWei !== undefined) assertBigInt(receipt.gasPrice || 0n, row.gasPriceWei, `${row.label} gasPriceWei`);
  if (row.feeWei !== undefined) {
    assertBigInt(receipt.gasUsed * (receipt.gasPrice || 0n), row.feeWei, `${row.label} feeWei`);
  }
  assert(row.explorer?.endsWith(row.hash), `${row.label} explorer URL does not end with its hash`);
}

function resolveActor(actors, name) {
  const address = actors[name];
  assert(address, `Manifest is missing actor ${name}`);
  return address;
}

function verifySpecificAction(spec, decoded, logs, actors, context) {
  const event = (name) => logs.find((entry) => entry.name === name);
  const expectedFrom = resolveActor(actors, spec.from);
  assertAddress(context.tx.from, expectedFrom, `${spec.label} sender`);

  if (spec.kind === "deployToken") {
    assert(context.tx.to === null, `${spec.label} must be contract creation`);
    assertAddress(context.receipt.contractAddress, evidence.token.address, `${spec.label} contractAddress`);
    return;
  }
  if (spec.kind === "deployTreasury") {
    assert(context.tx.to === null, `${spec.label} must be contract creation`);
    assertAddress(context.receipt.contractAddress, evidence.treasury, `${spec.label} contractAddress`);
    const granted = event("RoleGranted");
    assert(granted.args.role === `0x${"0".repeat(64)}`, `${spec.label} did not grant DEFAULT_ADMIN_ROLE`);
    assertAddress(granted.args.account, actors.deployer, `${spec.label} admin`);
    assertAddress(granted.args.sender, actors.deployer, `${spec.label} grant sender`);
    return;
  }

  const expectedTarget = spec.to === "token" ? evidence.token.address : evidence.treasury;
  assertAddress(context.tx.to, expectedTarget, `${spec.label} target`);
  assert(decoded?.name === spec.method, `${spec.label}: expected ${spec.method}, decoded ${decoded?.name}`);

  if (spec.method === "grantRole") {
    assert(decoded.args.role === spec.grantRole, `${spec.label} role mismatch`);
    assertAddress(decoded.args.account, resolveActor(actors, spec.account), `${spec.label} role account`);
    const granted = event("RoleGranted");
    assert(granted.args.role === spec.grantRole, `${spec.label} RoleGranted role mismatch`);
    assertAddress(granted.args.account, resolveActor(actors, spec.account), `${spec.label} RoleGranted account`);
    assertAddress(granted.args.sender, actors.deployer, `${spec.label} RoleGranted sender`);
  } else if (spec.method === "mint") {
    assertAddress(decoded.args.to, actors.payer, `${spec.label} recipient`);
    assertBigInt(decoded.args.amount, MINTED, `${spec.label} amount`);
    const transfer = event("Transfer");
    assertAddress(transfer.args.from, ZERO_ADDRESS, `${spec.label} Transfer from`);
    assertAddress(transfer.args.to, actors.payer, `${spec.label} Transfer to`);
    assertBigInt(transfer.args.value, MINTED, `${spec.label} Transfer value`);
  } else if (spec.method === "approve") {
    assertAddress(decoded.args.spender, evidence.treasury, `${spec.label} spender`);
    assertBigInt(decoded.args.amount, MINTED, `${spec.label} allowance`);
    const approval = event("Approval");
    assertAddress(approval.args.owner, actors.payer, `${spec.label} Approval owner`);
    assertAddress(approval.args.spender, evidence.treasury, `${spec.label} Approval spender`);
    assertBigInt(approval.args.value, MINTED, `${spec.label} Approval value`);
  } else if (spec.method === "attestInitialRisk") {
    assertAddress(decoded.args.beneficiary, resolveActor(actors, spec.subject), `${spec.label} subject`);
    assert(decoded.args.sanctioned === false, `${spec.label} must initialize clean risk`);
    assert(decoded.args.evidenceDigest !== `0x${"0".repeat(64)}`, `${spec.label} has empty evidence digest`);
    const risk = event("SubjectRiskRecorded");
    assertAddress(risk.args.beneficiary, resolveActor(actors, spec.subject), `${spec.label} event subject`);
    assert(risk.args.sanctioned === false, `${spec.label} event verdict mismatch`);
    assertBigInt(risk.args.epoch, 1, `${spec.label} risk epoch`);
    assert(risk.args.evidenceDigest === decoded.args.evidenceDigest, `${spec.label} evidence digest mismatch`);
  } else if (spec.method === "issueClearance") {
    assertAddress(decoded.args.payer, actors.payer, `${spec.label} clearance payer`);
    assertAddress(decoded.args.beneficiary, resolveActor(actors, spec.beneficiary), `${spec.label} clearance beneficiary`);
    assertBigInt(decoded.args.maxAmount, AMOUNT, `${spec.label} clearance capacity`);
    const issued = event("ClearanceIssued");
    assertAddress(issued.args.payer, actors.payer, `${spec.label} event payer`);
    assertAddress(issued.args.beneficiary, resolveActor(actors, spec.beneficiary), `${spec.label} event beneficiary`);
    assertAddress(issued.args.issuer, actors.complianceA, `${spec.label} event issuer`);
    assert(issued.args.policyDigest === decoded.args.policyDigest, `${spec.label} policy digest mismatch`);
    assert(issued.args.corridorDigest === decoded.args.corridorDigest, `${spec.label} corridor digest mismatch`);
    assertBigInt(issued.args.maxAmount, AMOUNT, `${spec.label} event capacity`);
    assertBigInt(issued.args.validUntil, decoded.args.validUntil, `${spec.label} validUntil mismatch`);
    context.clearanceIds[spec.scenario] = issued.args.clearanceId;
  } else if (spec.method === "proposeWithSignature") {
    const intent = decoded.args.intent;
    assertAddress(intent.payer, actors.payer, `${spec.label} signed payer`);
    assertAddress(intent.beneficiary, resolveActor(actors, spec.beneficiary), `${spec.label} signed beneficiary`);
    assertBigInt(intent.amount, AMOUNT, `${spec.label} signed amount`);
    const expectedClearance = spec.settlementId === 1 ? context.clearanceIds.clean : context.clearanceIds.blockedUsed;
    assert(intent.clearanceId === expectedClearance, `${spec.label} did not use the expected clearance`);
    assert(intent.clearanceId !== context.clearanceIds.blockedUnused, `${spec.label} used the explicitly unused clearance`);
    const proposed = event("SettlementProposed");
    assertBigInt(proposed.args.id, spec.settlementId, `${spec.label} proposed settlement id`);
    assertAddress(proposed.args.payer, intent.payer, `${spec.label} event payer`);
    assertAddress(proposed.args.beneficiary, intent.beneficiary, `${spec.label} event beneficiary`);
    assertBigInt(proposed.args.amount, intent.amount, `${spec.label} event amount`);
    assertBigInt(proposed.args.clientOrderId, intent.clientOrderId, `${spec.label} event client order`);
    assert(proposed.args.clearanceId === intent.clearanceId, `${spec.label} event clearance mismatch`);
    assert(proposed.args.invoiceCommitment === intent.invoiceCommitment, `${spec.label} invoice commitment mismatch`);
    assert(proposed.args.corridorDigest === intent.corridorDigest, `${spec.label} corridor digest mismatch`);
    assert(proposed.args.quoteDigest === intent.quoteDigest, `${spec.label} quote digest mismatch`);
    assertBigInt(proposed.args.expiresAt, intent.expiresAt, `${spec.label} expiry mismatch`);
    assertBigInt(proposed.args.quoteValidUntil, intent.quoteValidUntil, `${spec.label} quote expiry mismatch`);
    context.proposedIntents[spec.settlementId] = intent;
  } else if (spec.method === "approveSettlement") {
    assertBigInt(decoded.args.id, spec.settlementId, `${spec.label} calldata settlement id`);
    const approved = event("SettlementApproved");
    assertBigInt(approved.args.id, spec.settlementId, `${spec.label} event settlement id`);
    assertAddress(approved.args.approver, expectedFrom, `${spec.label} approver`);
    assertBigInt(approved.args.approvals, spec.approvalNumber, `${spec.label} approval count`);
    assertBigInt(approved.args.requiredApprovals, 2, `${spec.label} required approvals`);
  } else if (spec.method === "fundSettlement") {
    assertBigInt(decoded.args.id, spec.settlementId, `${spec.label} calldata settlement id`);
    const transfer = event("Transfer");
    assertAddress(transfer.args.from, actors.payer, `${spec.label} transfer payer`);
    assertAddress(transfer.args.to, evidence.treasury, `${spec.label} transfer escrow`);
    assertBigInt(transfer.args.value, AMOUNT, `${spec.label} transfer amount`);
    const consumption = event("ClearanceConsumptionChanged");
    const expectedClearance = spec.settlementId === 1 ? context.clearanceIds.clean : context.clearanceIds.blockedUsed;
    assert(consumption.args.clearanceId === expectedClearance, `${spec.label} clearance consumption mismatch`);
    assertBigInt(consumption.args.consumedAmount, AMOUNT, `${spec.label} consumed amount`);
    assertBigInt(consumption.args.maxAmount, AMOUNT, `${spec.label} max amount`);
    const funded = event("SettlementFunded");
    assertBigInt(funded.args.id, spec.settlementId, `${spec.label} funded settlement id`);
    assertBigInt(funded.args.amount, AMOUNT, `${spec.label} funded amount`);
    assert(BigInt(funded.args.releaseAfter) > BigInt(funded.args.fundedAt), `${spec.label} has no challenge window`);
  } else if (spec.method === "flagSubjectSanctioned") {
    assertAddress(decoded.args.beneficiary, actors.beneficiaryBlocked, `${spec.label} sanctions subject`);
    assert(decoded.args.evidenceDigest !== `0x${"0".repeat(64)}`, `${spec.label} has empty sanctions evidence digest`);
    const risk = event("SubjectRiskRecorded");
    assertAddress(risk.args.beneficiary, actors.beneficiaryBlocked, `${spec.label} event subject`);
    assert(risk.args.sanctioned === true, `${spec.label} event must set sanctioned=true`);
    assertBigInt(risk.args.epoch, 2, `${spec.label} sanctions epoch`);
    assert(risk.args.evidenceDigest === decoded.args.evidenceDigest, `${spec.label} sanctions evidence mismatch`);
  } else if (spec.method === "cancelSettlement") {
    assertBigInt(decoded.args.id, 2, `${spec.label} calldata settlement id`);
    assert(decoded.args.reasonDigest === id("SANCTIONS-ROLLBACK"), `${spec.label} reason digest mismatch`);
    const transfer = event("Transfer");
    assertAddress(transfer.args.from, evidence.treasury, `${spec.label} refund source`);
    assertAddress(transfer.args.to, actors.payer, `${spec.label} refund recipient`);
    assertBigInt(transfer.args.value, AMOUNT, `${spec.label} refund transfer`);
    const consumption = event("ClearanceConsumptionChanged");
    assert(consumption.args.clearanceId === context.clearanceIds.blockedUsed, `${spec.label} clearance mismatch`);
    assertBigInt(consumption.args.consumedAmount, 0, `${spec.label} remaining consumption`);
    const cancelled = event("SettlementCancelled");
    assertBigInt(cancelled.args.id, 2, `${spec.label} event settlement id`);
    assertAddress(cancelled.args.actor, actors.payer, `${spec.label} cancellation actor`);
    assert(cancelled.args.reasonDigest === decoded.args.reasonDigest, `${spec.label} cancellation reason mismatch`);
    assertBigInt(cancelled.args.refundedAmount, AMOUNT, `${spec.label} refunded amount`);
  } else if (spec.method === "releaseSettlement") {
    assertBigInt(decoded.args.id, spec.settlementId, `${spec.label} calldata settlement id`);
    if ((spec.expectedStatus ?? 1) === 1) {
      const transfer = event("Transfer");
      assertAddress(transfer.args.from, evidence.treasury, `${spec.label} release source`);
      assertAddress(transfer.args.to, actors.beneficiaryClean, `${spec.label} release recipient`);
      assertBigInt(transfer.args.value, AMOUNT, `${spec.label} release transfer`);
      const released = event("SettlementReleased");
      assertBigInt(released.args.id, 1, `${spec.label} event settlement id`);
      assertAddress(released.args.beneficiary, actors.beneficiaryClean, `${spec.label} event beneficiary`);
      assertBigInt(released.args.amount, AMOUNT, `${spec.label} released amount`);
    }
  }
}

async function main() {
  assert(String(evidence.chainId) === "84532", `Manifest chainId is ${evidence.chainId}`);
  assert(evidence.network === "Base Sepolia", `Manifest network is ${evidence.network}`);
  assert(evidence.transactions.length === expectedActions.length, `Expected ${expectedActions.length} manifest transactions, got ${evidence.transactions.length}`);
  const normalizedHashes = evidence.transactions.map((row) => row.hash.toLowerCase());
  assert(new Set(normalizedHashes).size === normalizedHashes.length, "Duplicate transaction hash in manifest");
  const expectedReverts = evidence.transactions.filter((row) => row.expectedRevert === true);
  assert(expectedReverts.length === 1, `Expected one expectedRevert marker, got ${expectedReverts.length}`);

  const network = await readRpc("getNetwork", () => provider.getNetwork());
  assert(network.chainId === 84532n, `Unexpected chain ${network.chainId}`);
  const archiveNetwork = await readRpc("archive getNetwork", () => archiveProvider.getNetwork());
  assert(archiveNetwork.chainId === 84532n, `Unexpected archive chain ${archiveNetwork.chainId}`);

  const actors = Object.fromEntries(Object.entries(evidence.roles).map(([name, address]) => [name, getAddress(address)]));
  const context = { clearanceIds: {}, proposedIntents: {} };
  const transcript = [];
  const receipts = [];
  let previousPosition = null;
  let failedTx;

  for (let index = 0; index < expectedActions.length; index += 1) {
    const row = evidence.transactions[index];
    const spec = expectedActions[index];
    assert(row.label === spec.label, `Transcript row ${index}: expected label "${spec.label}", got "${row.label}"`);
    const tx = await readRpc(`getTransaction ${row.hash}`, () => provider.getTransaction(row.hash));
    const receipt = await readRpc(`getTransactionReceipt ${row.hash}`, () => provider.getTransactionReceipt(row.hash));
    assert(tx, `Missing transaction ${row.hash}`);
    assert(receipt, `Missing receipt ${row.hash}`);
    assert(tx.hash.toLowerCase() === row.hash.toLowerCase(), `${row.label} transaction hash mismatch`);
    assert(receipt.hash.toLowerCase() === row.hash.toLowerCase(), `${row.label} receipt hash mismatch`);
    assert(receipt.blockHash === tx.blockHash && receipt.blockNumber === tx.blockNumber, `${row.label} transaction/receipt block mismatch`);
    assertAddress(receipt.from, tx.from, `${row.label} receipt sender`);
    if (tx.to === null) assert(receipt.to === null, `${row.label} receipt unexpectedly has target`);
    else assertAddress(receipt.to, tx.to, `${row.label} receipt target`);
    if (index === 0) actors.deployer = getAddress(tx.from);
    const status = Number(receipt.status);
    const expectedStatus = spec.expectedStatus ?? 1;
    assert(status === expectedStatus, `${row.label}: expected status ${expectedStatus}, got ${status}`);
    assert(Boolean(row.expectedRevert) === (expectedStatus === 0), `${row.label} expectedRevert marker mismatch`);
    const position = [receipt.blockNumber, receipt.index];
    if (previousPosition) {
      const ordered = position[0] > previousPosition[0]
        || (position[0] === previousPosition[0] && position[1] > previousPosition[1]);
      assert(ordered, `${row.label} is out of chronological transaction order`);
    }
    previousPosition = position;
    verifyMetadata(row, receipt);

    let decoded = null;
    if (!spec.kind) {
      const parser = spec.to === "token" ? tokenInterface : treasuryInterface;
      decoded = parser.parseTransaction({ data: tx.data, value: tx.value });
    }
    const logs = decodeReceiptLogs(receipt);
    const eventNames = logs.map((entry) => entry.name);
    assert(JSON.stringify(eventNames) === JSON.stringify(spec.events), `${row.label}: expected events ${spec.events.join(" -> ") || "none"}, got ${eventNames.join(" -> ") || "none"}`);
    verifySpecificAction(spec, decoded, logs, actors, { tx, receipt, clearanceIds: context.clearanceIds, proposedIntents: context.proposedIntents });

    if (expectedStatus === 0) failedTx = { tx, receipt };
    receipts.push(receipt);
    transcript.push({
      index,
      label: row.label,
      hash: row.hash,
      blockNumber: receipt.blockNumber,
      transactionIndex: receipt.index,
      status,
      from: getAddress(tx.from),
      to: tx.to ? getAddress(tx.to) : null,
      method: decoded?.name || (spec.kind === "deployToken" ? "CREATE mUSD" : "CREATE VerifiableTreasuryV2"),
      settlementId: spec.settlementId ?? null,
      events: eventNames,
    });
    await sleep(40);
  }

  assert(failedTx, "Expected failed release transaction was not found");
  assert(failedTx.receipt.hash.toLowerCase() === expectedReverts[0].hash.toLowerCase(), "Unique failed receipt is not the expected-revert manifest row");
  assertAddress(failedTx.tx.from, actors.relayer, "failed release sender");
  assertAddress(failedTx.tx.to, evidence.treasury, "failed release target");
  const failedDecoded = treasuryInterface.parseTransaction({ data: failedTx.tx.data, value: failedTx.tx.value });
  assert(failedDecoded.name === "releaseSettlement", "Unique failed transaction is not releaseSettlement");
  assertBigInt(failedDecoded.args.id, 2, "Unique failed release settlement id");
  const historicalRevert = await replayHistoricalFailure(failedTx.tx, failedTx.receipt);

  assert(context.clearanceIds.blockedUsed === evidence.scenarios.sanctionsRollback.clearanceId, "Used blocked-path clearance does not match manifest");
  const manifestIntent = evidence.scenarios.sanctionsRollback.intent;
  const blockedIntent = context.proposedIntents[2];
  for (const key of ["payer", "beneficiary"]) assertAddress(blockedIntent[key], manifestIntent[key], `Settlement 2 manifest intent ${key}`);
  for (const key of ["amount", "expiresAt", "quoteValidUntil", "clientOrderId", "nonce"]) assertBigInt(blockedIntent[key], manifestIntent[key], `Settlement 2 manifest intent ${key}`);
  for (const key of ["clearanceId", "invoiceCommitment", "policyDigest", "corridorDigest", "quoteDigest"]) {
    assert(blockedIntent[key] === manifestIntent[key], `Settlement 2 manifest intent ${key} mismatch`);
  }

  const treasury = new Contract(evidence.treasury, treasuryAbi, provider);
  const token = new Contract(evidence.token.address, tokenAbi, provider);
  const stablecoin = await readRpc("treasury.stablecoin", () => treasury.stablecoin());
  const symbol = await readRpc("token.symbol", () => token.symbol());
  const decimals = await readRpc("token.decimals", () => token.decimals());
  const totalSupply = await readRpc("token.totalSupply", () => token.totalSupply());
  const clean = await readRpc("settlements(1)", () => treasury.settlements(1));
  const blocked = await readRpc("settlements(2)", () => treasury.settlements(2));
  const cleanClearance = await readRpc("clean clearance", () => treasury.clearances(context.clearanceIds.clean));
  const blockedClearance = await readRpc("blocked clearance", () => treasury.clearances(context.clearanceIds.blockedUsed));
  const unusedClearance = await readRpc("unused clearance", () => treasury.clearances(context.clearanceIds.blockedUnused));
  const blockedRisk = await readRpc("blocked subject risk", () => treasury.subjectRisks(actors.beneficiaryBlocked));
  const payerBalance = await readRpc("payer balance", () => token.balanceOf(actors.payer));
  const cleanBalance = await readRpc("clean beneficiary balance", () => token.balanceOf(actors.beneficiaryClean));
  const blockedBalance = await readRpc("blocked beneficiary balance", () => token.balanceOf(actors.beneficiaryBlocked));
  const escrowBalance = await readRpc("escrow balance", () => token.balanceOf(evidence.treasury));
  const remainingAllowance = await readRpc("payer allowance", () => token.allowance(actors.payer, evidence.treasury));
  const totalEscrowed = await readRpc("totalEscrowed", () => treasury.totalEscrowed());
  const solvent = await readRpc("escrowIsSolvent", () => treasury.escrowIsSolvent());
  const payerNonce = await readRpc("payerNonces", () => treasury.payerNonces(actors.payer));
  const nextSettlementId = await readRpc("nextSettlementId", () => treasury.nextSettlementId());
  const disclosure = await readRpc("verifyInvoiceDisclosure", () => treasury.verifyInvoiceDisclosure(
    evidence.publicInvoiceDisclosure.settlementId,
    Buffer.from(evidence.publicInvoiceDisclosure.invoiceDataUtf8, "utf8"),
    evidence.publicInvoiceDisclosure.salt,
  ));

  assertAddress(stablecoin, evidence.token.address, "treasury stablecoin");
  assert(symbol === "mUSD" && evidence.token.symbol === "mUSD", `Unexpected token symbol ${symbol}`);
  assertBigInt(decimals, 6, "token decimals");
  assertBigInt(totalSupply, MINTED, "token total supply");
  assertAddress(clean.payer, actors.payer, "settlement 1 payer");
  assertAddress(clean.beneficiary, actors.beneficiaryClean, "settlement 1 beneficiary");
  assertBigInt(clean.amount, AMOUNT, "settlement 1 amount");
  assert(clean.clearanceId === context.clearanceIds.clean, "settlement 1 clearance mismatch");
  assertBigInt(clean.state, 4, "settlement 1 state");
  assertAddress(blocked.payer, actors.payer, "settlement 2 payer");
  assertAddress(blocked.beneficiary, actors.beneficiaryBlocked, "settlement 2 beneficiary");
  assertBigInt(blocked.amount, AMOUNT, "settlement 2 amount");
  assert(blocked.clearanceId === context.clearanceIds.blockedUsed, "settlement 2 clearance mismatch");
  assertBigInt(blocked.state, 5, "settlement 2 state");
  assertBigInt(cleanClearance.consumedAmount, AMOUNT, "clean clearance consumed amount");
  assertBigInt(blockedClearance.consumedAmount, 0, "blocked clearance consumed amount after refund");
  assertBigInt(unusedClearance.consumedAmount, 0, "unused clearance consumed amount");
  assert(blockedRisk.initialized && blockedRisk.sanctioned, "blocked beneficiary is not currently sanctioned");
  assertBigInt(blockedRisk.epoch, 2, "blocked beneficiary risk epoch");
  assertBigInt(payerBalance, AMOUNT, "payer final balance");
  assertBigInt(cleanBalance, AMOUNT, "clean beneficiary final balance");
  assertBigInt(blockedBalance, 0, "blocked beneficiary final balance");
  assertBigInt(escrowBalance, 0, "escrow final balance");
  assertBigInt(remainingAllowance, 0, "payer remaining allowance");
  assertBigInt(totalEscrowed, 0, "totalEscrowed final value");
  assert(solvent === true && escrowBalance >= totalEscrowed, "escrow is not solvent");
  assertBigInt(payerNonce, 2, "payer nonce after two signed intents");
  assertBigInt(nextSettlementId, 3, "next settlement id");
  assert(disclosure === true, "public invoice disclosure does not match its on-chain commitment");

  const expectedFinal = evidence.reconciliation.final;
  for (const [label, actual, expected] of [
    ["manifest payer balance", payerBalance, expectedFinal.payer],
    ["manifest clean beneficiary balance", cleanBalance, expectedFinal.beneficiaryClean],
    ["manifest blocked beneficiary balance", blockedBalance, expectedFinal.beneficiaryBlocked],
    ["manifest escrow balance", escrowBalance, expectedFinal.escrow],
    ["manifest totalEscrowed", totalEscrowed, expectedFinal.totalEscrowed],
    ["manifest clean state", clean.state, expectedFinal.cleanState],
    ["manifest blocked state", blocked.state, expectedFinal.blockedState],
  ]) assertBigInt(actual, expected, label);
  assert(expectedFinal.solvent === solvent, "Manifest solvency mismatch");
  assert(expectedFinal.invoiceDisclosureVerified === disclosure, "Manifest disclosure result mismatch");

  const roleAddresses = Object.values(actors);
  assert(new Set(roleAddresses.map((address) => address.toLowerCase())).size === roleAddresses.length, "Governance or workflow role addresses overlap");

  const totalGasUsed = receipts.reduce((total, receipt) => total + receipt.gasUsed, 0n);
  const totalFeeWei = receipts.reduce((total, receipt) => total + receipt.gasUsed * (receipt.gasPrice || 0n), 0n);
  const firstBlock = await readRpc("first transcript block", () => provider.getBlock(receipts[0].blockNumber));
  const lastBlock = await readRpc("last transcript block", () => provider.getBlock(receipts.at(-1).blockNumber));
  assert(firstBlock && lastBlock, "Could not read transcript boundary blocks");
  const observedLatencies = evidence.transactions
    .map((row) => row.observedConfirmationLatencyMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const medianObservedLatencyMs = observedLatencies.length
    ? observedLatencies[Math.floor(observedLatencies.length / 2)]
    : null;

  const result = {
    verifiedAt: new Date().toISOString(),
    network: "Base Sepolia",
    chainId: Number(network.chainId),
    treasury: getAddress(evidence.treasury),
    token: getAddress(evidence.token.address),
    transcript: {
      transactionCount: transcript.length,
      successfulReceipts: transcript.filter((row) => row.status === 1).length,
      expectedFailedReceipts: transcript.filter((row) => row.status === 0).length,
      strictChronologicalOrder: true,
      callersTargetsAndCalldataVerified: true,
      eventNamesValuesAndOrderVerified: true,
      transactions: transcript,
    },
    historicalFailedRelease: {
      hash: failedTx.receipt.hash,
      method: "releaseSettlement",
      settlementId: 2,
      status: failedTx.receipt.status,
      ...historicalRevert,
    },
    criticalSequence: [
      "settlement 2 funded",
      "blocked beneficiary risk changed to sanctioned=true / epoch=2",
      "settlement 2 release reverted with BeneficiarySanctioned",
      "settlement 2 cancelled and 15000 mUSD refunded",
      "settlement 1 released 15000 mUSD to the clean beneficiary",
    ],
    reconciliation: {
      tokenSymbol: symbol,
      tokenDecimals: Number(decimals),
      tokenTotalSupply: totalSupply.toString(),
      payer: payerBalance.toString(),
      beneficiaryClean: cleanBalance.toString(),
      beneficiaryBlocked: blockedBalance.toString(),
      escrow: escrowBalance.toString(),
      remainingAllowance: remainingAllowance.toString(),
      totalEscrowed: totalEscrowed.toString(),
      cleanState: Number(clean.state),
      blockedState: Number(blocked.state),
      blockedRiskSanctioned: blockedRisk.sanctioned,
      blockedRiskEpoch: Number(blockedRisk.epoch),
      cleanClearanceConsumed: cleanClearance.consumedAmount.toString(),
      blockedClearanceConsumedAfterRefund: blockedClearance.consumedAmount.toString(),
      unusedClearanceConsumed: unusedClearance.consumedAmount.toString(),
      payerNonce: payerNonce.toString(),
      nextSettlementId: nextSettlementId.toString(),
      solvent,
      invoiceDisclosureVerified: disclosure,
    },
    costAndTiming: {
      totalGasUsed: totalGasUsed.toString(),
      totalFeeWei: totalFeeWei.toString(),
      publicBlockSpanSeconds: Number(lastBlock.timestamp - firstBlock.timestamp),
      observedConfirmationLatencySampleCount: observedLatencies.length,
      medianObservedConfirmationLatencyMs: medianObservedLatencyMs,
      latencyBoundary: "Retained client observations only; not a production performance claim.",
    },
    verificationBoundary: "Public RPC receipt/state/event verification plus historical eth_call and debug trace. This is reproducible evidence, not an independent smart-contract audit or production settlement.",
    passed: true,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
