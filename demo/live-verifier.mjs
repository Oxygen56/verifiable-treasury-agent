const DEFAULT_RPC_URL = "https://base-sepolia-rpc.publicnode.com";
const EXPECTED_CHAIN_ID = 84532n;
const SELECTORS = Object.freeze({
  balanceOf: "70a08231",
  totalEscrowed: "f9168231",
  escrowIsSolvent: "67d4cf15",
  settlements: "08df7dc8",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function hexQuantity(value) {
  assert(typeof value === "string" && /^0x[0-9a-f]+$/i.test(value), `Invalid RPC quantity: ${value}`);
  return BigInt(value);
}

export function encodeAddressCall(selector, address) {
  assert(/^[0-9a-f]{8}$/i.test(selector), "Invalid function selector");
  assert(/^0x[0-9a-f]{40}$/i.test(address), `Invalid address: ${address}`);
  return `0x${selector}${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function encodeUintCall(selector, value) {
  assert(/^[0-9a-f]{8}$/i.test(selector), "Invalid function selector");
  return `0x${selector}${BigInt(value).toString(16).padStart(64, "0")}`;
}

export function decodeWord(data, index = 0) {
  assert(typeof data === "string" && /^0x[0-9a-f]*$/i.test(data), "Invalid eth_call result");
  const start = 2 + (index * 64);
  const word = data.slice(start, start + 64);
  assert(word.length === 64, `Missing ABI word ${index}`);
  return BigInt(`0x${word}`);
}

export function expectedReceiptStatus(row) {
  return row.label.includes("release blocked on-chain") ? 0n : 1n;
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

export function createRpcClient(url = DEFAULT_RPC_URL, fetchImpl = globalThis.fetch) {
  assert(typeof fetchImpl === "function", "Fetch is unavailable");
  let nextId = 1;
  return async (method, params) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: controller.signal,
      });
      assert(response.ok, `RPC HTTP ${response.status}`);
      const payload = await response.json();
      assert(!payload.error, payload.error?.message || `${method} failed`);
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function ethCall(rpc, to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

export async function verifyLiveEvidence(evidence, { rpc = createRpcClient(), concurrency = 3 } = {}) {
  assert(evidence?.chainId === "84532", "Manifest chain mismatch");
  assert(Array.isArray(evidence.transactions) && evidence.transactions.length === 26, "Expected the closed 26-receipt transcript");
  assert(/^0x[0-9a-f]{40}$/i.test(evidence.treasury), "Invalid treasury address");
  assert(/^0x[0-9a-f]{40}$/i.test(evidence.token?.address), "Invalid token address");

  const startedAt = performance.now();
  const chainId = hexQuantity(await rpc("eth_chainId", []));
  assert(chainId === EXPECTED_CHAIN_ID, `RPC returned chain ${chainId}, expected 84532`);

  const receipts = await mapLimit(evidence.transactions, concurrency, async (row) => {
    const receipt = await rpc("eth_getTransactionReceipt", [row.hash]);
    assert(receipt, `Receipt unavailable: ${row.label}`);
    assert(receipt.transactionHash?.toLowerCase() === row.hash.toLowerCase(), `Receipt hash mismatch: ${row.label}`);
    const status = hexQuantity(receipt.status);
    assert(status === expectedReceiptStatus(row), `Unexpected status for ${row.label}`);
    return { label: row.label, status, blockNumber: hexQuantity(receipt.blockNumber) };
  });

  const code = await rpc("eth_getCode", [evidence.treasury, "latest"]);
  assert(typeof code === "string" && code.length > 2, "Treasury bytecode is unavailable");

  const balance = (address) => ethCall(rpc, evidence.token.address, encodeAddressCall(SELECTORS.balanceOf, address));
  const [cleanData, blockedData, totalEscrowedData, solventData, payerData, cleanBalanceData, blockedBalanceData, escrowData, blockNumberData] = await Promise.all([
    ethCall(rpc, evidence.treasury, encodeUintCall(SELECTORS.settlements, 1)),
    ethCall(rpc, evidence.treasury, encodeUintCall(SELECTORS.settlements, 2)),
    ethCall(rpc, evidence.treasury, `0x${SELECTORS.totalEscrowed}`),
    ethCall(rpc, evidence.treasury, `0x${SELECTORS.escrowIsSolvent}`),
    balance(evidence.roles.payer),
    balance(evidence.roles.beneficiaryClean),
    balance(evidence.roles.beneficiaryBlocked),
    balance(evidence.treasury),
    rpc("eth_blockNumber", []),
  ]);

  const final = evidence.reconciliation.final;
  const cleanState = decodeWord(cleanData, 14);
  const blockedState = decodeWord(blockedData, 14);
  const totalEscrowed = decodeWord(totalEscrowedData);
  const solvent = decodeWord(solventData) === 1n;
  const balances = {
    payer: decodeWord(payerData),
    beneficiaryClean: decodeWord(cleanBalanceData),
    beneficiaryBlocked: decodeWord(blockedBalanceData),
    escrow: decodeWord(escrowData),
  };

  assert(cleanState === BigInt(final.cleanState), "Clean settlement state changed");
  assert(blockedState === BigInt(final.blockedState), "Blocked settlement state changed");
  assert(totalEscrowed === BigInt(final.totalEscrowed), "Escrow liability changed");
  assert(solvent === final.solvent, "Solvency result changed");
  for (const [name, value] of Object.entries(balances)) {
    assert(value === BigInt(final[name]), `${name} balance changed`);
  }

  const failed = receipts.filter((receipt) => receipt.status === 0n);
  const successful = receipts.length - failed.length;
  assert(failed.length === 1, "Expected exactly one failed release receipt");

  return {
    chainId,
    blockNumber: hexQuantity(blockNumberData),
    receiptCount: receipts.length,
    successful,
    failed: failed.length,
    cleanState,
    blockedState,
    totalEscrowed,
    solvent,
    balances,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

async function runBrowserVerification(button) {
  const badge = document.querySelector("#live-proof-badge");
  button.disabled = true;
  badge.className = "status-chip safe";
  badge.textContent = "READING RPC";
  setText("#live-proof-title-result", "Checking public chain data…");
  setText("#live-proof-message", "Reading receipts and final state without a wallet connection.");
  setText("#live-proof-foot", "Public RPC request in progress; no transaction can be created.");
  try {
    const response = await fetch("../evidence/base-sepolia-v2.json", { cache: "no-store" });
    assert(response.ok, "Public evidence manifest unavailable");
    const evidence = await response.json();
    const result = await verifyLiveEvidence(evidence);
    badge.className = "status-chip verified";
    badge.textContent = "LIVE PASS";
    setText("#live-proof-title-result", "Fresh chain state matches the evidence");
    setText("#live-proof-message", "The public RPC returned the closed transcript and both reconciled terminal outcomes.");
    setText("#live-proof-receipts", `${result.receiptCount} · ${result.successful} pass`);
    setText("#live-proof-failure", `${result.failed} · status 0`);
    setText("#live-proof-states", `Released ${result.cleanState} · Cancelled ${result.blockedState}`);
    setText("#live-proof-solvency", `${result.totalEscrowed} mUSD · ${result.solvent ? "solvent" : "failed"}`);
    setText("#live-proof-foot", `Read at Base Sepolia block ${result.blockNumber.toLocaleString()} in ${(result.elapsedMs / 1000).toFixed(1)} s. Read-only; no wallet or broadcast.`);
  } catch (error) {
    badge.className = "status-chip danger";
    badge.textContent = "RPC UNAVAILABLE";
    setText("#live-proof-title-result", "Live check could not complete");
    setText("#live-proof-message", error.message || "The public RPC did not respond.");
    setText("#live-proof-foot", "This is an availability failure, not a changed on-chain claim. Use the manifest, explorer links, or repository verifier.");
  } finally {
    button.disabled = false;
  }
}

if (typeof document !== "undefined") {
  const button = document.querySelector("#verify-live-chain");
  button?.addEventListener("click", () => runBrowserVerification(button));
}
