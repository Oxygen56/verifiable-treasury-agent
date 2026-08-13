const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ARCHIVE_ROOT = "verifiable-treasury-agent";
const OUTPUT_DIR = path.join(ROOT, "buidl", "package");

const ROOT_FILES = [
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "hardhat.config.js",
  "competition.yaml",
  "DISCLOSURE.md",
  "SUBMISSION.md",
  "index.html",
  ".github/workflows/verify.yml",
];

const PUBLIC_TREES = [
  "src",
  "demo",
  "docs",
  "buidl",
  "output/pdf",
  "output/images",
  "output/video",
];

// Keep the judge bundle V2-only. Shared test fixtures are included explicitly;
// the historical V1 contract, evidence, scripts, tests, and benchmark stay in
// repository history but cannot enter this release archive.
const PUBLIC_FILES = [
  "contracts/FeeOnTransferToken.sol",
  "contracts/MockStablecoin.sol",
  "contracts/VerifiableTreasuryV2.sol",
  "test/VerifiableTreasuryV2.invariants.test.js",
  "test/VerifiableTreasuryV2.test.js",
  "test/orchestrator-v2.test.js",
  "test/live-verifier.test.js",
  "scripts/check-contract-size.js",
  "scripts/full-demo-v2-base-sepolia.js",
  "scripts/package-v2-release.js",
  "scripts/plan-settlement-v2.js",
  "scripts/recover-v2-base-sepolia-demo.js",
  "scripts/render_demo_video.sh",
  "scripts/render_supporting_pdf.py",
  "scripts/verify-base-sepolia-v2-evidence.js",
  "scripts/verify-deployed-bytecode.js",
  "evidence/base-sepolia-v2.json",
  "evidence/codex-explanation-prompt.md",
  "evidence/codex-explanation-schema.json",
  "evidence/codex-explanation-v2.json",
  "evidence/public-links.json",
  "evidence/sample-invoice-v2.json",
  "reports/brief.md",
  "reports/experiment_board.md",
];

const LEGACY_V1_RELEASE_PATHS = new Set([
  "contracts/VerifiableTreasury.sol",
  "test/VerifiableTreasury.test.js",
  "scripts/benchmark.js",
  "scripts/deploy-base-sepolia.js",
  "scripts/full-demo-base-sepolia.js",
  "scripts/recover-base-sepolia-demo.js",
  "evidence/base-sepolia.json",
  "evidence/benchmark.json",
]);

const V2_ONLY_FORBIDDEN_ARCHIVE_PATHS = new Set([
  ...LEGACY_V1_RELEASE_PATHS,
  "scripts/create-testnet-wallet.js",
  "evidence/testnet-wallet-public.json",
]);

// Only successful, judge-relevant runs are shipped. Failed and superseded runs remain
// in the local ledger but are intentionally absent from the public release bundle.
const SELECTED_RUNS = [
  "experiments/runs/20260813-093227_v2-final-release-regression",
  "experiments/runs/20260813-094543_v2-codex-explanation-boundary-final",
  "experiments/runs/20260812-213150_v2-final-coverage",
  "experiments/runs/20260812-215834_v2-onchain-bytecode-match",
  "experiments/runs/20260812-220405_v2-slither-high-medium-triage",
  "experiments/runs/20260813-095120_v2-public-evidence-deep-verifier",
];

// The successful Codex run emitted repetitive local state-database warnings on
// stderr. They are unrelated to the explanation result, so the bundle keeps
// only the run record and schema-valid JSON stdout for that run.
const SELECTED_RUN_FILE_EXCLUSIONS = new Map([
  [
    "experiments/runs/20260813-094543_v2-codex-explanation-boundary-final",
    new Set(["stderr.txt"]),
  ],
]);

const FORBIDDEN_SEGMENTS = new Set([
  "node_modules",
  "artifacts",
  "cache",
  "coverage",
  "private",
  "tmp",
  "typechain-types",
  ".git",
]);

const FORBIDDEN_FILE_NAMES = new Set([
  ".env",
  "coverage.json",
  ".DS_Store",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".mjs",
  ".py",
  ".sol",
  ".txt",
  ".yaml",
  ".yml",
]);

