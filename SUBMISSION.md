# Devpost submission record — V2

## Title

Verifiable Treasury Agent

## One-line description

An AI-orchestrated treasury agent where the payer signs an exact intent and a Base Sepolia contract verifiably enforces separated role approvals, current risk policy, revocable escrow, failure rollback, and reconciliation.

## Track

Track 1 — Payments and Financial Infrastructure

## Problem

Cross-border treasury teams want stablecoin speed and AI usability, but an AI explanation cannot prove that a payment was authorized, approved by distinct role wallets, screened under current policy, or safely recoverable. Most demos optimize for the happy-path transfer; finance teams need evidence for the failure path.

## Solution

Verifiable Treasury Agent V2 makes AI useful without making it trusted. A deterministic planner converts a synthetic invoice into an unsigned EIP-712 plan. The payer signs the exact beneficiary, amount, route, quote, compliance clearance, commitment, order, expiry, and nonce. Separate approver and compliance role wallets then act through mutually exclusive roles, while the contract alone controls escrow and settlement state.

Risk attestations expire, sanctions block release immediately, and removing and re-adding a role cannot revive old authority. High-value transfers need two distinct live approver addresses; clearing a sanctions flag needs two distinct, currently authorized compliance-role addresses. The challenge period starts at funding. If policy changes before release, the transaction fails atomically and the payer can recover the full escrow.

Raw invoice and KYC records stay off-chain. A salted, domain-separated commitment binds the exact private invoice to this chain, contract, payer, beneficiary, amount, route, and order, allowing later selective disclosure without claiming zero-knowledge privacy.

## Why it matters

The product turns a financial agent's recommendation into an inspectable authorization and control trail. Treasury, compliance, and audit teams can inspect which address authorized this payment, which policy and route were bound, which approvals were current, what blocked release, and whether every token reconciled. The chain does not identify the people or organizations behind those addresses.

The first target user is a regional treasury lead managing the workflow from invoice intake to payer signature, separated approval, risk-change review, refusal or refund, and reconciliation. A future pilot would measure approval cycle time, expired or risk-triggered blocks, refund recovery time, reconciliation exceptions, and manual interventions. No customer pilot, user adoption, savings, or process-improvement result has been measured yet.

The AI layer is evidenced narrowly. A read-only Codex CLI run using the CLI-reported `gpt-5.6-sol` model produced a schema-valid explanation of the unsigned synthetic V2 plan in 27.432 seconds and reported 20,878 tokens. The run made no requested tool or network calls and performed no signing, broadcasting, authorization, or state change. The CLI did not report an API billing amount, so no cost is claimed. This is explanation evidence, not an autonomous treasury agent or proof of live on-chain state.

## What is publicly proven

- 26 Base Sepolia transaction receipts across a clean release and a sanctions-triggered rollback.
- Distinct test-wallet addresses for the payer, two beneficiaries, two approvers, two compliance roles, and relayer.
- Payer-signed EIP-712 intent submitted by a permissionless relayer.
- Two approvals from distinct role wallets before funding 15,000 mUSD.
- A post-funding synthetic sanctions update followed by an actual failed release transaction with `status 0`.
- Full 15,000 mUSD refund on cancellation; blocked beneficiary remains at zero.
- Separate clean settlement releases 15,000 mUSD to a beneficiary distinct from the payer.
- Final escrow and `totalEscrowed` are zero; reconciliation passes and solvency is true.
- Public selective disclosure recomputes the synthetic invoice commitment.
- Read-only Codex explanation artifact: `evidence/codex-explanation-v2.json`.

The public asset is project-deployed, valueless mUSD, not USDC and not fiat-backed. SG → CN, sanctions/KYC, invoice, FX, and off-ramp inputs are synthetic; this is not a real cross-border or production settlement.

## Technical evidence

