const statePill = document.querySelector("#state-pill");
const steps = [...document.querySelectorAll("#timeline li")];
const runButton = document.querySelector("#run-demo");
const replayButton = document.querySelector("#replay-button");
const scenarioTabs = [...document.querySelectorAll(".scenario-tab")];

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const scenarios = {
  blocked: {
    labels: ["PLAN", "SIGNED", "APPROVED 2/2", "FUNDED · T0", "RISK UPDATED", "CANCELLED"],
    timeline: [
      ["Unsigned intent prepared", "AI explains; no privileged key or broadcast path", "PLAN"],
      ["Payer authorization", "EIP-712 payer-wallet signature", "SIGNED"],
      ["Separate approval wallets", "Approver role wallet A + wallet B", "2 / 2"],
      ["Escrow funded · T0", "Daily limit checked; challenge window starts now", "15K"],
      ["Synthetic sanctions flag updated", "Release rechecks the current policy state", "RISK"],
      ["Release blocked; payer refunded", "No beneficiary transfer; escrow returns to zero", "SAFE"],
    ],
    outcome: "BLOCKED",
    outcomeClass: "danger",
    decisionLabel: "RELEASE DECISION",
    decisionTitle: "DO NOT TRANSFER",
    decisionReason: "The beneficiary’s synthetic policy status changed during the funded challenge window.",
    payer: "15,000 restored",
    payerCaption: "after cancellation",
    escrow: "0",
    escrowCaption: "fully reconciled",
    beneficiary: "0",
    beneficiaryCaption: "release blocked",
    agent: "“Invoice INV-0042 requires two separate approver wallets. I prepared typed data for payer review. I cannot sign or broadcast it.”",
    replayTitle: "Blocked-release replay ready.",
    replayCopy: " Six steps tell the story; none are presented as a live transaction.",
  },
  clean: {
    labels: ["PLAN", "SIGNED", "APPROVED 2/2", "FUNDED · T0", "POLICY CURRENT", "RELEASED"],
    timeline: [
      ["Unsigned intent prepared", "AI explains; no privileged key or broadcast path", "PLAN"],
      ["Payer authorization", "EIP-712 payer-wallet signature", "SIGNED"],
      ["Separate approval wallets", "Approver role wallet A + wallet B", "2 / 2"],
      ["Escrow funded · T0", "Daily limit checked; challenge window starts now", "15K"],
      ["Window elapsed; policy current", "Release conditions are rechecked at execution", "CLEAR"],
      ["Released and reconciled", "Escrow zero; separate beneficiary wallet receives 15,000", "PAID"],
    ],
    outcome: "ALLOWED",
    outcomeClass: "verified",
    decisionLabel: "RELEASE DECISION",
    decisionTitle: "TRANSFER AFTER WINDOW",
    decisionReason: "Two approvals remain valid, current policy status is clear, and the funded-start challenge window has elapsed.",
    payer: "15,000 debited",
    payerCaption: "authorized settlement",
    escrow: "0",
    escrowCaption: "fully reconciled",
    beneficiary: "15,000 received",
    beneficiaryCaption: "separate beneficiary wallet",
    agent: "“All required signatures and policy checks are present. I can explain the release conditions; only the contract can enforce them.”",
    replayTitle: "Clean-release replay ready.",
    replayCopy: " This replays the verified public clean-release receipt; it does not broadcast a new transaction.",
  },
  disclosure: {
    labels: ["PLAN", "SIGNED", "COMMITTED", "FUNDED · T0", "DATA REVEALED", "MATCH"],
    timeline: [
      ["Invoice normalized", "AI prepares structured bytes but cannot authorize", "PLAN"],
      ["Payer authorization", "Payer wallet signs the exact typed settlement intent", "SIGNED"],
      ["Commitment bound", "Invoice bytes + salt are hashed; raw data stays off-chain", "HASH"],
      ["Escrow funded · T0", "Settlement stores only the invoice commitment", "15K"],
      ["Authorized disclosure", "Exact invoice bytes and salt are revealed", "REVEAL"],
      ["Commitment matches", "Tampered bytes would return false without state mutation", "TRUE"],
    ],
    outcome: "MATCH",
    outcomeClass: "safe",
    decisionLabel: "DISCLOSURE DECISION",
    decisionTitle: "COMMITMENT MATCHES",
    decisionReason: "The exact synthetic invoice bytes and authorized salt recompute the stored commitment.",
    payer: "data private",
    payerCaption: "until disclosure",
    escrow: "unchanged",
    escrowCaption: "verification is read-only",
    beneficiary: "data minimized",
    beneficiaryCaption: "no raw KYC on-chain",
    agent: "“I can explain which fields were committed. The verifier—not the model—determines whether revealed bytes and salt match.”",
    replayTitle: "Commitment replay ready.",
    replayCopy: " Correct data matches; tampered data fails without changing settlement state.",
  },
};

