#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { planSettlementV2 } = require("../src/orchestrator-v2");

function usage() {
  return [
    "Usage:",
    "  node scripts/plan-settlement-v2.js <invoice.json> [--verifying-contract <address>] [--chain-id <id>]",
    "",
    "This offline command emits unsigned JSON to stdout without an invoice-only hash.",
    "It cannot authorize, sign, submit a transaction, or model a deducted protocol fee.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const file = argv[0];
  if (!file || file.startsWith("--")) throw new Error("invoice JSON path is required");
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--verifying-contract") options.verifyingContract = value;
    else if (flag === "--chain-id") options.chainId = value;
    else throw new Error(`unknown option: ${flag}`);
  }
  return { file, options };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const absolute = path.resolve(parsed.file);
  const input = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!parsed.options.verifyingContract && input.planning?.verifyingContract) {
    parsed.options.verifyingContract = input.planning.verifyingContract;
  }
  if (!parsed.options.verifyingContract) {
    throw new Error("--verifying-contract is required unless planning.verifyingContract is present in the input");
  }
  const plan = planSettlementV2(input, parsed.options);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Planning failed: ${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
