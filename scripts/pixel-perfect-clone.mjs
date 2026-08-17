#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync } from "node:fs";
import { mkdir, rename, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/core.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const canonical = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
if (!home) throw new Error("Unable to determine the current user's home directory.");

const usage = "Usage: pixel-perfect-clone <doctor|install-global|sync-global|capture-source|capture-states|run-dembrandt|verify|screenshot-target|visual-diff|compare-geometry> [options]";
const has = (binary) => {
  try {
    execFileSync("/usr/bin/env", ["which", binary], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const version = (binary, values = ["--version"]) => {
  try {
    return execFileSync(binary, values, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const adapters = [
  { agent: "Claude Code", executable: "claude", path: join(home, ".claude", "skills", "pixel-perfect-clone") },
  { agent: "Codex", executable: "codex", path: join(home, ".codex", "skills", "pixel-perfect-clone") },
  { agent: "OpenCode", executable: "opencode", path: join(home, ".config", "opencode", "skills", "pixel-perfect-clone") },
  { agent: "Cursor", executable: "cursor", path: join(home, ".cursor", "skills", "pixel-perfect-clone") },
];

function linkState(path) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return "non-symlink";
    return resolve(dirname(path), readlinkSync(path)) === canonical ? "canonical" : "other-symlink";
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "broken";
  }
}

async function install() {
  for (const adapter of adapters) {
    if (!has(adapter.executable)) {
      console.log(`${adapter.agent}: not installed; skipped`);
      continue;
    }
    const state = linkState(adapter.path);
    if (state === "canonical") {
      console.log(`${adapter.agent}: already linked`);
      continue;
    }
    if (state !== "missing" && !args.force) {
      console.log(`${adapter.agent}: ${state}; skipped (review, then use --force)`);
      continue;
    }
    if (state === "non-symlink") {
      const backup = `${adapter.path}.bak.${Date.now()}`;
      await rename(adapter.path, backup);
      console.log(`${adapter.agent}: existing directory moved to ${backup}`);
    } else if (state !== "missing") {
      await rm(adapter.path, { recursive: true, force: true });
    }
    await mkdir(dirname(adapter.path), { recursive: true });
    await symlink(canonical, adapter.path, "dir");
    console.log(`${adapter.agent}: linked ${adapter.path}`);
  }
}

async function doctor() {
  let playwright;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    playwright = {
      available: true,
      version: version(process.execPath, ["-e", `console.log(require(${JSON.stringify(join(canonical, "node_modules", "playwright", "package.json"))}).version)`]),
    };
  } catch (error) {
    playwright = { available: false, error: error.message.split("\n")[0] };
  }
  console.log(JSON.stringify({
    canonical,
    node: process.version,
    playwright,
    dembrandt: version("dembrandt"),
    adapters: adapters.map((adapter) => ({
      agent: adapter.agent,
      installed: has(adapter.executable),
      executableVersion: has(adapter.executable) ? version(adapter.executable) : null,
      path: adapter.path,
      state: linkState(adapter.path),
    })),
  }, null, 2));
}

async function main() {
  if (command === "help" || args.help) console.log(usage);
  else if (command === "doctor") await doctor();
  else if (command === "install-global" || command === "sync-global") await install();
  else if (command === "verify") await import("./verify-clone.mjs");
  else if (["capture-source", "capture-states", "screenshot-target", "visual-diff", "compare-geometry", "run-dembrandt"].includes(command)) await import(`./${command}.mjs`);
  else throw new Error(`Unknown command: ${command}. ${usage}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
