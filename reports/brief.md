# NTU InnovateX 2026 execution brief

## Hard gates

- Official entry: https://ntu-cctf-snz-innovatex-2026.devpost.com/
- Safe submission deadline: **2026-08-14 23:45 Beijing / Singapore time**. This earlier platform timestamp is the operating cutoff where official text conflicts.
- Target: Public Group, Track 1. The current entry is solo.
- Stage 1 requires the project narrative and supporting evidence. Repository, demo, screenshots, public receipts, and the evidence PDF are prepared.
- If selected, Stage 2 requires an onsite representative in Singapore from 2026-08-21 to 2026-08-23. Attendance, travel spending, and personal declarations remain separate user decisions.

## Winning thesis

Most payment-agent demos showcase a successful transfer. Verifiable Treasury Agent V2 makes the refusal path the product: an unsigned AI-assisted plan becomes a payer-signed EIP-712 intent; separate role wallets attest and approve; a funded settlement is blocked by a later synthetic risk update; the EVM records a real `status 0` release; cancellation returns the full escrow; and final balances reconcile to zero liability.

## Judging map

| Criterion | Weight | Current evidence |
| --- | ---: | --- |
| Technical implementation | 30% | Hardened Solidity V2, 40 repository-wide checks, 64 deterministic paths, 99.14% V2 line coverage, Slither triage, 22,427-byte deployable runtime, 26 deeply verified public receipts, browser-side live RPC recheck |
| Impact | 25% | Regional-treasury workflow from invoice to signature, separated approval, risk-change refusal/refund, and reconciliation; explicit future pilot KPIs without claiming adoption or savings |
| Innovation | 20% | Real schema-constrained Codex explanation without signing authority; domain-bound disclosure; revoke/regrant-safe roles; on-chain negative-control receipt |
| Presentation/demo | 15% | Hosted evidence control room, 114.4-second narrated walkthrough, two terminal outcomes, public explorer links, screenshots, and four-page evidence brief |
| Track relevance | 10% | Treasury settlement controls and payment infrastructure operating boundary on Base Sepolia |

## Canonical V2 evidence

- Treasury: `0x7B92aB3D8BA17cF5f28C60E5c1FC326862dD6395`
- Public manifest: `evidence/base-sepolia-v2.json`
- Receipts: 26 total, 25 successful and one expected failed release (`status 0`)
- Final states: clean settlement `Released (4)`, blocked settlement `Cancelled (5)`
- Reconciliation: payer 15,000 mUSD; clean beneficiary 15,000; blocked beneficiary 0; escrow and `totalEscrowed` 0; solvent
- Public observation: 9,303,697 gas, 0.000055950883453125 test ETH, 736-second first-to-last block span; median 7.499 seconds for nine retained client-side confirmation samples
- Deep verifier: all 26 transactions checked in order for caller, target, method, settlement ID and events; the sole failed release decodes as `BeneficiarySanctioned`
- Codex boundary: CLI-reported `gpt-5.6-sol`, schema-valid read-only explanation, 27.432 seconds, 20,878 tokens, no signing/broadcast/state change, no API-cost claim

## Claim boundary

The public asset is a project-deployed, valueless mUSD token, not USDC or fiat-backed money. SG-CN, sanctions/KYC, invoice, route, FX, and off-ramp inputs are synthetic. Distinct wallet addresses do not prove different human controllers. The checks are not an independent audit, formal verification, certified screening service, production deployment, regulatory approval, or real cross-border settlement. Revocability ends at release.
