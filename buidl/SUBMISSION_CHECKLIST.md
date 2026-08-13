# V2 submission checklist

## Public story and judge path

- [x] `README.md`, `SUBMISSION.md`, and `docs/ARCHITECTURE.md` present V2 as the current architecture.
- [x] Live demo and public repository URLs are present.
- [x] Three-minute demo path covers authorization, separate-role-wallet approval, status-0 blocking, full refund, clean release, reconciliation, and selective disclosure.
- [x] V1 is labeled historical; its same-wallet public run is not used as separate-party evidence.
- [x] No claim of contest rank or being the strongest submission is made.

## V2 implementation

- [x] `contracts/VerifiableTreasuryV2.sol` is included with EIP-712 payer authorization, nonce/replay protection, separated roles, membership epochs, risk freshness, exact clearances, funded-start challenge timing, release, cancellation, expiry rollback, and solvency accounting.
- [x] `src/orchestrator-v2.js` and `scripts/plan-settlement-v2.js` are included as the deterministic no-authority planning boundary.
- [x] The planner contains no signer, wallet, provider, contract call, or transaction transport.
- [x] V2 contract, invariant/state-path, and orchestrator test sources are included.

## Public evidence

- [x] Primary manifest is `evidence/base-sepolia-v2.json`.
- [x] Manifest contains 26 public receipts: 25 successful transactions and one expected failed release with `status 0`.
- [x] V2 treasury address, deployment, clean release, synthetic sanctions update, failed release, and refund links are present.
- [x] Public final state reconciles to payer 15,000 mUSD, clean beneficiary 15,000 mUSD, blocked beneficiary 0, escrow 0, `totalEscrowed = 0`, and solvent.
- [x] Payer, beneficiaries, approvers, compliance actors, and relayer are described as distinct test-wallet addresses/on-chain roles, not proven independent humans or organizations.
- [x] Synthetic invoice disclosure and salt are explicitly labeled intentionally public test data.
- [x] A 114.4-second narrated 1080p walkthrough opens with the status-0 block and refund, and preserves the mUSD/synthetic/non-production boundary.
- [x] A real read-only, schema-valid Codex explanation trace is public and explicitly non-authoritative.

## Reproducible verification

- [x] `pnpm install --frozen-lockfile && pnpm check` is the clean local verification path.
- [x] 40 repository-wide passing checks are recorded as 33 current V2 checks plus 7 retained historical V1 controls; the V2-only bundle reproduces the 33 current checks.
- [x] 64 deterministic generated paths are labeled stateful regression, not formal verification or exhaustive fuzzing.
- [x] V2 coverage is reported completely: 98.84% statements, 94.44% functions, 99.14% lines, and 45.45% branches.
- [x] Filtered Slither high/medium triage is reported as 26 contracts, 63 detectors, zero findings after triage, and not an independent audit.
- [x] Runtime size is reported as 22,427 bytes with 2,149 bytes of EIP-170 headroom.
- [x] Local-to-on-chain bytecode match is qualified as immutable-normalized compiler evidence; third-party explorer source verification is not claimed.
- [x] Relevant regression, coverage, Slither, deployment, and bytecode outputs are retained under `experiments/runs/`.
- [x] The deep public verifier reconstructs all 26 transactions and decodes the sole status-0 release as `BeneficiarySanctioned`.

## Claim and disclosure boundary

- [x] mUSD is explicitly labeled a project-deployed, valueless test token that is not USDC and not fiat-backed.
- [x] SG → CN, invoice, KYC/risk, sanctions, policy, FX, and off-ramp inputs are explicitly labeled synthetic.
- [x] No real cross-border, production, or real-funds settlement claim is made.
- [x] Selective disclosure is not described as zero-knowledge privacy.
- [x] Project checks are not described as an independent audit, formal proof, privacy certification, regulatory approval, or production safety certification.
- [x] Third-party source verification and production key management are identified as incomplete.
- [x] Prior work, AI use, dependencies, test assets, synthetic data, V1 history, and evidence limitations are disclosed in `DISCLOSURE.md`.

## Release bundle completeness

- [x] Narrative and legal files: `README.md`, `SUBMISSION.md`, `DISCLOSURE.md`, `LICENSE`.
- [x] Implementation: `contracts/`, `src/`, `scripts/`.
- [x] Verification: `test/`, public `evidence/`, relevant `experiments/runs/`.
- [x] Judge experience: `demo/`, `docs/`, `output/pdf`, `output/images`, `output/video`, generated `buidl/` files.
- [x] Reproducible environment: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `hardhat.config.js`.
- [x] Automation: `.github/workflows/verify.yml`.
- [x] Apache-2.0 project license is included.
- [x] `evidence/private/`, `.env`, private keys, mnemonics, test-wallet recovery material, `node_modules/`, caches, compiler artifacts, and coverage working directories are excluded from the release bundle.
- [x] Public materials contain no secret or private recovery data.
