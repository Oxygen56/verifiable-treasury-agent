# Devpost submission draft

## Title

Verifiable Treasury Agent

## One-line description

An AI-orchestrated, contract-enforced cross-border treasury rail that makes stablecoin settlement approvals, compliance bindings, privacy commitments, cancellation, rollback, and reconciliation independently verifiable.

## Track

Track 1 — Payments and Financial Infrastructure

## Problem

Cross-border treasury teams want the speed of stablecoins and the usability of AI agents, but cannot rely on a model's prose as proof that limits, approvals, sanctions controls, privacy rules, and recovery paths actually ran. Existing demos often optimize for a successful transfer and hide the failure cases that determine whether finance teams can trust the system.

## Solution

Verifiable Treasury Agent separates explanation from authority. An AI may turn an invoice into a proposed plan, but an auditable contract is the only authority that can move state and funds. It binds every settlement to a salted invoice commitment and an expiring compliance-policy digest; applies per-payer daily limits and two-person approval above a threshold; escrows test USDC through a challenge window; rechecks sanctions/policy status at approval and release; and supports pre-release cancellation plus permissionless expiry rollback.

## Key features

1. Deterministic on-chain state machine with role separation and atomic failures.
2. One or two distinct approvals depending on value; daily treasury limit at funding.
3. Expiring compliance attestation and sanctions status rechecked before release.
4. Salted commitments keep raw invoice/KYC data off-chain and enable selective disclosure.
5. Revocable escrow before release, failed-state rollback, and balance reconciliation.
6. Reproducible positive/negative tests plus gas, latency, and reconciliation evidence.

## Who it is for

Treasury operators, payment teams, exporters/importers, compliance approvers, and stablecoin infrastructure providers that need audit-ready controls around automated cross-border settlement.

## Technologies

Solidity, OpenZeppelin Contracts, Hardhat, ethers.js, Base Sepolia, Circle test USDC, static web demo, GitHub Actions.

## Demo script (three minutes)

1. **0:00–0:25 — the risk:** show that an AI recommendation is not authorization; highlight the contract-only trust boundary.
2. **0:25–1:15 — successful route:** propose a 15,000 test-USDC invoice commitment; show two distinct approvals; fund escrow; wait through the challenge window; release; open the transaction receipt and reconciliation.
3. **1:15–2:10 — failure controls:** sanction the beneficiary and show the release reverting with unchanged state; show a daily-limit failure; cancel a funded settlement and verify the payer refund; run expiry rollback.
4. **2:10–2:40 — privacy:** reveal a synthetic invoice plus salt to verify the on-chain commitment; demonstrate that wrong data fails and raw invoice/KYC data is absent from storage/events.
5. **2:40–3:00 — evidence and boundary:** show tests, benchmark JSON, public Base Sepolia explorer links, prior-work/AI disclosure, and the precise limitation that transfers are revocable only before release.

## Evidence checklist

- [x] Public repository URL: https://github.com/Oxygen56/verifiable-treasury-agent
- [x] Public demo URL configured: https://oxygen56.github.io/verifiable-treasury-agent/
- [ ] Base Sepolia contract and deployment transaction
- [ ] At least one full test-USDC settlement transaction sequence
- [x] Test suite result and benchmark artifact
- [x] Supporting PDF: `output/pdf/verifiable-treasury-agent-evidence.pdf`
- [x] Prior-work, AI, dependency, and test-token disclosure
- [ ] Submission form reviewed for AI disclosure or personal legal declarations before final submit
