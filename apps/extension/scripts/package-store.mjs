#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "0.3.0";
const EXPECTED_PERMISSIONS = ["activeTab", "sidePanel", "storage"];
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
const NORMALIZED_TIMESTAMP = new Date("2020-01-01T00:00:00.000Z");
const PACKAGE_FILES = [
  "capture-source.js",
  "extension-policy.js",
  "guide-adapter.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128-store.png",
  "manifest.json",
  "service-worker.js",
  "session-store.js",
  "sidepanel.css",
  "sidepanel.html",
  "sidepanel.js",
  "window-operation-registry.js",
].sort();

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, "..");
const distDirectory = join(extensionDirectory, "dist");
const archiveName = `what-is-this-guide-v${EXPECTED_VERSION}.zip`;
const archivePath = join(distDirectory, archiveName);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    fail(`${command} could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "unknown error").trim();
    fail(`${command} exited with status ${result.status}: ${details}`);
  }

  return result.stdout;
}

function assertExactStringSet(actual, expected, label) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) {
    fail(`${label} must be an array of strings.`);
  }

  const normalizedActual = [...new Set(actual)].sort();
  const normalizedExpected = [...expected].sort();
  if (actual.length !== normalizedActual.length
    || JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    fail(`${label} must contain exactly: ${normalizedExpected.join(", ")}.`);
  }
}

async function validateReleaseMetadata() {
  const manifest = JSON.parse(await readFile(join(extensionDirectory, "manifest.json"), "utf8"));
  const packageMetadata = JSON.parse(await readFile(join(extensionDirectory, "package.json"), "utf8"));

  if (manifest.manifest_version !== 3) {
    fail("manifest.json must use Manifest V3.");
  }
  if (manifest.version !== EXPECTED_VERSION) {
    fail(`manifest.json version must be ${EXPECTED_VERSION}; found ${manifest.version ?? "missing"}.`);
  }
  if (packageMetadata.version !== EXPECTED_VERSION) {
    fail(`package.json version must be ${EXPECTED_VERSION}; found ${packageMetadata.version ?? "missing"}.`);
  }

  assertExactStringSet(manifest.permissions, EXPECTED_PERMISSIONS, "manifest permissions");
  for (const field of ["host_permissions", "optional_permissions", "optional_host_permissions"]) {
    if (Array.isArray(manifest[field]) && manifest[field].length > 0) {
      fail(`manifest.json ${field} must be absent or empty for this release.`);
    }
  }

  return manifest;
}

async function stageAllowlistedFiles(stagingDirectory) {
  for (const file of PACKAGE_FILES) {
    const source = join(extensionDirectory, file);
    const sourceStats = await lstat(source).catch(() => null);
    if (!sourceStats?.isFile() || sourceStats.isSymbolicLink()) {
      fail(`Required allowlisted file is missing or is not a regular file: ${file}`);
    }
    if (sourceStats.size === 0) {
      fail(`Required allowlisted file is empty: ${file}`);
    }

    const destination = join(stagingDirectory, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o644);
    await utimes(destination, NORMALIZED_TIMESTAMP, NORMALIZED_TIMESTAMP);
  }
}

function validateArchiveContents() {
  const entries = run("unzip", ["-Z1", archivePath])
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();

  if (JSON.stringify(entries) !== JSON.stringify(PACKAGE_FILES)) {
    const unexpected = entries.filter((entry) => !PACKAGE_FILES.includes(entry));
    const missing = PACKAGE_FILES.filter((entry) => !entries.includes(entry));
    fail(`Archive allowlist mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`);
  }
  if (!entries.includes("manifest.json") || entries.some((entry) => entry.endsWith("/manifest.json"))) {
    fail("manifest.json must be at the root of the ZIP archive.");
  }

  const archivedManifest = JSON.parse(run("unzip", ["-p", archivePath, "manifest.json"]));
  if (archivedManifest.version !== EXPECTED_VERSION) {
    fail(`Archived manifest version must be ${EXPECTED_VERSION}.`);
  }
}

async function main() {
  const manifest = await validateReleaseMetadata();
  const stagingDirectory = await mkdtemp(join(tmpdir(), "what-is-this-store-"));
  let packageCreated = false;

  try {
    await stageAllowlistedFiles(stagingDirectory);
    await mkdir(distDirectory, { recursive: true });
    await rm(archivePath, { force: true });

    run("zip", ["-X", "-9", "-q", archivePath, ...PACKAGE_FILES], { cwd: stagingDirectory });
    validateArchiveContents();

    const archiveStats = await stat(archivePath);
    if (archiveStats.size === 0 || archiveStats.size > MAX_PACKAGE_BYTES) {
      fail(`ZIP size must be between 1 and ${MAX_PACKAGE_BYTES} bytes; found ${archiveStats.size}.`);
    }

    packageCreated = true;
    console.log(`Created ${relative(extensionDirectory, archivePath)} (${archiveStats.size} bytes, ${PACKAGE_FILES.length} files, Manifest V${manifest.manifest_version}, version ${manifest.version}).`);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    if (!packageCreated) await rm(archivePath, { force: true });
  }
}

main().catch((error) => {
  console.error(`Store package failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
