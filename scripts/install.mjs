#!/usr/bin/env node
// Installs mods from this repo into the Herdr app home.
//
//   node scripts/install.mjs                 every mod in mods/
//   node scripts/install.mjs open-in-editor  only the named ones
//   npx github:alvag/herdr-mods [names]      same, without cloning this repo
//
// Each mod folder is copied to <home>/mods/. A mod that needs more than its
// folder (clones, menu rows, layouts) has a hook in scripts/wire/<name>.mjs,
// run only when that mod is installed. Safe to run again: patches already
// applied are skipped.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { selectMods } from "./select.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app");

const herdr = (...args) => execFileSync("herdr-app", args, { stdio: "inherit" });

// Replaces `from` with `to` once; skips when `marker` is already there.
function patch(file, marker, from, to) {
  const text = readFileSync(file, "utf8");
  if (text.includes(marker)) return;
  if (!text.includes(from)) throw new Error(`${file}: anchor not found, Herdr changed it:\n${from}`);
  writeFileSync(file, text.replace(from, to));
  console.log(`patched ${file}`);
}

const available = readdirSync(join(repo, "mods"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(repo, "mods", d.name, "main.js")))
  .map((d) => d.name);

let selected;
try {
  selected = selectMods(available, process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const checks = [];
const notes = [];
for (const name of selected) {
  cpSync(join(repo, "mods", name), join(home, "mods", name), { recursive: true });
  console.log(`copied mods/${name}`);
  checks.push(name);
  const hook = join(repo, "scripts", "wire", `${name}.mjs`);
  if (!existsSync(hook)) continue;
  const { default: wire } = await import(pathToFileURL(hook).href);
  const result = wire({ home, herdr, patch }) ?? {};
  checks.push(...(result.checks ?? []));
  if (result.note) notes.push(`${name}: ${result.note}`);
}

for (const m of checks) herdr("check", join(home, "mods", m));
console.log(`installed: ${selected.join(", ")}`);
for (const n of notes) console.log(n);
