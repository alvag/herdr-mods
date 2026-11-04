import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, isDue, isOutdated, parseLsRemote, updatePlan, waitMs } from "../mods/mods-updates/check.js";
import { commitFromLock, parseVersion, recordedMods, renderVersion } from "../scripts/version.mjs";
import { withNotifier } from "../scripts/select.mjs";
import { withUpdatesBlock } from "../scripts/wire/mods-updates.mjs";

const A = "a".repeat(40), B = "b".repeat(40);
const decoded = (s) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(s, "utf8").toString("base64")}')))`;

test("ls-remote: the sha of refs/heads/main; empty or garbage is null", () => {
  assert.equal(parseLsRemote(`${A}\trefs/heads/main\n`), A);
  assert.equal(parseLsRemote(""), null);
  assert.equal(parseLsRemote("fatal: unable to access\n"), null);
  assert.equal(parseLsRemote(`${A}\trefs/heads/other\n`), null);
  assert.equal(parseLsRemote(undefined), null);
});

test("outdated only when both shas are known and differ", () => {
  assert.equal(isOutdated(A, A), false);
  assert.equal(isOutdated(A, B), true);
  assert.equal(isOutdated(null, B), false);
  assert.equal(isOutdated(A, null), false);
});

test("a check is due with no last check or after a day", () => {
  assert.equal(isDue(null, 1000), true);
  assert.equal(isDue(1000, 1000 + DAY - 1), false);
  assert.equal(isDue(1000, 1000 + DAY), true);
  assert.equal(waitMs(1000, 1000 + DAY - 5), 5);
  assert.equal(waitMs(null, 1000), 0);
});

test("update via npx: names the mods, npx.cmd on Windows", () => {
  const base = { name: "Update herdr-mods" };
  assert.deepEqual(updatePlan({ kind: "npx" }, ["file-actions", "open-in-editor"], "macos"),
    { ...base, argv: ["npx", "--yes", "github:alvag/herdr-mods", "file-actions", "open-in-editor"] });
  assert.deepEqual(updatePlan({ kind: "npx" }, ["a b", "it's"], "windows"),
    { ...base, argv: ["npx.cmd", "--yes", "github:alvag/herdr-mods", "a b", "it's"] });
  assert.deepEqual(updatePlan({ kind: "npx" }, [], "macos").argv.slice(3), ["mods-updates"]);
});

test("update from a clone: pull then install, names as arguments, never in the script", () => {
  const path = `/Users/me/my repo's "x"`;
  const mods = ["file-actions", `we ird"$(x)`];
  assert.deepEqual(updatePlan({ kind: "clone", path }, mods, "macos"), {
    name: "Update herdr-mods", folder: path,
    argv: ["sh", "-c", 'git pull --ff-only && npm run install-mod -- "$@"', "sh", ...mods],
  });
  const win = updatePlan({ kind: "clone", path: "C:\\my repo" }, mods, "windows");
  assert.equal(win.folder, "C:\\my repo");
  assert.deepEqual(win.argv.slice(0, 3), ["powershell", "-NoProfile", "-Command"]);
  assert.equal(win.argv[3], `git pull --ff-only; if ($LASTEXITCODE -eq 0) { npm.cmd run install-mod -- ${mods.map(decoded).join(" ")} }`);
  assert.ok(!win.argv[3].includes("we ird"));
});

test("no update plan without a source", () => {
  assert.equal(updatePlan(null, ["a"], "macos"), null);
});

test("commit from an npx package-lock", () => {
  const lock = `{"packages":{"node_modules/herdr-mods":{"resolved":"git+ssh://git@github.com/alvag/herdr-mods.git#${A}","version":"1.0.0"}}}`;
  assert.equal(commitFromLock(lock), A);
  assert.equal(commitFromLock('{"packages":{}}'), null);
  assert.equal(commitFromLock("not json"), null);
  assert.equal(commitFromLock(null), null);
});

test("recorded mods: union with the previous ones, only installed folders, sorted, no mods-updates", () => {
  assert.deepEqual(recordedMods(["open-in-editor", "gone"], ["file-actions", "mods-updates", "open-in-editor"], ["file-actions", "open-in-editor", "mods-updates", "other"]),
    ["file-actions", "open-in-editor"]);
  assert.deepEqual(recordedMods(undefined, [], []), []);
});

test("version.js round trips", () => {
  const v = { commit: A, mods: ["file-actions"], source: { kind: "clone", path: "/a b/c" } };
  assert.deepEqual(parseVersion(renderVersion(v)), v);
  assert.match(renderVersion(v), /^export default \{/);
  assert.equal(parseVersion("garbage"), null);
  assert.equal(parseVersion(null), null);
});

test("the notifier is always installed, once", () => {
  assert.deepEqual(withNotifier(["file-actions"]), ["file-actions", "mods-updates"]);
  assert.deepEqual(withNotifier(["mods-updates", "a"]), ["mods-updates", "a"]);
});

const layout = () => ({
  id: "root", type: "row", children: [{ id: "work", type: "column", children: [
    { id: "tabs", type: "block", content: { mod: "tabs" }, size: { px: 42 } },
    { id: "status", type: "block", content: { mod: "workspace-status" }, size: { px: 28 } },
  ] }],
});

test("layout: the status block becomes a 28 px row with the notifier at the right", () => {
  const out = withUpdatesBlock(layout(), "my-main.json");
  const row = out.children[0].children[1];
  assert.deepEqual(row, {
    id: "status", type: "row", size: { px: 28 }, resizable: false,
    children: [
      { id: "status-main", type: "block", content: { mod: "workspace-status" }, size: { weight: 1 } },
      { id: "status-updates", type: "block", content: { mod: "mods-updates" }, size: { px: 110 } },
    ],
  });
  assert.deepEqual(out.children[0].children[0], layout().children[0].children[0]);
});

test("layout: a second run changes nothing (null)", () => {
  assert.equal(withUpdatesBlock(withUpdatesBlock(layout(), "f"), "f"), null);
});

test("layout: no status block fails naming the file", () => {
  assert.throws(() => withUpdatesBlock({ id: "root", type: "row", children: [] }, "my-main.json"), /my-main\.json: status block not found/);
});
