"use strict";

const {
  AbiCoder,
  MaxUint256,
  TypedDataEncoder,
  getAddress,
  id,
  isHexString,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} = require("ethers");

const PLAN_SCHEMA = "vta.settlement-plan.v2";
const INVOICE_COMMITMENT_DOMAIN = id("VTA_INVOICE_COMMITMENT_V2");
const ROUTE_DIGEST_DOMAIN = id("VTA_ROUTE_V2");
const QUOTE_DIGEST_DOMAIN = id("VTA_QUOTE_V2");
const UINT48_MAX = (1n << 48n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const AUTHORIZATION_MATERIAL_KEYS = new Set([
  "privatekey",
  "mnemonic",
  "seed",
  "seedphrase",
  "signingkey",
  "keystore",
  "signature",
  "signedtransaction",
  "rawtransaction",
]);
const abi = AbiCoder.defaultAbiCoder();

const SETTLEMENT_INTENT_TYPES = Object.freeze({
  SettlementIntent: Object.freeze([
    Object.freeze({ name: "payer", type: "address" }),
    Object.freeze({ name: "beneficiary", type: "address" }),
    Object.freeze({ name: "amount", type: "uint128" }),
    Object.freeze({ name: "expiresAt", type: "uint48" }),
    Object.freeze({ name: "quoteValidUntil", type: "uint48" }),
    Object.freeze({ name: "clearanceId", type: "bytes32" }),
    Object.freeze({ name: "invoiceCommitment", type: "bytes32" }),
    Object.freeze({ name: "policyDigest", type: "bytes32" }),
    Object.freeze({ name: "corridorDigest", type: "bytes32" }),
    Object.freeze({ name: "quoteDigest", type: "bytes32" }),
    Object.freeze({ name: "clientOrderId", type: "uint256" }),
    Object.freeze({ name: "nonce", type: "uint256" }),
  ]),
});

class PlanValidationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "PlanValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PlanValidationError(code, message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_OBJECT", `${label} must be a JSON object`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("INVALID_TEXT", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function parseUnsigned(value, label, max = MaxUint256) {
  const text = typeof value === "bigint" ? value.toString() : String(value ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    fail("INVALID_INTEGER", `${label} must be an unsigned base-10 integer`);
  }
  const parsed = BigInt(text);
  if (parsed > max) fail("INTEGER_OVERFLOW", `${label} exceeds its Solidity integer width`);
  return parsed;
}

function parseTimestamp(value, label) {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return parseUnsigned(value, label, UINT48_MAX);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return parseUnsigned(value, label, UINT48_MAX);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    const milliseconds = Date.parse(value);
    if (Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value.replace("Z", ".000Z")) {
      return parseUnsigned(milliseconds / 1000, label, UINT48_MAX);
    }
  }
  fail("INVALID_TIMESTAMP", `${label} must be whole Unix seconds or YYYY-MM-DDTHH:mm:ssZ`);
}

function requireBytes32(value, label, { nonZero = true } = {}) {
  if (typeof value !== "string" || !isHexString(value, 32)) {
    fail("INVALID_BYTES32", `${label} must be a 32-byte 0x-prefixed value`);
  }
  const normalized = value.toLowerCase();
  if (nonZero && normalized === `0x${"00".repeat(32)}`) {
    fail("ZERO_BYTES32", `${label} must not be zero`);
  }
  return normalized;
}

function requireAddress(value, label) {
  try {
    const address = getAddress(requireText(value, label));
    if (address === getAddress("0x0000000000000000000000000000000000000000")) {
      fail("ZERO_ADDRESS", `${label} must not be zero`);
    }
    return address;
  } catch (error) {
    if (error instanceof PlanValidationError) throw error;
    fail("INVALID_ADDRESS", `${label} must be a valid EVM address`);
  }
}

function canonicalize(value, path = "$invoiceData") {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("NON_CANONICAL_NUMBER", `${path} numbers must be safe integers; use strings for decimals`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (value[key] === undefined) fail("UNDEFINED_VALUE", `${path}.${key} is undefined`);
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`)}`).join(",")}}`;
  }
  fail("UNSUPPORTED_VALUE", `${path} contains a value that JSON cannot canonically encode`);
}

function encodeInvoiceData(invoiceData) {
  requireObject(invoiceData, "invoiceData");
  return toUtf8Bytes(canonicalize(invoiceData));
}

function domainDigest(domain, value) {
  return keccak256(abi.encode(["bytes32", "bytes"], [domain, toUtf8Bytes(canonicalize(value, "$digestInput"))]));
}

function computeInvoiceCommitment({
  chainId,
  verifyingContract,
  payer,
  beneficiary,
  amount,
  corridorDigest,
  clientOrderId,
  invoiceData,
  salt,
}) {
  return keccak256(abi.encode(
    ["bytes32", "uint256", "address", "address", "address", "uint128", "bytes32", "uint256", "bytes", "bytes32"],
    [
      INVOICE_COMMITMENT_DOMAIN,
      chainId,
      verifyingContract,
      payer,
      beneficiary,
      amount,
      corridorDigest,
      clientOrderId,
      invoiceData,
      salt,
    ],
  ));
}

function rejectAuthorizationMaterial(value, path = "$input") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (AUTHORIZATION_MATERIAL_KEYS.has(normalizedKey)) {
      fail("AUTHORIZATION_MATERIAL_FORBIDDEN", `${path}.${key} is outside the planner trust boundary`);
    }
    rejectAuthorizationMaterial(child, `${path}.${key}`);
  }
}

function planSettlementV2(input, overrides = {}) {
  requireObject(input, "input");
  rejectAuthorizationMaterial(input);
  const settlement = requireObject(input.settlement, "settlement");
  const planning = requireObject(input.planning, "planning");
  const route = requireObject(input.route, "route");
  const quote = requireObject(input.quote, "quote");
  const policy = requireObject(input.policy, "policy");

  const payer = requireAddress(settlement.payer, "settlement.payer");
  const beneficiary = requireAddress(settlement.beneficiary, "settlement.beneficiary");
  if (payer === beneficiary) fail("SAME_PARTY", "payer and beneficiary must be distinct addresses");

  const verifyingContract = requireAddress(
    overrides.verifyingContract ?? planning.verifyingContract,
    "planning.verifyingContract",
  );
  const chainId = parseUnsigned(overrides.chainId ?? planning.chainId, "planning.chainId");
  if (chainId === 0n) fail("INVALID_CHAIN", "planning.chainId must be non-zero");

  const decimals = Number(parseUnsigned(settlement.tokenDecimals, "settlement.tokenDecimals", 36n));
  const amountText = requireText(settlement.amount, "settlement.amount");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(amountText)) {
    fail("INVALID_AMOUNT", "settlement.amount must be an unsigned decimal string without exponent notation");
  }
  let amount;
  try {
    amount = parseUnits(amountText, decimals);
  } catch {
    fail("INVALID_AMOUNT", "settlement.amount has more fractional digits than tokenDecimals permits");
  }
  if (amount === 0n || amount > UINT128_MAX) {
    fail("INVALID_AMOUNT", "settlement.amount must fit a non-zero uint128 base-unit amount");
  }

  const asOf = parseTimestamp(planning.asOf, "planning.asOf");
  const expiresAt = parseTimestamp(settlement.expiresAt, "settlement.expiresAt");
  const minimumChallengeWindow = parseUnsigned(
    planning.minimumChallengeWindowSeconds,
    "planning.minimumChallengeWindowSeconds",
    UINT48_MAX,
  );
  if (minimumChallengeWindow === 0n || expiresAt <= asOf + minimumChallengeWindow) {
    fail("INVALID_VALIDITY", "intent expiry must leave more than the complete challenge window after planning.asOf");
  }

  const originCountry = requireText(route.originCountry, "route.originCountry").toUpperCase();
  const destinationCountry = requireText(route.destinationCountry, "route.destinationCountry").toUpperCase();
  if (!/^[A-Z]{2}$/.test(originCountry) || !/^[A-Z]{2}$/.test(destinationCountry)) {
    fail("INVALID_ROUTE", "route countries must use two-letter codes");
  }
  if (originCountry === destinationCountry) fail("INVALID_ROUTE", "route must cross distinct country codes");
  const settlementAsset = requireText(route.settlementAsset, "route.settlementAsset").toUpperCase();
  const routeNetwork = requireText(route.network, "route.network").toLowerCase();
  if (parseUnsigned(route.chainId, "route.chainId") !== chainId) {
    fail("INVALID_ROUTE", "route.chainId must match the EIP-712 domain chainId");
  }
  if (routeNetwork !== requireText(planning.network, "planning.network").toLowerCase()) {
    fail("INVALID_ROUTE", "route.network must match planning.network");
  }
  requireText(route.deliveryMode, "route.deliveryMode");

  const quoteIssuedAt = parseTimestamp(quote.issuedAt, "quote.issuedAt");
  const quoteValidUntil = parseTimestamp(quote.validUntil, "quote.validUntil");
  if (quoteIssuedAt > asOf || quoteValidUntil <= asOf || quoteValidUntil > expiresAt) {
    fail("INVALID_QUOTE_VALIDITY", "quote must be issued by planning.asOf and expire after planning.asOf but no later than intent expiry");
  }
  if (requireText(quote.asset, "quote.asset").toUpperCase() !== settlementAsset) {
    fail("INVALID_QUOTE_ASSET", "quote.asset must match route.settlementAsset");
  }
  let quoteInput;
  let quoteOutput;
  let quoteFee;
  try {
    quoteInput = parseUnits(requireText(quote.inputAmount, "quote.inputAmount"), decimals);
    quoteOutput = parseUnits(requireText(quote.outputAmount, "quote.outputAmount"), decimals);
    quoteFee = parseUnits(requireText(quote.feeAmount, "quote.feeAmount"), decimals);
  } catch {
    fail("INVALID_QUOTE_AMOUNT", "quote amounts must be valid token decimal strings");
  }
  if (quoteInput !== amount) fail("QUOTE_AMOUNT_MISMATCH", "quote.inputAmount must equal settlement.amount");
  if (quoteOutput + quoteFee !== quoteInput) {
    fail("QUOTE_RECONCILIATION_FAILED", "quote.outputAmount plus quote.feeAmount must equal quote.inputAmount");
  }
  const feeBps = parseUnsigned(quote.feeBps, "quote.feeBps", 10_000n);
  if ((quoteInput * feeBps) / 10_000n !== quoteFee) {
    fail("QUOTE_FEE_MISMATCH", "quote.feeAmount must equal inputAmount multiplied by feeBps");
  }
  if (feeBps !== 0n || quoteFee !== 0n || quoteOutput !== quoteInput) {
    fail(
      "PROTOCOL_FEE_UNSUPPORTED",
      "VerifiableTreasuryV2 transfers the full intent amount to the beneficiary and cannot deduct a protocol fee",
    );
  }
  requireText(quote.quoteId, "quote.quoteId");
  requireText(quote.provider, "quote.provider");

  const clientOrderId = parseUnsigned(settlement.clientOrderId, "settlement.clientOrderId");
  if (clientOrderId === 0n) fail("INVALID_CLIENT_ORDER", "settlement.clientOrderId must be non-zero");
  const nonce = parseUnsigned(settlement.nonce, "settlement.nonce");
  const policyDigest = requireBytes32(policy.digest, "policy.digest");
  const clearanceId = requireBytes32(policy.clearanceId, "policy.clearanceId");
  const policyValidUntil = parseTimestamp(policy.validUntil, "policy.validUntil");
  if (policyValidUntil < expiresAt) {
    fail("INVALID_POLICY_VALIDITY", "policy attestation must remain valid through intent expiry");
  }
  if (policy.sanctioned !== false) {
    fail("POLICY_NOT_CLEAR", "the external policy input must explicitly report sanctioned=false");
  }

  const salt = requireBytes32(input.commitmentSalt, "commitmentSalt");
  const canonicalRoute = {
    chainId: chainId.toString(),
    deliveryMode: requireText(route.deliveryMode, "route.deliveryMode"),
    destinationCountry,
    network: routeNetwork,
    originCountry,
    settlementAsset,
  };
  const canonicalQuote = {
    asset: settlementAsset,
    feeAmountBaseUnits: quoteFee.toString(),
    feeBps: feeBps.toString(),
    inputAmountBaseUnits: quoteInput.toString(),
    issuedAt: quoteIssuedAt.toString(),
    outputAmountBaseUnits: quoteOutput.toString(),
    provider: requireText(quote.provider, "quote.provider"),
    quoteId: requireText(quote.quoteId, "quote.quoteId"),
    validUntil: quoteValidUntil.toString(),
  };
  const corridorDigest = domainDigest(ROUTE_DIGEST_DOMAIN, canonicalRoute);
  const quoteDigest = domainDigest(QUOTE_DIGEST_DOMAIN, canonicalQuote);
  const invoiceData = encodeInvoiceData(input.invoiceData);
  const invoiceCommitment = computeInvoiceCommitment({
    chainId,
    verifyingContract,
    payer,
    beneficiary,
    amount,
    corridorDigest,
    clientOrderId,
    invoiceData,
    salt,
  });

  const message = {
    payer,
    beneficiary,
    amount: amount.toString(),
    expiresAt: expiresAt.toString(),
    quoteValidUntil: quoteValidUntil.toString(),
    clearanceId,
    invoiceCommitment,
    policyDigest,
    corridorDigest,
    quoteDigest,
    clientOrderId: clientOrderId.toString(),
    nonce: nonce.toString(),
  };
  const domain = {
    name: "VerifiableTreasury",
    version: "2",
    chainId: chainId.toString(),
    verifyingContract,
  };
  const typedDataDigest = TypedDataEncoder.hash(domain, SETTLEMENT_INTENT_TYPES, message);

  return deepFreeze({
    schema: PLAN_SCHEMA,
    status: "UNSIGNED_REVIEW_REQUIRED",
    deterministicAsOf: asOf.toString(),
    source: {
      synthetic: input.synthetic === true,
      rawInvoiceIncluded: false,
      commitmentSaltIncluded: false,
      invoiceOnlyDigestIncluded: false,
      clearanceCheckedOnchain: false,
    },
    settlementIntent: message,
    eip712: {
      domain,
      primaryType: "SettlementIntent",
      types: SETTLEMENT_INTENT_TYPES,
      message,
      digest: typedDataDigest,
    },
    commitment: {
      algorithm: "keccak256(abi.encode(domain,chainId,contract,payer,beneficiary,amount,route,order,invoiceData,salt))",
      domain: INVOICE_COMMITMENT_DOMAIN,
      invoiceCommitment,
    },
    normalizedRoute: { ...canonicalRoute, corridorDigest },
    normalizedQuote: { ...canonicalQuote, quoteDigest },
    executionEconomics: {
      contractTransferAmountBaseUnits: amount.toString(),
      beneficiaryReceivesBaseUnits: amount.toString(),
      protocolFeeBaseUnits: "0",
      quoteDigestRole: "Commits reviewed quote metadata only; it does not change token transfer accounting.",
    },
    checks: [
      "payer and beneficiary are distinct",
      "amount is non-zero uint128 and equals both quote input and beneficiary output",
      "quote protocol fee is zero because VerifiableTreasuryV2 transfers the full amount to the beneficiary",
      "route crosses distinct countries and matches chain/network/asset",
      "quote is live at planning.asOf and expires no later than the intent",
      "policy metadata remains valid through intent expiry and a non-zero clearance ID is bound",
      "client order is non-zero and nonce is unsigned",
      "invoice commitment is domain-separated exactly as VerifiableTreasuryV2",
    ],
    explanation: [
      `Prepare ${amountText} ${settlementAsset} from ${originCountry} to ${destinationCountry}.`,
      `Bind quote ${canonicalQuote.quoteId}, route ${corridorDigest}, and client order ${clientOrderId}.`,
      "The quote digest commits metadata only; VerifiableTreasuryV2 deducts no fee and pays the full intent amount to the beneficiary.",
      `Bind clearance ${clearanceId}; its live on-chain state must be checked before authorization.`,
      "Keep raw invoice data and its salt outside the public typed data; publish only their commitment.",
      "The payer must independently review and authorize this exact EIP-712 digest.",
    ],
    authorityBoundary: {
      plannerCanAuthorize: false,
      plannerCanSign: false,
      plannerCanBroadcast: false,
      networkCallsPerformed: 0,
      requiredAuthorizer: payer,
    },
    signingPreconditions: [
      "Recheck the selected chain ID and verifying contract in the payer wallet.",
      "Read minimumChallengeWindow from the verifying contract and confirm the configured window still matches.",
      "Read payerNonces(payer) and confirm it still equals the planned nonce.",
      "Confirm the clientOrderId and invoice commitment remain unused on-chain.",
      "Read clearances(clearanceId) plus subjectRisks(payer) and subjectRisks(beneficiary); confirm both parties, policy/route digests, remaining amount capacity, validity, issuer role/epoch, and both live non-sanctioned risk attestations all match.",
      "Recheck quote expiry before authorization and again before funding.",
      "Authorize outside this planner; relay and broadcast are separate actions.",
    ],
    evidenceBoundary: policy.sourceType === "synthetic"
      ? "Synthetic planning evidence only; it is not a live quote, certified screening result, authorization, or transaction."
      : "Offline planning evidence only; the external quote and policy source require independent verification.",
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

module.exports = {
  INVOICE_COMMITMENT_DOMAIN,
  PLAN_SCHEMA,
  QUOTE_DIGEST_DOMAIN,
  ROUTE_DIGEST_DOMAIN,
  SETTLEMENT_INTENT_TYPES,
  PlanValidationError,
  canonicalize,
  computeInvoiceCommitment,
  encodeInvoiceData,
  planSettlementV2,
};
