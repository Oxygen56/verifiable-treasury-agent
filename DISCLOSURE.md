# Prior work, AI use, dependencies, and data disclosure

## Work completed before the hackathon build

Before implementation, the entrant used public event pages to research eligibility, deadlines, judging, tracks, submission fields, and risks, and drafted a concept for a verifiable cross-border treasury agent. No Verifiable Treasury Agent source code, smart contract, test suite, public deployment, demo site, or prior commercial product existed before this build. The repository history is the implementation record.

## AI use

OpenAI Codex was used extensively as a coding and research assistant to help plan the architecture, draft code and documentation, run tests, and interpret results. AI is not part of the trusted runtime boundary: the smart contract deterministically enforces all approvals, limits, compliance bindings, escrow, release, cancellation, and rollback transitions. Humans remain responsible for reviewing code, configuring roles, providing compliance attestations, signing transactions, and accepting legal or operational obligations.

## External tools and dependencies

- Hardhat and Nomic Foundation tooling — MIT license
- OpenZeppelin Contracts — MIT license
- Node.js / pnpm — their respective open-source licenses
- Base Sepolia public RPC and explorer — public test infrastructure, subject to provider terms and rate limits
- Circle Base Sepolia test USDC contract — test token with no financial value; not bundled or represented as project-owned
- Devpost — contest hosting and submission platform

No proprietary dataset is bundled. Demo policy digests are synthetic strings that demonstrate binding and expiry; they are not an official, complete, or certified sanctions list. No personal KYC or invoice data is committed to this repository.

## New work during the event

All contracts, tests, benchmark scripts, demo assets, submission copy, and public-testnet evidence in this repository were created for NTU CCTF × SNZ InnovateX 2026. Any later third-party contribution must be listed here before submission.
