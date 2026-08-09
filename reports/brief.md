# NTU InnovateX 2026 execution brief

## Hard gates

- Official entry: https://ntu-cctf-snz-innovatex-2026.devpost.com/
- Safe submission deadline: 2026-08-14 23:45 SGT / Beijing time. The rules body says 23:59, so the platform's earlier 23:45 time is the hard cutoff.
- Target: Public Group, Track 1. One participant may join only one team/project; teams may be any size and each member must materially contribute.
- Stage 1 requires project narrative and at least one supporting file. Public repository and demo are recommended evidence.
- Stage 2, if selected, requires a functional live demo and at least one representative onsite in Singapore, 2026-08-21 to 2026-08-23. Attendance, travel spending, and personal declarations require separate approval.

## Winning thesis

Most stablecoin-agent demos prove the happy path. Verifiable Treasury Agent makes the operational controls independently inspectable: value-based multi-party approval, per-payer limits, expiring compliance-policy binding, sanctions status recheck, privacy-by-commitment, challenge-window cancellation, expiry rollback, and exact balance reconciliation. AI has no privileged role.

## Judging map

| Criterion | Weight | Evidence |
| --- | ---: | --- |
| Technical implementation | 30% | Solidity state machine, role separation, negative tests, public testnet receipts |
| Impact | 25% | Cross-border treasury controls and reconciliation for finance/compliance teams |
| Innovation | 20% | AI orchestration separated from deterministic authority; policy-bound release |
| Presentation/demo | 15% | Three-minute success + failure demo, explorer links, evidence dashboard |
| Track relevance | 10% | Stablecoin settlement and AI-agent operating boundary |

## Claim boundary

Tests prove deterministic local-EVM behavior. Public Base Sepolia receipts prove only testnet execution with assets that have no financial value. The project does not claim certified sanctions screening, zero-knowledge privacy, production security, regulatory approval, or post-release reversibility.
