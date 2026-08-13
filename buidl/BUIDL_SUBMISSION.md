# Verifiable Treasury Agent V2 — BUIDL Submission

## One-line pitch

An AI-orchestrated treasury agent where a payer-signed EIP-712 intent and a Base Sepolia contract—not model output—enforce separate-role-wallet approval, current risk policy, revocable escrow, failure rollback, and exact reconciliation.

## Problem

Stablecoin treasury teams can use AI to prepare and explain payments, but a model's prose cannot prove that the payer authorized the exact transaction, distinct role-wallet approvals were current, sanctions policy was rechecked, or a failed settlement remained recoverable. A credible financial agent needs verifiable controls for both the happy path and the failure path.

## Solution

Verifiable Treasury Agent V2 separates orchestration from authority:

- A deterministic offline planner validates a synthetic invoice and prepares unsigned EIP-712 typed data. It contains no signer, wallet, provider, contract call, or transaction transport.
- The payer signs the beneficiary, amount, route, quote, clearance, invoice commitment, order, expiry, and monotonic nonce. A permissionless relayer may submit the unchanged intent but cannot authorize or modify it.
- Administrator, operator, approver, compliance, payer, and beneficiary roles are mutually separated. High-value settlements require two distinct live approver addresses. Membership epochs prevent revoke-and-regrant from reviving old approvals or compliance credentials.
- Both payer and beneficiary need current risk attestations. One compliance address may fail closed by flagging sanctions; clearing a flag requires two distinct, currently authorized compliance addresses.
- Append-only clearances bind payer, beneficiary, route, policy, amount ceiling, validity, issuer epoch, and risk epochs. They track lifetime consumption and can be precisely revoked.
- A salted, domain-separated invoice commitment binds the private preimage to the chain, contract, payer, beneficiary, amount, route, and order. This enables selective disclosure without claiming zero-knowledge privacy.
- The challenge window starts when escrow is funded. Release rechecks live risk, clearance, approval, expiry, and accounting conditions. Cancellation and permissionless expiry rollback return pre-release escrow.

## Judge-facing demo

- Live evidence replay: https://oxygen56.github.io/verifiable-treasury-agent/
- Public source: https://github.com/Oxygen56/verifiable-treasury-agent
- Devpost: https://devpost.com/software/verifiable-treasury-agent
- Narrated walkthrough: `output/video/verifiable-treasury-agent-v2-demo.mp4` (114.4 seconds, 1080p)
- Local verification: `pnpm install --frozen-lockfile && pnpm check`
- Local demo: `pnpm demo`, then open `http://localhost:4173`
- Deterministic unsigned planner: `node scripts/plan-settlement-v2.js evidence/sample-invoice-v2.json`

The demo reads the committed V2 manifest and can freshly verify the 26 receipt statuses, terminal states, balances, escrow liability, and solvency through a public Base Sepolia RPC. It does not connect a wallet, sign, or broadcast a transaction.

## Public Base Sepolia evidence

The primary V2 manifest is `evidence/base-sepolia-v2.json`. It records **26 public transaction receipts: 25 successful transactions plus one intentionally submitted, expected failed release with `status 0`**.

| Outcome | Evidence |
| --- | --- |
| Clean settlement | A payer-signed intent is relayed, receives two approvals, is funded, and releases 15,000 mUSD to a beneficiary address distinct from the payer |
| Fail-closed settlement | A different beneficiary is flagged by a synthetic sanctions update after funding; release fails on-chain with `status 0` and no transfer |
| Recovery | The payer cancels the blocked settlement and receives the full 15,000 mUSD refund |
| Final reconciliation | Payer 15,000 mUSD; clean beneficiary 15,000 mUSD; blocked beneficiary 0; escrow 0; `totalEscrowed = 0`; solvent |

- V2 treasury: https://sepolia.basescan.org/address/0x7B92aB3D8BA17cF5f28C60E5c1FC326862dD6395
- V2 deployment: https://sepolia.basescan.org/tx/0x538ac7ec618ee8646bc1932a2243741da8caaeaa28ce7cd1824766c7ae56657d
- Clean release: https://sepolia.basescan.org/tx/0xb1d2be7aee2381be2c7e7040b44eb669b36c656cc7bc14e83b7e161a16fa3d43
- Synthetic sanctions update: https://sepolia.basescan.org/tx/0x8f02b805473b985bde2736cadc6b620664f6656eabfa156b4057268e2be2b6f8
- Expected failed release (`status 0`): https://sepolia.basescan.org/tx/0xf4be9274fc867ae0efea504966649f37bbce6dfcbb797c92ec0ce3f22031f8db
- Full refund: https://sepolia.basescan.org/tx/0x251b3f969c6dedc06dbbe84866717511c26220f80f53e17e3065945753236b07

