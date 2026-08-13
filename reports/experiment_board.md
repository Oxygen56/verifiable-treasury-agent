# Canonical V2 release evidence

This is the judge-facing evidence index, not a complete development log. It lists only successful, current V2 release checks. Superseded and failed attempts remain in the local run ledger for traceability but are excluded from the judge bundle.

| Release claim | Canonical run | Verified result | Scope boundary |
| --- | --- | --- | --- |
| Final source regression | `experiments/runs/20260813-093227_v2-final-release-regression` | 37 repository-wide checks passed; the V2 state-path test exercised 64 deterministic generated paths | The total includes 7 transparent historical V1 controls; the release architecture and packaged source are V2 |
| Bounded Codex explanation | `experiments/runs/20260813-094543_v2-codex-explanation-boundary-final` | Read-only, schema-valid explanation completed in 27.432 seconds; the CLI reported model `gpt-5.6-sol` and 20,878 tokens | No tool, signing, broadcast, authorization, or state change; no API billing claim. The judge bundle keeps `run.json` and JSON stdout but omits repetitive local state-database warnings |
| V2 coverage | `experiments/runs/20260812-213150_v2-final-coverage` | 98.84% statements, 94.44% functions, 99.14% lines, 45.45% branches | Coverage is test evidence, not formal verification or a security audit |
| Compiler-to-chain bytecode comparison | `experiments/runs/20260812-215834_v2-onchain-bytecode-match` | Local and deployed 22,427-byte runtimes matched after compiler-declared immutable normalization | Local comparison, not third-party explorer source verification |
| Static-analysis triage | `experiments/runs/20260812-220405_v2-slither-high-medium-triage` | 26 contracts, 63 enabled detectors, zero filtered high/medium results | Intentional timestamp/strict-epoch checks and dependency noise were documented and filtered; not an independent audit |
| Deep read-only public evidence check | `experiments/runs/20260813-095120_v2-public-evidence-deep-verifier` | 26 transactions were checked in chain order for caller, target, method, settlement ID, and critical event values/order; the sole status-0 release was decoded as `BeneficiarySanctioned`; final balances, states, allowance, escrow, clearance consumption, disclosure, and solvency reconciled | Public RPC reconstruction plus historical call/trace; reproducible evidence, not an independent audit or production settlement |

## Release selection rule

The package whitelist includes only the six successful runs above. It excludes the failed Codex attempt `20260813-094405`, all other failed and superseded runs, V1 contracts and public evidence, V1 deployment/benchmark scripts, private recovery material, environment files, dependency trees, compiler artifacts, coverage working files, and temporary outputs. The public execution itself is represented by the committed V2 manifest and independently reconstructed by the deep verifier, so no stale raw deployment transcript is shipped.