let activeScenario = "blocked";
let replaying = false;
let v2Evidence = null;

const explorerAddress = (address) => `https://sepolia.basescan.org/address/${address}`;
const shortHex = (value, start = 8, end = 6) => value ? `${value.slice(0, start)}…${value.slice(-end)}` : "—";
const units = (value) => `${(Number(value) / 1_000_000).toLocaleString()} mUSD`;
const transactionByLabel = (pattern) => v2Evidence?.transactions.find((transaction) => pattern.test(transaction.label));

function proofLink(transaction, label) {
  if (!transaction?.explorer) return "";
  const status = transaction.status === undefined ? "" : ` · status ${transaction.status}`;
  return `<a href="${transaction.explorer}" target="_blank" rel="noopener">${label}${status} ↗</a>`;
}

function renderScenarioReceipts() {
  if (!v2Evidence) return;
  const status = document.querySelector("#receipt-status");
  const copy = document.querySelector("#receipt-copy");
  const links = document.querySelector("#receipt-links");
  const beneficiaryAddress = document.querySelector("#beneficiary-address");
  const cleanRelease = transactionByLabel(/clean settlement releases/);
  const sanctionsUpdate = transactionByLabel(/synthetic sanctions update/);
  const blockedRelease = transactionByLabel(/release blocked on-chain/);
  const refund = transactionByLabel(/full refund/);
  const signedIntent = transactionByLabel(/relayer submits payer-signed intent/);

  if (activeScenario === "blocked") {
    status.textContent = `BLOCKED STATUS ${blockedRelease?.status} · REFUND STATUS ${refund?.status}`;
    copy.textContent = "A synthetic sanctions update lands after funding. Release fails on-chain, then the payer cancels and receives the full refund.";
    links.innerHTML = [
      proofLink(sanctionsUpdate, "Synthetic risk update"),
      proofLink(blockedRelease, "Blocked release"),
      proofLink(refund, "Full refund"),
    ].join("");
    beneficiaryAddress.textContent = shortHex(v2Evidence.roles.beneficiaryBlocked);
    beneficiaryAddress.href = explorerAddress(v2Evidence.roles.beneficiaryBlocked);
    beneficiaryAddress.title = v2Evidence.roles.beneficiaryBlocked;
  } else if (activeScenario === "clean") {
    status.textContent = `CLEAN RELEASE STATUS ${cleanRelease?.status}`;
    copy.textContent = "The clean scenario releases 15,000 mUSD to a beneficiary whose address is distinct from the payer.";
    links.innerHTML = proofLink(cleanRelease, "Clean release");
    beneficiaryAddress.textContent = shortHex(v2Evidence.roles.beneficiaryClean);
    beneficiaryAddress.href = explorerAddress(v2Evidence.roles.beneficiaryClean);
    beneficiaryAddress.title = v2Evidence.roles.beneficiaryClean;
  } else {
    status.textContent = "PUBLIC DISCLOSURE VERIFIED";
    copy.textContent = "The public manifest records the synthetic invoice bytes, public salt, commitment, and verified disclosure result.";
    links.innerHTML = [
      proofLink(signedIntent, "Payer-signed intent"),
      '<a href="../evidence/base-sepolia-v2.json" target="_blank" rel="noopener">Disclosure manifest ↗</a>',
    ].join("");
    beneficiaryAddress.textContent = shortHex(v2Evidence.roles.beneficiaryBlocked);
    beneficiaryAddress.href = explorerAddress(v2Evidence.roles.beneficiaryBlocked);
    beneficiaryAddress.title = v2Evidence.roles.beneficiaryBlocked;
  }
}