- 37 repository-wide checks passed: 30 current V2 contract/state-path/planner checks plus 7 retained historical V1 controls. The V2-only judge bundle reproduces the 30 current checks.
- 64 deterministic generated state paths checking solvency, conservation, nonce monotonicity, and terminal-state exclusivity.
- V2 coverage: 98.84% statements, 94.44% functions, 99.14% lines, 45.45% branches.
- Filtered Slither high/medium triage: 26 contracts, 63 detectors, zero findings after documented triage.
- V2 runtime: 22,427 bytes, 2,149 bytes below EIP-170.
- Local and on-chain runtime hashes match after normalizing compiler-declared immutable slots.
- A read-only public-RPC verifier checks all 26 transactions in chain order against their caller, target, method, settlement ID, and critical event values/order; it independently decodes the sole status-0 release as `BeneficiarySanctioned` and reconciles final balances and state.
- Public execution: 9,303,697 gas and 0.000055950883453125 test ETH across all 26 receipts; 736 seconds from first to last public block; 7.499-second median observed confirmation latency for a retained nine-transaction client sample.

These are reproducible engineering checks, not an independent security audit or formal verification. Third-party explorer source verification is not complete.

## Technologies

Solidity 0.8.28, OpenZeppelin Contracts, EIP-712, Hardhat, ethers.js, Node.js/pnpm, Base Sepolia, Slither, static HTML/CSS/JavaScript, GitHub Actions.

## Three-minute demo

1. **0:00–0:25 — why prose is not authority.** Show the AI-safe planner producing an unsigned intent. Point out that it has no wallet, signer, provider, or transaction transport.
2. **0:25–1:05 — authorization and separation.** Show the payer's EIP-712-bound intent, distinct payer/beneficiary/relayer addresses, two distinct approval-wallet receipts, and funded-start challenge window.
3. **1:05–1:50 — the differentiating failure path.** Open the synthetic sanctions update, the release receipt with `status 0`, unchanged beneficiary balance, and the cancellation receipt returning the full 15,000 mUSD.
4. **1:50–2:20 — clean terminal path and accounting.** Open the clean release to the other beneficiary and the final reconciliation: payer 15,000; clean beneficiary 15,000; blocked beneficiary 0; escrow 0; solvent.
5. **2:20–2:40 — selective disclosure.** Reveal the intentionally public synthetic invoice and salt, recompute the bound commitment, then state that real records remain off-chain and this is not ZK privacy.
6. **2:40–3:00 — evidence and honest boundary.** Show 37 repository-wide checks, 64 paths, coverage, Slither triage, bytecode match, and the explicit mUSD/synthetic/non-production limitations.

## Evidence links

- Live demo: https://oxygen56.github.io/verifiable-treasury-agent/
- Public repository: https://github.com/Oxygen56/verifiable-treasury-agent
- Devpost: https://devpost.com/software/verifiable-treasury-agent
- V2 treasury: https://sepolia.basescan.org/address/0x7B92aB3D8BA17cF5f28C60E5c1FC326862dD6395
- V2 deployment: https://sepolia.basescan.org/tx/0x538ac7ec618ee8646bc1932a2243741da8caaeaa28ce7cd1824766c7ae56657d
- Clean fund: https://sepolia.basescan.org/tx/0x3daa6fd5ecf0fd5491b907ece3dbf7650fa72c6fbc18d0f897c4bd3c898e26da
- Clean release: https://sepolia.basescan.org/tx/0xb1d2be7aee2381be2c7e7040b44eb669b36c656cc7bc14e83b7e161a16fa3d43
- Sanctions update: https://sepolia.basescan.org/tx/0x8f02b805473b985bde2736cadc6b620664f6656eabfa156b4057268e2be2b6f8
- Failed release (`status 0`): https://sepolia.basescan.org/tx/0xf4be9274fc867ae0efea504966649f37bbce6dfcbb797c92ec0ce3f22031f8db
- Full refund: https://sepolia.basescan.org/tx/0x251b3f969c6dedc06dbbe84866717511c26220f80f53e17e3065945753236b07
- Complete manifest: `evidence/base-sepolia-v2.json`

## Version and disclosure record

V2 is the current architecture. V1 remains inspectable history, but its public run used the same wallet as payer and beneficiary and proves only the earlier state machine, not separate-role settlement. The V2 run proves distinct role addresses and on-chain actions, not independent controllers or organizations. All code and evidence are hackathon work; prior concept research, extensive Codex assistance, dependencies, synthetic data, and claim boundaries are disclosed in `DISCLOSURE.md`.

The Devpost submission was confirmed, with editing shown until August 14, 2026 at 11:45 AM EDT / August 14, 2026 at 23:45 Beijing time. No separate AI Disclosure or personal legal declaration appeared in the reviewed form; AI use is disclosed in the project materials.
