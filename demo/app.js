const statePill = document.querySelector("#state-pill");
const steps = [...document.querySelectorAll("#timeline li")];
const runButton = document.querySelector("#run-demo");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  steps.forEach((step) => step.classList.remove("active"));
  const labels = ["POLICY VALID", "APPROVED 2/2", "FUNDED", "REVOCABLE", "RECONCILED"];
  for (let index = 0; index < steps.length; index += 1) {
    steps[index].classList.add("active");
    statePill.textContent = labels[index];
    await delay(650);
  }
  runButton.disabled = false;
  document.querySelector("#controls").scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll(".scenario").forEach((button) => {
  button.addEventListener("click", () => {
    const refunded = button.dataset.result === "refunded";
    document.querySelector("#scenario-output").textContent = refunded
      ? "Contract result: settlement → Cancelled; escrow balance → 0; payer receives the full pre-release refund."
      : "Contract result: transaction reverts atomically; settlement state, approval count, and token balances remain unchanged.";
  });
});

fetch("../evidence/benchmark.json").then((response) => response.json()).then((data) => {
  document.querySelector("#tx-count").textContent = data.totals.transactionCount;
  document.querySelector("#gas-total").textContent = Number(data.totals.gasUsed).toLocaleString();
  document.querySelector("#reconciled").textContent = data.reconciliation.passed ? "PASSED" : "FAILED";
}).catch(() => {});

fetch("../evidence/base-sepolia.json").then((response) => response.json()).then((data) => {
  const link = document.querySelector("#explorer-link");
  const release = data.transactions[data.transactions.length - 1];
  link.href = release.explorer;
  document.querySelector("#testnet-status").textContent = `${data.totals.transactionCount} receipts · reconciliation ${data.reconciliation.passed ? "passed" : "failed"}`;
  document.querySelector("#tx-count").textContent = data.totals.transactionCount;
  document.querySelector("#gas-total").textContent = Number(data.totals.gasUsed).toLocaleString();
  document.querySelector("#reconciled").textContent = data.reconciliation.passed ? "PASSED" : "FAILED";
}).catch(() => {});

fetch("../evidence/public-links.json").then((response) => response.json()).then((data) => {
  if (data.repository) document.querySelector("#repo-link").href = data.repository;
}).catch(() => {});