The manifest proves that the payer, two beneficiaries, two approvers, two compliance actors, and relayer were separate **test-wallet addresses with separated on-chain roles**. It does not prove that each address was controlled by an independent human or organization.

## Verification record

- **40 repository-wide passing checks:** 33 current V2 contract/state-path/planner/live-verifier checks plus 7 retained historical V1 controls. The V2-only judge bundle reproduces the 33 current checks.
- **64 deterministic generated state paths** check solvency, exact conservation, nonce monotonicity, and terminal-state exclusivity. They are not formal verification or an exhaustive fuzzing proof.
- **V2 coverage:** 98.84% statements, 94.44% functions, 99.14% lines, and 45.45% branches.
- **Slither triage:** 26 contracts and 63 detectors returned zero findings in the filtered high/medium scan after documented triage. This is not an independent audit.
- **Deployability:** the V2 runtime is 22,427 bytes, leaving 2,149 bytes below the EIP-170 limit.
- **Source and bytecode evidence:** Blockscout publishes the standard-JSON V2 source and constructor arguments, reports verified/partial matching and unchanged bytecode, but not full verification. Local and Base Sepolia runtime bytecode are both 22,427 bytes and have the same hash after normalizing compiler-declared immutable slots.
- **Deep public verifier:** all 26 transactions are reconstructed in chain order with caller, target, method, settlement ID, and event checks; the sole failed release is decoded as `BeneficiarySanctioned`, then balances, allowance, escrow, clearances, disclosure, and solvency reconcile.
- **Bounded AI trace:** a real read-only Codex run using the CLI-reported `gpt-5.6-sol` model produced a schema-valid explanation in 27.432 seconds, reported 20,878 tokens, and performed no signing, broadcast, authorization, or state change. The CLI did not report metered API cost, so no cost is claimed.

Recorded outputs are retained under `experiments/runs/`, including final regression, coverage, Slither triage, public deployment, and local-to-on-chain bytecode comparison.

## Judging rubric mapping

- **Technical implementation:** payer authorization, replay protection, role and credential epochs, funded-start challenge timing, exact-balance escrow, two terminal public paths, and reconciled accounting.
- **Innovation:** AI is deliberately useful but non-authoritative; the most important demo is a real on-chain failure and recovery rather than only a successful transfer.
- **Impact:** the first target user is a regional treasury lead moving from invoice to payer signature, separated approval, risk change, refusal/refund, and reconciliation. A future pilot would measure approval time, policy-triggered blocks, recovery time, reconciliation exceptions, and manual interventions; no pilot, adoption, or savings result is claimed yet.
- **Demo quality:** a public control room replays the committed manifest, can freshly re-read the core Base Sepolia proof, and links directly to the deployment, clean release, status-0 failure, refund, and disclosure evidence.
- **Track relevance:** the prototype explores auditable payment infrastructure and agent orchestration without granting a model unilateral control of funds.

## Release bundle contents

The judge/reviewer bundle must include:

- `README.md`, `SUBMISSION.md`, `DISCLOSURE.md`, and `LICENSE`;
- `contracts/`, `src/`, `test/`, `scripts/`, `demo/`, and `docs/`;
- public `evidence/`, led by `base-sepolia-v2.json` and `sample-invoice-v2.json`, with `evidence/private/` excluded;
- relevant recorded outputs under `experiments/runs/`;
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `hardhat.config.js`;
- `.github/workflows/verify.yml` and the generated `buidl/` submission files.

Private keys, mnemonics, `.env`, test-wallet recovery material, caches, dependencies, compiler artifacts, and coverage working directories must not be included.

## Claim boundary

The recorded asset is a project-deployed, valueless **mUSD test token**. It is not USDC, not fiat-backed, and not money. The SG → CN corridor, invoice, KYC/risk facts, sanctions update, policy data, FX, and off-ramp are synthetic. No real cross-border or production settlement occurred.

This project is public-testnet evidence, not an independent security audit, formal verification, privacy certification, certified sanctions-screening service, regulatory approval, production key-management system, or real-funds safety claim. Salted commitments provide selective disclosure, not zero-knowledge privacy. Revocability ends at release.

V1 remains as transparent historical state-machine evidence. Its public run used the same wallet as payer and beneficiary; all current separate-role-address and fail-closed public claims are based on V2.
