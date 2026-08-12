const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const { ethers } = hre;
const U = (value) => ethers.parseUnits(String(value), 6);
const explorer = (hash) => `https://sepolia.basescan.org/tx/${hash}`;

const priorTransactions = [
  ["fund ephemeral approverA gas", "0x74a4dfc779db973209059e4aabef753ecda341c00147bf006f9b6297e116a1a7"],
  ["fund ephemeral approverB gas", "0x93a6261c754b188d1b69805ae5fb5735fb4ad87b2f8fdbf14619476108dabcee"],
  ["fund ephemeral compliance gas", "0x4ef61ae9bc4f248fb2ec466ffc2cc6ba3640ce3f6b3438c196ba39fe01246b3a"],
  ["deploy explicitly labeled demo token", "0xb8affd442ff036bca150e2baea836fb875d93797aa87006a55786f38b0cfc4b5"],
  ["deploy verifiable treasury", "0xb4ae48bf33d89adf0d1d878ad96585d92cf7f4d407ca5381917e245dfce52353"],
  ["grant approver A", "0x086cf0c842abe5d8883b39b2f816a786ebe0f7cbb621878bf92ae63d4d8db2f5"],
  ["grant approver B", "0x291f786854587a6c308ca6e3e942326b48538050f0a5b631a047ea8c9e2c9092"],
  ["grant compliance", "0xe5068f40664c5793b9abf66428181259c8b5877df48e37613826ad31a537959f"],
  ["mint valueless demo token", "0x523d995842b9e6c55691c662f5e30afd2fe8e42bb17be1cabb1892d0568680e4"],
  ["approve escrow allowance", "0xa5b6dc85797ae2bd78c38d370ee8b8aed5da2af0a8bee9240e59e53bda7f9596"],
  ["record expiring compliance attestation", "0xabf7ec43a0ad5ed7b67633c6f961dc3d9aaf07338fd95543491a93602643ca3b"],
  ["propose 15,000-token settlement", "0xe9dd27aab654b1bd26620076513b5ab1cb97dba647a562c969aac45e066faeb8"],
  ["distinct approval 1 of 2", "0xd25206ed605c136f1ddb7466b059d3126471eaf4c44650b4e496d1f02f48ac08"],
  ["distinct approval 2 of 2", "0x1945e85f2f9e5550dfa0e2233a7e54ee02b87ef3c8d138387b9f5773409db846"],
  ["fund revocable escrow", "0x18748ce64bd3e75fc20832f4def51552593ab29494c194de357a42d74d138883"],
];

async function receiptRow(provider, label, hash) {
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt || receipt.status !== 1) throw new Error(`Missing successful receipt: ${label}`);
  const tx = await provider.getTransaction(hash);
  const gasPrice = receipt.gasPrice || tx.gasPrice || 0n;
  const block = await provider.getBlock(receipt.blockNumber);
  return {
    label,
    hash,
    explorer: explorer(hash),
    blockNumber: receipt.blockNumber,
    blockTimestamp: block.timestamp,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    gasPriceWei: gasPrice.toString(),
    feeWei: (receipt.gasUsed * gasPrice).toString(),
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider;
  const network = await provider.getNetwork();
  if (network.chainId !== 84532n) throw new Error(`Refusing chain ${network.chainId}; expected Base Sepolia 84532`);

  const transactions = [];
  for (const [label, hash] of priorTransactions) transactions.push(await receiptRow(provider, label, hash));

  const tokenAddress = transactions.find((row) => row.label.startsWith("deploy explicitly")).hash;
  const treasuryAddress = transactions.find((row) => row.label === "deploy verifiable treasury").hash;
  const tokenReceipt = await provider.getTransactionReceipt(tokenAddress);
  const treasuryReceipt = await provider.getTransactionReceipt(treasuryAddress);
  const token = await ethers.getContractAt("MockStablecoin", tokenReceipt.contractAddress);
  const treasury = await ethers.getContractAt("VerifiableTreasury", treasuryReceipt.contractAddress);
  const settlementBefore = await treasury.settlements(1);
  const funded = {
    payer: (await token.balanceOf(deployer.address)).toString(),
    escrow: (await token.balanceOf(treasury.target)).toString(),
    state: Number(settlementBefore.state),
  };
  if (funded.escrow !== U(15000).toString() || funded.state !== 3) throw new Error("Settlement is not in recoverable funded escrow state");

  const started = Date.now();
  await treasury.releaseSettlement.staticCall(1);
  const tx = await treasury.releaseSettlement(1, { gasLimit: 300000 });
  const releaseReceipt = await tx.wait();
  transactions.push(await receiptRow(provider, "release after challenge window (recovered after RPC estimate lag)", releaseReceipt.hash));
  transactions[transactions.length - 1].observedConfirmationLatencyMs = Date.now() - started;

  const settlementAfter = await treasury.settlements(1);
  const final = {
    beneficiary: (await token.balanceOf(deployer.address)).toString(),
    escrow: (await token.balanceOf(treasury.target)).toString(),
    state: Number(settlementAfter.state),
  };
  const passed = funded.escrow === U(15000).toString() && final.escrow === "0" && final.beneficiary === U(15000).toString() && final.state === 4;
  if (!passed) throw new Error("Public-testnet reconciliation invariant failed");

  const totalGas = transactions.reduce((sum, row) => sum + BigInt(row.gasUsed), 0n);
  const totalFee = transactions.reduce((sum, row) => sum + BigInt(row.feeWei), 0n);
  const evidence = {
    generatedAt: new Date().toISOString(),
    network: "Base Sepolia",
    chainId: "84532",
    deployer: deployer.address,
    token: {
      address: token.target,
      name: "Mock Test Dollar",
      symbol: "mUSD",
      financialValue: "none",
      warning: "Project-deployed demo token; not USDC and not backed by fiat.",
    },
    treasury: treasury.target,
    settlement: {
      id: 1,
      amountBaseUnits: U(15000).toString(),
      requiredDistinctApprovals: 2,
      releaseAfter: Number(settlementBefore.releaseAfter),
      expiresAt: Number(settlementBefore.expiresAt),
    },
    transactions,
    totals: {
      transactionCount: transactions.length,
      gasUsed: totalGas.toString(),
      feeWei: totalFee.toString(),
    },
    recovery: {
      initialReleaseBroadcast: false,
      cause: "The public RPC returned a transient estimateGas revert after the challenge window; a later static call passed and release was sent with an explicit gas limit.",
      safety: "The settlement remained in funded, revocable escrow throughout; no token balance was lost.",
    },
    reconciliation: { funded, final, passed },
    claimBoundary: [
      "Receipts prove public Base Sepolia execution only.",
      "The demo token has no financial value and is not USDC.",
      "Compliance data is a synthetic policy digest, not certified screening.",
      "Ephemeral role keys are demonstration-only and are not production key management.",
    ],
  };
  const out = path.join(__dirname, "..", "evidence", "base-sepolia.json");
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
