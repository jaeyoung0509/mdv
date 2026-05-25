#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const VERSION = "0.1.1";

function printHelp() {
  console.log(`mdv ${VERSION}

Fast, beautiful Markdown viewing from the terminal.

Usage:
  mdv [path] [options]

Options:
  --theme <light|dark|system>  Choose viewer theme (default: system)
  --no-watch                   Disable file watching
  --allow-html                 Parse sanitized raw HTML from local trusted docs
  --version                    Print version
  --help                       Print help

Examples:
  mdv
  mdv .
  mdv README.md
  mdv lecture.md --theme dark
  mdv lecture.md --no-watch`);
}

function parseArgs(argv) {
  const options = {
    path: ".",
    theme: "system",
    watch: true,
    allowHtml: false,
    help: false,
    version: false,
  };
  let sawPath = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      options.version = true;
      continue;
    }

    if (arg === "--no-watch") {
      options.watch = false;
      continue;
    }

    if (arg === "--allow-html") {
      options.allowHtml = true;
      continue;
    }

    if (arg === "--theme") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--theme requires one of: light, dark, system");
      }
      options.theme = parseTheme(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--theme=")) {
      options.theme = parseTheme(arg.slice("--theme=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!sawPath) {
      options.path = arg;
      sawPath = true;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

function parseTheme(value) {
  if (["light", "dark", "system"].includes(value)) {
    return value;
  }

  throw new Error("--theme requires one of: light, dark, system");
}

function workspaceRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

function executablePath(root) {
  const candidates = [
    resolve(root, "apps/desktop/src-tauri/target/release/mdv"),
    resolve(root, "apps/desktop/src-tauri/target/debug/mdv"),
  ];

  return candidates.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function launch(options) {
  const root = workspaceRoot();
  const desktopDir = resolve(root, "apps/desktop");
  const resolvedPath = resolve(process.cwd(), options.path);
  const appArgs = [resolvedPath, "--theme", options.theme];

  if (!options.watch) {
    appArgs.push("--no-watch");
  }

  if (options.allowHtml) {
    appArgs.push("--allow-html");
  }

  const binary = executablePath(root);
  const child = binary
    ? spawn(binary, appArgs, { stdio: "inherit" })
    : spawn("pnpm", ["tauri", "dev", "--", ...appArgs], {
        cwd: desktopDir,
        stdio: "inherit",
        env: process.env,
      });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`mdv: ${error.message}`);
    process.exit(1);
  });
}

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    console.log(VERSION);
    process.exit(0);
  }

  launch(options);
} catch (error) {
  console.error(`mdv: ${error.message}`);
  console.error("Run mdv --help for usage.");
  process.exit(1);
}