const SECRET_PATTERNS = [
  {
    name: "Ethereum private key assignment",
    pattern:
      /(?:private[_ -]?key|deployer[_ -]?key|signer[_ -]?key)\s*["']?\s*[:=]\s*["']?0x[0-9a-fA-F]{64}\b/i,
  },
  {
    name: "Mnemonic or seed phrase assignment",
    pattern:
      /(?:mnemonic|seed[_ -]?phrase)\s*["']?\s*[:=]\s*["'][a-z]+(?:\s+[a-z]+){11,23}["']/i,
  },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{30,}\b/ },
  { name: "OpenAI key", pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
  {
    name: "Generic live secret assignment",
    pattern:
      /(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token)\s*["']?\s*[:=]\s*["'](?!example|placeholder|replace|your[_ -])[A-Za-z0-9_\-/.+=]{20,}["']/i,
  },
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assertSafeRelative(relativePath) {
  const normalized = toPosix(path.normalize(relativePath));
  if (normalized.startsWith("../") || normalized === ".." || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  const parts = normalized.split("/");
  for (const part of parts) {
    if (
      FORBIDDEN_SEGMENTS.has(part) ||
      part.startsWith(".venv") ||
      part === "package" ||
      part === "evidence/private"
    ) {
      throw new Error(`Forbidden path segment in release: ${relativePath}`);
    }
  }
  const base = path.posix.basename(normalized);
  if (
    FORBIDDEN_FILE_NAMES.has(base) ||
    base.startsWith(".env.") ||
    base.endsWith(".log") ||
    /(?:^|[-_.])private[-_.]?key/i.test(base) ||
    /mnemonic|seed[-_.]?phrase/i.test(base)
  ) {
    throw new Error(`Forbidden filename in release: ${relativePath}`);
  }
  return normalized;
}

function collectTree(relativeDir, files) {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Required directory is missing: ${relativeDir}`);
  }
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (relativePath === "buidl/package" || relativePath.startsWith("buidl/package/")) {
      continue;
    }
    if (relativePath === "evidence/private" || relativePath.startsWith("evidence/private/")) {
      continue;
    }
    if (entry.name === ".DS_Store" || entry.name.startsWith(".env")) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in the release: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      collectTree(relativePath, files);
    } else if (entry.isFile()) {
      files.add(assertSafeRelative(relativePath));
    }
  }
}

function collectReleaseFiles() {
  const files = new Set();
  for (const relativePath of [...ROOT_FILES, ...PUBLIC_FILES]) {
    const safePath = assertSafeRelative(relativePath);
    const absolutePath = path.join(ROOT, safePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Required file is missing: ${relativePath}`);
    }
    files.add(safePath);
  }
  for (const relativeDir of PUBLIC_TREES) {
    collectTree(relativeDir, files);
  }
  for (const relativeDir of SELECTED_RUNS) {
    const selectedFiles = new Set();
    collectTree(relativeDir, selectedFiles);
    const exclusions = SELECTED_RUN_FILE_EXCLUSIONS.get(relativeDir) || new Set();
    for (const relativePath of selectedFiles) {
      if (!exclusions.has(path.posix.basename(relativePath))) {
        files.add(relativePath);
      }
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b, "en"));
}

function scanTextForSecrets(filePath, displayPath) {
  const extension = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  if (!TEXT_EXTENSIONS.has(extension) && !["LICENSE"].includes(base)) {
    return;
  }
  const text = fs.readFileSync(filePath, "utf8");
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`${name} detected in ${displayPath}`);
    }
  }
}

function collectKnownPrivateMarkers() {
  const privateRoot = path.join(ROOT, "evidence", "private");
  const markers = new Set();

  function inspect(value, keyPath = []) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, [...keyPath, String(index)]));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        inspect(entry, [...keyPath, key]);
      }
      return;
    }
    const key = keyPath[keyPath.length - 1] || "";
    if (
      typeof value === "string" &&
      /private.*key|secret|mnemonic|seed.*phrase/i.test(key) &&
      value.length >= 16
    ) {
      markers.add(value);
    }
  }

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".json") {
        inspect(JSON.parse(fs.readFileSync(absolute, "utf8")));
      }
    }
  }

  if (fs.existsSync(privateRoot)) {
    walk(privateRoot);
  }

  // Also compare the archive byte-for-byte against sensitive values in the
  // ignored local environment file without ever printing those values.
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      const value = rawValue.trim().replace(/^(["'])(.*)\1$/, "$2");
      if (/private.*key|secret|mnemonic|seed.*phrase|access.*token/i.test(key) && value.length >= 16) {
        markers.add(value);
      }
    }
  }
  return [...markers];
}

function scanForKnownPrivateMarkers(filePath, displayPath, markers) {
  if (!markers.length) {
    return;
  }
  const bytes = fs.readFileSync(filePath);
  for (const marker of markers) {
    if (bytes.includes(Buffer.from(marker))) {
      throw new Error(`Known private value detected in ${displayPath}`);
    }
  }
}

function copyReleaseFiles(files, archiveRootPath, knownPrivateMarkers) {
  for (const relativePath of files) {
    const source = path.join(ROOT, relativePath);
    const destination = path.join(archiveRootPath, relativePath);
    scanTextForSecrets(source, relativePath);
    scanForKnownPrivateMarkers(source, relativePath, knownPrivateMarkers);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    const sourceMode = fs.statSync(source).mode & 0o777;
    fs.chmodSync(destination, sourceMode & 0o111 ? 0o755 : 0o644);
  }
}

