#!/usr/bin/env node
// Installs mods from this repo into the Herdr app home.
//
//   node scripts/install.mjs                 every mod in mods/
//   node scripts/install.mjs open-in-editor  only the named ones
//   npx github:alvag/herdr-mods [names]      same, without cloning this repo
//
// mods-updates (the status bar's update notice) is always installed with the
// selection; the installer records the installed commit and mods in its
// version.js, in the installed copy only.
//
// Each mod folder is copied to <home>/mods/. A mod that needs more than its
// folder (clones, menu rows, layouts) has a hook in scripts/wire/<name>.mjs,
// run only when that mod is installed. Safe to run again: patches already
// applied are skipped.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseLsRemote } from "../mods/mods-updates/check.js";
import { selectMods, withNotifier } from "./select.mjs";
import { commitFromLock, parseVersion, recordedMods, renderVersion } from "./version.mjs";

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
  selected = withNotifier(selectMods(available, process.argv.slice(2)));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const checks = [];
const notes = [];
for (const name of selected) {
  // Keeps the recorded version.js: the default one would only be rewritten below.
  const keep = join(home, "mods", name, "version.js");
  cpSync(join(repo, "mods", name), join(home, "mods", name), { recursive: true, filter: (src) => !(name === "mods-updates" && basename(src) === "version.js" && existsSync(keep)) });
  console.log(`copied mods/${name}`);
  checks.push(name);
  const hook = join(repo, "scripts", "wire", `${name}.mjs`);
  if (!existsSync(hook)) continue;
  const { default: wire } = await import(pathToFileURL(hook).href);
  const result = wire({ home, herdr, patch }) ?? {};
  checks.push(...(result.checks ?? []));
  if (result.note) notes.push(`${name}: ${result.note}`);
}

// What was installed, so mods-updates can tell when GitHub has something newer.
const git = (...args) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
const clone = existsSync(join(repo, ".git"));
const lock = join(repo, "..", "..", "package-lock.json");
const commit = (clone ? git("-C", repo, "rev-parse", "HEAD").trim() : commitFromLock(existsSync(lock) ? readFileSync(lock, "utf8") : null))
  || parseLsRemote(git("ls-remote", "https://github.com/alvag/herdr-mods.git", "refs/heads/main")) || null;
const versionFile = join(home, "mods", "mods-updates", "version.js");
const previous = parseVersion(existsSync(versionFile) ? readFileSync(versionFile, "utf8") : "");
const existing = readdirSync(join(home, "mods"));
const version = renderVersion({ commit, mods: recordedMods(previous?.mods, selected, existing), source: clone ? { kind: "clone", path: repo } : { kind: "npx" } });
if (!existsSync(versionFile) || readFileSync(versionFile, "utf8") !== version) writeFileSync(versionFile, version);

for (const m of checks) herdr("check", join(home, "mods", m));
console.log(`installed: ${selected.join(", ")}`);
for (const n of notes) console.log(n);
