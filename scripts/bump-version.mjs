#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const releaseType = process.argv[2];
const validReleaseTypes = new Set(["patch", "minor", "major"]);

if (!validReleaseTypes.has(releaseType)) {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major>");
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function bump(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Unsupported version: ${version}`);
  }

  const [major, minor, patch] = parts;

  if (releaseType === "major") {
    return `${major + 1}.0.0`;
  }

  if (releaseType === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

function replaceInFile(path, pattern, replacement) {
  const current = readFileSync(path, "utf8");
  const next = current.replace(pattern, replacement);

  if (next === current) {
    throw new Error(`Could not update ${path}`);
  }

  writeFileSync(path, next);
}

const rootPackagePath = "package.json";
const rootPackage = readJson(rootPackagePath);
const nextVersion = bump(rootPackage.version);
const packagePaths = [
  rootPackagePath,
  "apps/desktop/package.json",
  "packages/cli/package.json",
];

for (const path of packagePaths) {
  const packageJson = readJson(path);
  packageJson.version = nextVersion;
  writeJson(path, packageJson);
}

replaceInFile(
  "apps/desktop/src-tauri/Cargo.toml",
  /^version = ".*"$/m,
  `version = "${nextVersion}"`,
);
replaceInFile(
  "apps/desktop/src-tauri/tauri.conf.json",
  /"version": ".*"/,
  `"version": "${nextVersion}"`,
);
replaceInFile(
  "packages/cli/bin/mdv.js",
  /^const VERSION = ".*";$/m,
  `const VERSION = "${nextVersion}";`,
);

console.log(nextVersion);
