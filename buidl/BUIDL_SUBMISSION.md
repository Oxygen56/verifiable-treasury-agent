# Verifiable Treasury Agent - BUIDL Submission

## One-Line Pitch

An AI-orchestrated, contract-enforced cross-border treasury rail where limits, independent approvals, compliance bindings, revocable escrow, rollback, and reconciliation are independently verifiable.

## Problem

Stablecoin treasury teams can automate proposal preparation with AI, but a model's explanation is not evidence that financial limits, two-person approval, sanctions policy, privacy boundaries, and recovery paths were actually enforced.

## Solution

The project separates explanation from authority. AI may prepare and explain a settlement, while a Solidity state machine is the only component allowed to change settlement state or move escrowed tokens. High-value transfers require two distinct approvers; funding enforces a daily limit; releases recheck an expiring policy digest; raw invoice and identity records remain off-chain behind salted commitments; and funds can be cancelled before release or rolled back after expiry.

## Demo

- Live URL: https://oxygen56.github.io/verifiable-treasury-agent/
- Public source: https://github.com/Oxygen56/verifiable-treasury-agent
- Local run: `pnpm install && pnpm check && pnpm benchmark && pnpm demo`
- Public testnet run: `pnpm demo:base-sepolia`

## Technical Architecture

- `VerifiableTreasury.sol`: role-separated deterministic state machine.
- Base Sepolia: 16 successful receipts covering deployment, roles, compliance attestation, proposal, two approvals, escrow, and release.
- Off-chain layer: AI orchestration and human-readable explanations with no signing privilege.
- Privacy boundary: only salted invoice commitments and synthetic policy digests are stored on-chain.
- Recovery: pre-release cancellation, permissionless expiry rollback, atomic reverts, and explicit balance reconciliation.

## Evidence

- Tests: seven positive and negative contract controls pass under Hardhat.
- Deployment: https://sepolia.basescan.org/address/0x7b46d90981e221e39F93F5bAfDEAaA39eF1ea7f3
- Final release: https://sepolia.basescan.org/tx/0xfcbc7389b1ef0a1861b8873fccb2a97156c448e349986a6124b7c1f4f928cf1b
- Receipt manifest: `evidence/base-sepolia.json` - 16/16 successful, final state `Released`, escrow `0`, beneficiary `15,000 mUSD`.
- Benchmark: `evidence/benchmark.json` - six local state-changing transactions, 589,952 gas, reconciliation passed.
- Security checks: OpenZeppelin access control, reentrancy protection, pausing, atomic negative tests, no committed private key, and explicit no-value test-token labeling.

## Judging Rubric Mapping

- Innovation: AI is deliberately non-authoritative; finance controls are policy-bound and receipt-verifiable.
- Technical implementation: contract state machine, distinct role wallets, public receipts, negative controls, and recovery evidence.
- Impact: a credible path for exporters, payment teams, and treasury/compliance operators to automate without giving a model unilateral authority.
- Usability: public control-room demo, one-command tests, evidence PDF, and direct explorer links.
- Ecosystem fit: Base Sepolia deployment with a Circle test-USDC adapter; the verified run uses explicitly labeled valueless mUSD, not USDC.

## Claim Boundary

This is public-testnet evidence, not a production deployment, certified sanctions-screening service, privacy certification, regulatory approval, or real-funds safety claim. The project token has no financial value.
