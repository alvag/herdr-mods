import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentsUrl, curlArgs, externalNotice, folderUrl, idleLabel, label, openCommand, outdatedExternal, parseTree } from "../mods/mods-updates/check.js";
import { addEntry, parseRegistry, parseTrackArgs, removeEntry } from "../scripts/external.mjs";
import { parseVersion, renderVersion } from "../scripts/version.mjs";

const PATH = "filetree/mods/file-icons";
const list = JSON.stringify([{ name: "other", type: "dir", sha: "1" }, { name: "file-icons", type: "dir", sha: "abc" }, { name: "x", type: "file", sha: "2" }]);

test("contents response: the dir's sha; missing, a file, garbage are null", () => {
  assert.equal(parseTree(list, PATH), "abc");
  assert.equal(parseTree(list, "a/nope"), null);
  assert.equal(parseTree(list, "a/x"), null);
  assert.equal(parseTree("not json", PATH), null);
  assert.equal(parseTree('{"message":"Not Found"}', PATH), null);
  assert.equal(parseTree(undefined, PATH), null);
});

test("urls: contents of the parent folder, and the folder on GitHub", () => {
  assert.equal(contentsUrl("o/r", PATH), "https://api.github.com/repos/o/r/contents/filetree/mods?ref=HEAD");
  assert.equal(contentsUrl("o/r", "mod"), "https://api.github.com/repos/o/r/contents/?ref=HEAD");
  assert.equal(folderUrl("o/r", PATH), "https://github.com/o/r/tree/HEAD/filetree/mods/file-icons");
});

test("external outdated: remote known and different; unknown remote is not", () => {
  const ext = { a: { tree: "1" }, b: { tree: "1" }, c: { tree: "1" } };
  assert.deepEqual(outdatedExternal(ext, { a: "1", b: "2" }), ["b"]);
  assert.deepEqual(outdatedExternal(ext, undefined), []);
  assert.deepEqual(outdatedExternal(undefined, { a: "2" }), []);
});

test("label: none, herdr-mods only, one external, several", () => {
  assert.equal(label(false, []), null);
  assert.equal(label(true, []), "herdr-mods ↑");
  assert.equal(label(false, ["file-icons"]), "file-icons ↑");
  assert.equal(label(false, ["a", "b"]), "2 updates ↑");
  assert.equal(label(true, ["a"]), "2 updates ↑");
});

test("idle label: up to date once a check answered, nothing before", () => {
  assert.equal(idleLabel(1793821444821), "up to date");
  assert.equal(idleLabel(undefined), null);
  assert.equal(idleLabel(null), null);
});

test("notice: track command, plus the dependent mod when known", () => {
  assert.deepEqual(externalNotice("file-icons", { repo: "o/r", path: PATH }), {
    title: "file-icons has an update",
    body: `Review it on GitHub, update it, then run: npx github:alvag/herdr-mods track file-icons o/r ${PATH} and install file-actions again.`,
  });
  assert.equal(externalNotice("x", { repo: "o/r", path: "p" }).body, "Review it on GitHub, update it, then run: npx github:alvag/herdr-mods track x o/r p");
});

test("open a page: open, xdg-open, explorer.exe", () => {
  assert.deepEqual(openCommand("macos", "u"), ["open", ["u"]]);
  assert.deepEqual(openCommand("linux", "u"), ["xdg-open", ["u"]]);
  assert.deepEqual(openCommand("windows", "u"), ["explorer.exe", ["u"]]);
});

test("track args: valid; missing, bad repo, odd path, extra are usage errors", () => {
  assert.deepEqual(parseTrackArgs(["n", "o/r", PATH]), { name: "n", repo: "o/r", path: PATH });
  for (const bad of [[], ["n", "o/r"], ["n", "repo", "p"], ["n", "o/r", "../p"], ["n", "o/r", "/p"], ["n", "o/r", "p", "x"]]) assert.throws(() => parseTrackArgs(bad), /Usage: track/);
});

test("registry: add merges sorted, remove drops or fails, parse tolerates garbage", () => {
  const reg = addEntry(addEntry({}, "b", { tree: "1" }), "a", { tree: "2" });
  assert.deepEqual(Object.keys(reg), ["a", "b"]);
  assert.deepEqual(addEntry(reg, "a", { tree: "3" }).a, { tree: "3" });
  assert.deepEqual(removeEntry(reg, "a"), { b: { tree: "1" } });
  assert.throws(() => removeEntry(reg, "zz"), /Not tracked: zz\. Tracked: a, b/);
  assert.deepEqual(parseRegistry("nope"), {});
  assert.deepEqual(parseRegistry("[]"), {});
});

test("version.js round trips with external", () => {
  const v = { mods: {}, source: { kind: "npx" }, external: { n: { repo: "o/r", path: "p", tree: "t" } } };
  assert.deepEqual(parseVersion(renderVersion(v)), v);
});

test("installer untrack/track errors and untrack refresh, in a scratch home", () => {
  const home = mkdtempSync(join(tmpdir(), "herdr-ext-"));
  try {
    const run = (...args) => spawnSync("node", ["scripts/install.mjs", ...args], { encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: home } });
    assert.equal(run("untrack", "n").status, 1);
    mkdirSync(join(home, "mods", "mods-updates"), { recursive: true });
    const ext = { n: { repo: "o/r", path: "p", tree: "t" } };
    writeFileSync(join(home, "mods", "mods-updates", "version.js"), renderVersion({ mods: {}, source: null, external: ext }));
    writeFileSync(join(home, "herdr-mods.external.json"), JSON.stringify(ext));
    const bad = run("untrack", "zz");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Not tracked: zz/);
    assert.equal(run("track", "n").status, 1);
    const ok = run("untrack", "n");
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /untracked n/);
    assert.deepEqual(parseVersion(readFileSync(join(home, "mods", "mods-updates", "version.js"), "utf8")).external, {});
    assert.deepEqual(JSON.parse(readFileSync(join(home, "herdr-mods.external.json"), "utf8")), {});
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("URLs encode each path segment and keep the slashes", () => {
  assert.equal(contentsUrl("o/r", "my mods/a#b/x"), "https://api.github.com/repos/o/r/contents/my%20mods/a%23b?ref=HEAD");
  assert.equal(folderUrl("o/r", "my mods/x?y"), "https://github.com/o/r/tree/HEAD/my%20mods/x%3Fy");
});

test("curl gives up on a stalled request", () => {
  assert.deepEqual(curlArgs("https://x"), ["-fsS", "--connect-timeout", "10", "--max-time", "30", "-H", "Accept: application/vnd.github+json", "https://x"]);
});