function sanitizeSelectedRunArtifacts(archiveRootPath) {
  const homePathPattern = /\/Users\/[^/\s"'`]+/g;
  for (const relativeDir of SELECTED_RUNS) {
    const runDirectory = path.join(archiveRootPath, relativeDir);
    for (const name of ["run.json", "stdout.txt", "stderr.txt"]) {
      const artifactPath = path.join(runDirectory, name);
      if (!fs.existsSync(artifactPath)) continue;
      if (name === "run.json") {
        const record = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        if (record.git && typeof record.git === "object") {
          delete record.git.status;
          record.git.workingTreeSnapshot = "omitted from judge bundle";
        }
        const serialized = JSON.stringify(record, null, 2)
          .replaceAll(ROOT, "<PROJECT_ROOT>")
          .replace(homePathPattern, "<USER_HOME>");
        fs.writeFileSync(artifactPath, `${serialized}\n`, { mode: 0o644 });
      } else {
        const sanitized = fs.readFileSync(artifactPath, "utf8")
          .replaceAll(ROOT, "<PROJECT_ROOT>")
          .replace(homePathPattern, "<USER_HOME>")
          // Dotenv's decorative loader line exposes no value, but it is noisy
          // and can imply that local environment material was bundled.
          .replace(/^.*injected env \(\d+\) from \.env.*(?:\r?\n|$)/gmu, "");
        fs.writeFileSync(artifactPath, sanitized, { mode: 0o644 });
      }
    }
  }
}

function writeMetadata(archiveRootPath, sourceFiles) {
  const metadata = {
    schema: "verifiable-treasury-agent-release/v1",
    project: "Verifiable Treasury Agent V2",
    generatedAt: new Date().toISOString(),
    archiveRoot: ARCHIVE_ROOT,
    sourceFileCount: sourceFiles.length,
    selectedSuccessfulRuns: SELECTED_RUNS,
    selectedRunFileExclusions: Object.fromEntries(
      [...SELECTED_RUN_FILE_EXCLUSIONS].map(([run, names]) => [run, [...names].sort()]),
    ),
    exclusions: [
      "credentials and environment files",
      "evidence/private",
      "historical V1 contracts, evidence, scripts, tests, and benchmarks",
      "node_modules, artifacts, cache, coverage and virtual environments",
      "buidl/package and temporary files",
      "failed and superseded experiment runs",
    ],
    verification: {
      whitelistOnly: true,
      symlinksAllowed: false,
      secretPatternScan: "passed before archive creation",
      manifestAlgorithm: "SHA-256",
    },
  };
  const metadataPath = path.join(archiveRootPath, "BUNDLE_METADATA.json");
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 });
}

