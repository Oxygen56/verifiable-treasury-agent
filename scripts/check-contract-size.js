const artifact = require("../artifacts/contracts/VerifiableTreasuryV2.sol/VerifiableTreasuryV2.json");

const EIP170_LIMIT = 24_576;
const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;
const result = {
  contract: "VerifiableTreasuryV2",
  deployedBytes,
  eip170Limit: EIP170_LIMIT,
  headroomBytes: EIP170_LIMIT - deployedBytes,
  withinLimit: deployedBytes <= EIP170_LIMIT,
};

process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.withinLimit) process.exitCode = 1;