function renderV2Evidence(data) {
  v2Evidence = data;
  const final = data.reconciliation.final;
  const blockedRelease = transactionByLabel(/release blocked on-chain/);
  const signedIntent = transactionByLabel(/relayer submits payer-signed intent/);
  const disclosure = data.publicInvoiceDisclosure;
  const commitment = data.scenarios.sanctionsRollback.intent.invoiceCommitment;

  document.querySelector("#payer-address").textContent = shortHex(data.roles.payer);
  document.querySelector("#payer-address").href = explorerAddress(data.roles.payer);
  document.querySelector("#payer-address").title = data.roles.payer;
  document.querySelector("#treasury-link").href = explorerAddress(data.treasury);
  document.querySelector("#treasury-link").title = data.treasury;
  document.querySelector("#treasury-link").textContent = `Treasury ${shortHex(data.treasury)} ↗`;
  document.querySelector("#case-treasury-link").href = explorerAddress(data.treasury);
  document.querySelector("#case-treasury-link").textContent = shortHex(data.treasury);
  document.querySelector("#case-treasury-link").title = data.treasury;
  document.querySelector("#token-address").href = explorerAddress(data.token.address);
  document.querySelector("#token-address").textContent = shortHex(data.token.address);
  document.querySelector("#token-address").title = data.token.address;
  document.querySelector("#intent-proof-link").href = signedIntent.explorer;
  document.querySelector("#v2-tx-count").textContent = data.transactions.length;
  document.querySelector("#clean-final-card").textContent = units(final.beneficiaryClean);
  document.querySelector("#blocked-final-card").textContent = units(final.beneficiaryBlocked);
  document.querySelector("#escrow-final-card").textContent = units(final.escrow);
  document.querySelector("#blocked-status").textContent = `STATUS ${blockedRelease.status}`;
  document.querySelector("#v2-reconciled").textContent = data.reconciliation.passed ? "PASSED" : "FAILED";
  document.querySelector("#v2-escrow").textContent = units(final.escrow);
  document.querySelector("#v2-balance-summary").textContent = `payer ${units(final.payer)} · clean beneficiary ${units(final.beneficiaryClean)} · blocked beneficiary ${units(final.beneficiaryBlocked)}`;
  document.querySelector("#disclosure-invoice").textContent = disclosure.invoiceDataUtf8;
  document.querySelector("#disclosure-commitment").textContent = shortHex(commitment, 10, 8);
  document.querySelector("#disclosure-commitment").title = commitment;
  document.querySelector("#disclosure-salt").textContent = shortHex(disclosure.salt, 10, 8);
  document.querySelector("#disclosure-salt").title = disclosure.salt;
  const disclosureResult = document.querySelector("#disclosure-result");
  disclosureResult.className = `disclosure-result ${disclosure.verified ? "match" : "mismatch"}`;
  disclosureResult.querySelector("b").textContent = disclosure.verified ? "PUBLIC MATCH" : "NOT VERIFIED";
  disclosureResult.querySelector("span").textContent = disclosure.verified
    ? "The public V2 manifest records this exact synthetic disclosure as verified."
    : "The public V2 manifest does not verify this disclosure.";

  scenarios.blocked.payer = units(final.payer);
  scenarios.blocked.payerCaption = "final balance after refund and clean settlement";
  scenarios.blocked.escrow = units(final.escrow);
  scenarios.blocked.beneficiary = units(final.beneficiaryBlocked);
  scenarios.clean.payer = units(final.payer);
  scenarios.clean.payerCaption = "final balance across both public scenarios";
  scenarios.clean.escrow = units(final.escrow);
  scenarios.clean.beneficiary = units(final.beneficiaryClean);
  scenarios.disclosure.escrow = units(final.escrow);
  updateScenario(activeScenario);
}