function listFilesUnder(rootPath) {
  const files = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink found in staging tree: ${absolute}`);
      }
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(toPosix(path.relative(rootPath, absolute)));
      }
    }
  }
  walk(rootPath);
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function writeManifest(archiveRootPath) {
  const files = listFilesUnder(archiveRootPath).filter((entry) => entry !== "MANIFEST.sha256");
  const lines = files.map((relativePath) => {
    const digest = sha256File(path.join(archiveRootPath, relativePath));
    return `${digest}  ${relativePath}`;
  });
  fs.writeFileSync(path.join(archiveRootPath, "MANIFEST.sha256"), `${lines.join("\n")}\n`, {
    mode: 0o644,
  });
  return lines.length;
}

function verifyExtractedBundle(extractedRoot, expectedEntries, knownPrivateMarkers) {
  const manifestPath = path.join(extractedRoot, "MANIFEST.sha256");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("MANIFEST.sha256 is missing from extracted bundle");
  }
  const actualEntries = listFilesUnder(extractedRoot);
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    const expectedSet = new Set(expectedEntries);
    const actualSet = new Set(actualEntries);
    const missing = expectedEntries.filter((entry) => !actualSet.has(entry));
    const extra = actualEntries.filter((entry) => !expectedSet.has(entry));
    throw new Error(`Archive inventory mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`);
  }

  const manifestLines = fs
    .readFileSync(manifestPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const line of manifestLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) {
      throw new Error(`Malformed manifest line: ${line}`);
    }
    const [, expectedHash, relativePath] = match;
    const safePath = assertSafeRelative(relativePath);
    const absolutePath = path.join(extractedRoot, safePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Manifest entry is missing: ${relativePath}`);
    }
    if (sha256File(absolutePath) !== expectedHash) {
      throw new Error(`Manifest hash mismatch: ${relativePath}`);
    }
    scanTextForSecrets(absolutePath, relativePath);
    scanForKnownPrivateMarkers(absolutePath, relativePath, knownPrivateMarkers);
  }
  if (manifestLines.length !== actualEntries.length - 1) {
    throw new Error("Manifest does not cover every payload file");
  }
  return manifestLines.length;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function main() {
  for (const command of ["zip", "unzip"]) {
    execFileSync("/usr/bin/env", [command, "-h"], { stdio: "ignore" });
  }

  const sourceFiles = collectReleaseFiles();
  const knownPrivateMarkers = collectKnownPrivateMarkers();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vta-v2-release-"));
  const archiveRootPath = path.join(temporaryRoot, ARCHIVE_ROOT);
  const verifyRoot = path.join(temporaryRoot, "verify");
  fs.mkdirSync(archiveRootPath, { recursive: true });

  try {
    copyReleaseFiles(sourceFiles, archiveRootPath, knownPrivateMarkers);
    sanitizeSelectedRunArtifacts(archiveRootPath);
    writeMetadata(archiveRootPath, sourceFiles);
    const manifestEntries = writeManifest(archiveRootPath);
    const stagedEntries = listFilesUnder(archiveRootPath);

    const baseName = `verifiable-treasury-agent-v2_${timestamp()}`;
    const archivePath = path.join(OUTPUT_DIR, `${baseName}.zip`);
    execFileSync("zip", ["-X", "-q", "-r", archivePath, ARCHIVE_ROOT], {
      cwd: temporaryRoot,
      stdio: "inherit",
    });
    execFileSync("unzip", ["-tq", archivePath], { stdio: "inherit" });
    fs.mkdirSync(verifyRoot, { recursive: true });
    execFileSync("unzip", ["-q", archivePath, "-d", verifyRoot], { stdio: "inherit" });

    const extractedRoot = path.join(verifyRoot, ARCHIVE_ROOT);
    const verifiedManifestEntries = verifyExtractedBundle(
      extractedRoot,
      stagedEntries,
      knownPrivateMarkers,
    );
    if (verifiedManifestEntries !== manifestEntries) {
      throw new Error("Manifest verification count changed after extraction");
    }

    const archiveHash = sha256File(archivePath);
    const hashPath = `${archivePath}.sha256`;
    fs.writeFileSync(hashPath, `${archiveHash}  ${path.basename(archivePath)}\n`, { mode: 0o644 });

    const verification = {
      schema: "verifiable-treasury-agent-release-verification/v1",
      archive: path.basename(archivePath),
      archiveSha256: archiveHash,
      archiveBytes: fs.statSync(archivePath).size,
      archiveFileCount: stagedEntries.length,
      manifestEntryCount: verifiedManifestEntries,
      requiredFilesPresent: ROOT_FILES.every((entry) => stagedEntries.includes(entry)),
      requiredPublicFilesPresent: PUBLIC_FILES.every((entry) => stagedEntries.includes(entry)),
      requiredPublicTreesPresent: PUBLIC_TREES.every((dir) =>
        stagedEntries.some((entry) => entry.startsWith(`${dir}/`)),
      ),
      selectedSuccessfulRunsPresent: SELECTED_RUNS.every((dir) =>
        stagedEntries.some((entry) => entry.startsWith(`${dir}/`)),
      ),
      excludedLegacyV1Artifacts: !stagedEntries.some((entry) => LEGACY_V1_RELEASE_PATHS.has(entry)),
      excludedV2OnlyForbiddenPaths: !stagedEntries.some((entry) => V2_ONLY_FORBIDDEN_ARCHIVE_PATHS.has(entry)),
      excludedPrivateEvidence: !stagedEntries.some((entry) => entry.startsWith("evidence/private/")),
      excludedBuildArtifacts: !stagedEntries.some((entry) =>
        /(^|\/)(node_modules|artifacts|cache|coverage|tmp|\.venv[^/]*)(\/|$)/.test(entry),
      ),
      zipIntegrity: "passed",
      extractedManifestVerification: "passed",
      extractedSecretPatternScan: "passed",
      knownPrivateValueScan: "passed",
      verifiedAt: new Date().toISOString(),
    };
    if (
      !verification.requiredFilesPresent ||
      !verification.requiredPublicFilesPresent ||
      !verification.requiredPublicTreesPresent ||
      !verification.selectedSuccessfulRunsPresent ||
      !verification.excludedLegacyV1Artifacts ||
      !verification.excludedV2OnlyForbiddenPaths ||
      !verification.excludedPrivateEvidence ||
      !verification.excludedBuildArtifacts
    ) {
      throw new Error("Release verification gates did not all pass");
    }
    const verificationPath = `${archivePath}.verification.json`;
    fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, { mode: 0o644 });

    process.stdout.write(`${JSON.stringify({ archivePath, hashPath, verificationPath, ...verification }, null, 2)}\n`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
