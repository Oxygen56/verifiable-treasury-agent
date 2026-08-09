# Verifiable Treasury Agent

Track 1 prototype for NTU CCTF × SNZ InnovateX 2026: a cross-border treasury and stablecoin settlement agent whose core state transitions are enforced by an auditable smart contract rather than an AI model.

**Live demo:** https://oxygen56.github.io/verifiable-treasury-agent/  
**Evidence deck:** `output/pdf/verifiable-treasury-agent-evidence.pdf`

## Why it can win

- **Verifiable controls:** daily limits, multi-party approval, compliance attestations, challenge windows, and atomic rollback are enforced on-chain.
- **Honest privacy:** invoice/customer data stays off-chain; the contract stores only salted commitments and policy digests. This is selective disclosure, not a claim of zero-knowledge privacy.
- **Revocability with a precise boundary:** funded settlements can be cancelled and refunded before release. Blockchain finality is not falsely presented as reversible after release.
- **Evidence-first demo:** tests cover success, sanctions, insufficient approvals, policy mismatch, expiry rollback, and daily-limit failures; benchmark output records gas, latency, balances, and reconciliation.

## Quick start

```bash
pnpm install
pnpm compile
pnpm test
pnpm benchmark
```

The public demo is static under `demo/`. Serve it locally with:

```bash
pnpm demo
```

## Base Sepolia

The deployment script targets Base Sepolia (`chainId 84532`, public RPC `https://sepolia.base.org`) and Circle's test USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Testnet assets have no financial value.

```bash
cp .env.example .env
# Add a funded Base Sepolia test-only key locally; never commit it.
pnpm deploy:base-sepolia
```

## Repository map

- `contracts/VerifiableTreasury.sol` — deterministic settlement state machine
- `contracts/MockStablecoin.sol` — local-test token only
- `test/VerifiableTreasury.test.js` — positive and negative controls
- `scripts/benchmark.js` — reproducible gas/latency/reconciliation evidence
- `scripts/deploy-base-sepolia.js` — real testnet deployment using Circle test USDC
- `demo/` — judge-facing product story and evidence viewer
- `docs/ARCHITECTURE.md` — trust boundary and state transitions
- `DISCLOSURE.md` — prior work, AI use, data, tools, and dependencies
- `SUBMISSION.md` — Devpost-ready copy and evidence checklist

## Evidence boundary

Local tests prove contract behavior in a deterministic EVM. A Base Sepolia transaction hash proves public-testnet execution only after `evidence/base-sepolia.json` exists and independently resolves in the explorer. No production deployment, regulatory approval, sanctions-screening certification, privacy certification, or real-funds safety is claimed.

Apache-2.0 licensed. See [LICENSE](LICENSE).