function updateScenario(name) {
  activeScenario = name;
  const scenario = scenarios[name];
  scenarioTabs.forEach((tab) => {
    const selected = tab.dataset.scenario === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  steps.forEach((step) => step.classList.remove("active", "current"));
  steps.forEach((step, index) => {
    const [title, detail, badge] = scenario.timeline[index];
    step.querySelector("b").textContent = title;
    step.querySelector("span").textContent = detail;
    step.querySelector("em").textContent = badge;
  });
  statePill.textContent = name === "blocked" ? "FUNDED" : name === "clean" ? "READY" : "COMMITTED";
  statePill.className = "state-pill";
  document.querySelector("#outcome-chip").textContent = scenario.outcome;
  document.querySelector("#outcome-chip").className = `status-chip ${scenario.outcomeClass}`;
  document.querySelector("#decision-label").textContent = scenario.decisionLabel;
  document.querySelector("#decision-box").className = `decision-box ${name}`;
  document.querySelector("#decision-title").textContent = scenario.decisionTitle;
  document.querySelector("#decision-reason").textContent = scenario.decisionReason;
  document.querySelector("#payer-balance").textContent = scenario.payer;
  document.querySelector("#payer-caption").textContent = scenario.payerCaption;
  document.querySelector("#escrow-balance").textContent = scenario.escrow;
  document.querySelector("#escrow-caption").textContent = scenario.escrowCaption;
  document.querySelector("#beneficiary-balance").textContent = scenario.beneficiary;
  document.querySelector("#beneficiary-caption").textContent = scenario.beneficiaryCaption;
  document.querySelector("#agent-copy").textContent = scenario.agent;
  document.querySelector("#replay-title").textContent = scenario.replayTitle;
  document.querySelector("#replay-copy").textContent = scenario.replayCopy;
  replayButton.textContent = name === "disclosure" ? "Replay verification" : "Replay six decisions";
  renderScenarioReceipts();
}

async function replayScenario() {
  if (replaying) return;
  replaying = true;
  runButton.disabled = true;
  replayButton.disabled = true;
  document.querySelector("#control-room").scrollIntoView({ behavior: "smooth", block: "start" });
  const scenario = scenarios[activeScenario];
  steps.forEach((step) => step.classList.remove("active", "current"));

  for (let index = 0; index < steps.length; index += 1) {
    if (index > 0) steps[index - 1].classList.remove("current");
    steps[index].classList.add("active", "current");
    statePill.textContent = scenario.labels[index];
    await delay(470);
  }

  steps[steps.length - 1].classList.remove("current");
  statePill.classList.add(activeScenario === "blocked" ? "blocked" : "complete");
  replaying = false;
  runButton.disabled = false;
  replayButton.disabled = false;
}

scenarioTabs.forEach((tab) => tab.addEventListener("click", () => updateScenario(tab.dataset.scenario)));
runButton.addEventListener("click", async () => {
  updateScenario("blocked");
  await replayScenario();
});
replayButton.addEventListener("click", replayScenario);

document.querySelectorAll("[data-disclosure]").forEach((button) => {
  button.addEventListener("click", () => {
    const result = document.querySelector("#disclosure-result");
    const matches = button.dataset.disclosure === "match";
    result.className = `disclosure-result ${matches ? "match" : "mismatch"}`;
    result.querySelector("b").textContent = matches ? "PUBLIC MATCH" : "TAMPER REJECTED";
    result.querySelector("span").textContent = matches
      ? "The public manifest records the exact synthetic invoice and salt as verified."
      : "V2 local tests prove that changed invoice fields do not match the stored commitment.";
  });
});

fetch("../evidence/base-sepolia-v2.json")
  .then((response) => {
    if (!response.ok) throw new Error("V2 public evidence unavailable");
    return response.json();
  })
  .then(renderV2Evidence)
  .catch(() => {
    document.querySelector("#receipt-status").textContent = "PUBLIC EVIDENCE UNAVAILABLE";
    document.querySelector("#receipt-copy").textContent = "Reload the page or inspect the repository manifest directly.";
    document.querySelector("#v2-reconciled").textContent = "UNAVAILABLE";
  });

fetch("../evidence/public-links.json")
  .then((response) => response.json())
  .then((data) => {
    if (data.repository) document.querySelector("#repo-link").href = data.repository;
  })
  .catch(() => {});

updateScenario("blocked");
