const fs = require("node:fs");
const path = require("node:path");
const { JsonRpcProvider, keccak256 } = require("ethers");

const ADDRESS = process.env.V2_TREASURY_ADDRESS || "0x7B92aB3D8BA17cF5f28C60E5c1FC326862dD6395";
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

function findBuildInfo() {
  const directory = path.join(__dirname, "..", "artifacts", "build-info");
  const candidates = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
  for (const name of candidates) {
    const file = path.join(directory, name);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const contract = data.output?.contracts?.["contracts/VerifiableTreasuryV2.sol"]?.VerifiableTreasuryV2;
    if (contract) return { file, data, contract };
  }
  throw new Error("VerifiableTreasuryV2 build info not found; run pnpm compile first");
}

function normalizeImmutables(bytecode, references) {
  const chars = bytecode.slice(2).split("");
  for (const locations of Object.values(references)) {
    for (const { start, length } of locations) {
      chars.fill("0", start * 2, (start + length) * 2);
    }
  }
  return `0x${chars.join("")}`;
}

async function main() {
  const { file, data, contract } = findBuildInfo();
  const local = `0x${contract.evm.deployedBytecode.object}`;
  const remote = await new JsonRpcProvider(RPC_URL, 84532, { staticNetwork: true }).getCode(ADDRESS);
  const references = contract.evm.deployedBytecode.immutableReferences;
  const normalizedLocal = normalizeImmutables(local, references);
  const normalizedRemote = normalizeImmutables(remote, references);
  const result = {
    checkedAt: new Date().toISOString(),
    network: "Base Sepolia",
    chainId: 84532,
    address: ADDRESS,
    compiler: data.solcLongVersion,
    buildInfo: path.relative(path.join(__dirname, ".."), file),
    localRuntimeBytes: (local.length - 2) / 2,
    onchainRuntimeBytes: (remote.length - 2) / 2,
    immutableReferenceCount: Object.values(references).flat().length,
    normalizedLocalHash: keccak256(normalizedLocal),
    normalizedOnchainHash: keccak256(normalizedRemote),
    exactAfterImmutableNormalization: normalizedLocal === normalizedRemote,
    boundary: "Independent local compiler-to-onchain bytecode match after zeroing compiler-declared immutable slots; not a third-party explorer verification.",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.exactAfterImmutableNormalization) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
