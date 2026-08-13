# Prior work, AI use, dependencies, data, and evidence disclosure

## Work completed before this hackathon build

Before implementation, the entrant researched the public event pages for eligibility, deadline, judging, tracks, and submission requirements, then drafted the concept of a verifiable cross-border treasury agent. No Verifiable Treasury Agent source code, smart contract, test suite, public deployment, demo site, or prior commercial product existed before this build. The repository history is the implementation record.

## AI use and authority boundary

OpenAI Codex was used extensively as a research, architecture, coding, testing, debugging, and documentation assistant. It helped create the V1/V2 contracts, tests, planner, deployment and verification scripts, demo, and public materials.

AI is not an authority in the runtime. The V2 planner is deterministic and offline: it validates synthetic inputs and prepares an unsigned EIP-712 plan, but contains no signer, wallet, provider, contract call, or transaction transport. A payer signature authorizes the exact intent. Transactions from separate role wallets provide approvals and compliance facts. The Solidity contract deterministically enforces all state transitions, including nonce and replay controls, role separation and epochs, risk freshness, clearance validity and consumption, funding limits, challenge timing, release, cancellation, refund, and solvency accounting.

`evidence/codex-explanation-v2.json` records one read-only Codex CLI explanation run over the synthetic unsigned plan. It was schema-valid, completed in 27.432 seconds, and the CLI reported model `gpt-5.6-sol` plus 20,878 tokens. The prompt requested no network or tool calls, and the run performed no signing, broadcasting, authorization, or state change. The CLI did not report metered API cost, so this repository makes no API-price claim from that run. It demonstrates bounded explanation, not an autonomous agent or verification of current chain state.

Any real deployment's accountable operators remain responsible for reviewing code, controlling keys, assigning roles, providing compliance facts, signing and broadcasting transactions, and accepting all legal, tax, regulatory, and operational obligations. The public proof establishes only distinct test-wallet addresses and their on-chain role activity.

## External tools and dependencies

- Hardhat and Nomic Foundation tooling — MIT license
- OpenZeppelin Contracts — MIT license
- ethers.js — MIT license
- Node.js and pnpm — their respective open-source licenses
- Solidity compiler 0.8.28 — GPL-3.0 license
- Slither — AGPL-3.0 license; used only for local static analysis
- Base Sepolia public RPC and Basescan — public test infrastructure, subject to provider terms and rate limits
- Circle Base Sepolia test-USDC address — an optional deployment adapter exists, but the recorded V2 public run did not use it
- GitHub/GitHub Pages and Devpost — public repository, demo hosting, and contest submission services

The reproducible environment is pinned to Node.js 20 and pnpm 9.15.4. A `pnpm audit` snapshot on 2026-08-13 reported zero moderate, high, or critical advisories and one low-severity, development-only transitive `elliptic` advisory (`GHSA-848j-6mx2-7j84`) through the Hardhat toolchain. CI gates at high severity; the low advisory remains disclosed rather than being described as zero vulnerabilities.

No private key, mnemonic, API secret, or production credential is intended to be committed. Test-only recovery material is stored under a gitignored local path.

The generic `contestctl toolcheck` reports only globally discoverable executables, so its `hardhat=no` and `slither=no` rows do not describe the project-scoped environment. Hardhat 2.29.0 is pinned in `devDependencies` and invoked through pnpm; Slither 0.11.6 was run from the gitignored local `.venv-slither/` environment for the recorded static-analysis evidence.

## Assets, data, and compliance inputs

The verified V2 public run uses a project-deployed token labeled `mUSD`. It has no financial value, is not Circle USDC, is not fiat-backed, and must not be described as a stablecoin settlement with real value.

The SG → CN corridor, invoice records, payer/beneficiary risk records, sanctions update, policy digests, KYC story, FX route, and off-ramp are synthetic test scenarios. No fiat, real customer money, personal KYC record, certified screening feed, production sanctions list, regulated custody, FX execution, or off-ramp is bundled or exercised. The intentionally disclosed sample invoice and salt contain synthetic data only.

Raw invoices and KYC records are designed to remain off-chain. V2 stores salted, domain-separated commitments and evidence/policy digests. This supports selective disclosure; it is not a zero-knowledge proof, privacy certification, or guarantee that a low-entropy preimage cannot be guessed.

## Security and verification boundary

- 40 repository-wide checks passed: 33 current V2 contract/state-path/planner/live-verifier checks plus 7 retained historical V1 controls. The V2-only judge bundle contains and reproduces the 33 current checks; the state-path test exercises 64 deterministic generated paths.
- V2 measured 98.84% statement, 94.44% function, 99.14% line, and 45.45% branch coverage.
- A filtered Slither high/medium triage analyzed 26 contracts with 63 detectors and returned zero findings after documented triage.
- The V2 runtime is 22,427 bytes, with 2,149 bytes of EIP-170 headroom.
- The locally compiled runtime and the Base Sepolia runtime have the same hash after normalizing compiler-declared immutable slots.
- A read-only public-RPC verifier checks all 26 transactions in chain order against their caller, target, method, settlement ID, and critical event values/order. It uses a historical call and trace to decode the sole status-0 release as `BeneficiarySanctioned`, then reconciles final balances, allowance, escrow, states, clearance consumption, invoice disclosure, and solvency.
- The public browser control room has a narrower live-RPC verifier for receipt statuses, terminal states, balances, `totalEscrowed`, and solvency. It has no wallet, signer, or broadcast method and treats RPC unavailability separately from proof failure.

These checks are project-generated evidence. They are not an independent audit, formal verification, exhaustive fuzzing proof, production certification, or regulatory approval. Blockscout publishes the submitted standard-JSON V2 source and reports verified but partial matching with unchanged bytecode; it does not report full verification. The separate bytecode check remains a local compiler-to-chain comparison with immutable slots normalized. Production use would require independent audit, multisig governance, hardened key custody, monitoring, incident response, legal review, and regulated integrations.

## Version history and new work during the event

All contracts, tests, planner/orchestrator code, benchmark and verification scripts, demo assets, submission copy, and public-testnet evidence in this repository were created for NTU CCTF × SNZ InnovateX 2026.

V1 is retained as transparent history. Its public transaction sequence used the same wallet as payer and beneficiary, so it proves only the earlier state-machine mechanics and must not be presented as separate-role settlement. V2 adds the current trust boundary and public evidence: separate payer and beneficiary addresses, EIP-712 payer authorization, permissionless relay, separated roles and membership epochs, current payer/beneficiary risk, two-address sanctions clearing, exact clearances, funded-start challenge timing, status-0 blocking, refund, and reconciled terminal outcomes. These addresses were generated and operated for one public proof; the chain proves distinct addresses and role activity, not independent controllers or organizations.

Any later third-party contribution, external proprietary asset, real data source, or new deployed dependency must be listed here before it is included in a contest update.
