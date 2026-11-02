import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkName, copyPlan, createPlan, menuHeight, menuItems, pathsOf, revealPlan, targetFolder,
} from "../mods/file-actions/actions.js";

const ids = (items) => items.map((it) => it.id);
// PowerShell that turns UTF-8 base64 back into the text.
const decoded = (s) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(s, "utf8").toString("base64")}')))`;

test("menu: copy and reveal on macOS and Windows, then new file and folder", () => {
  assert.deepEqual(ids(menuItems("macos", null)), ["copy", "copy-relative", "reveal", "new-file", "new-folder"]);
  assert.equal(menuItems("macos", null)[2].label, "Reveal in Finder");
  assert.equal(menuItems("windows", null)[2].label, "Reveal in Explorer");
});

test("menu: no reveal for a space on another machine, no copy or reveal on Linux", () => {
  assert.deepEqual(ids(menuItems("macos", "devbox")), ["copy", "copy-relative", "new-file", "new-folder"]);
  assert.deepEqual(ids(menuItems("linux", null)), ["new-file", "new-folder"]);
});

test("menu height fits its rows (31 px), padding and the separator", () => {
  assert.equal(menuHeight("macos", null), 10 + 5 * 31 + 9);
  assert.equal(menuHeight("macos", "devbox"), 10 + 4 * 31 + 9);
  assert.equal(menuHeight("linux", null), 10 + 2 * 31);
});

test("full and relative paths, relative to the panel's root", () => {
  assert.deepEqual(pathsOf("/Users/me/repo", "scripts/install.mjs", "macos", null),
    { full: "/Users/me/repo/scripts/install.mjs", relative: "scripts/install.mjs" });
});

test("Windows paths use backslashes on this computer, not on another machine", () => {
  assert.deepEqual(pathsOf("C:/Users/me/repo", "scripts/install.mjs", "windows", null),
    { full: "C:\\Users\\me\\repo\\scripts\\install.mjs", relative: "scripts\\install.mjs" });
  assert.equal(pathsOf("/home/me/repo", "a/b", "windows", "devbox").full, "/home/me/repo/a/b");
});

test("new entries go inside a folder, or beside a file", () => {
  assert.equal(targetFolder("scripts/wire", true), "scripts/wire");
  assert.equal(targetFolder("scripts/install.mjs", false), "scripts");
  assert.equal(targetFolder("README.md", false), "");
});

test("names: one entry, not a path", () => {
  assert.equal(checkName("notes.md"), null);
  assert.equal(checkName("  "), "Enter a name.");
  assert.equal(checkName(".."), "Not a valid name.");
  assert.equal(checkName("a/b"), "A name, not a path.");
  assert.equal(checkName("a\\b"), "A name, not a path.");
});

test("copy: pbcopy on macOS, Set-Clipboard on Windows with quotes escaped, none on Linux", () => {
  assert.deepEqual(copyPlan("/a b/c", "macos"), ["sh", ["-c", 'printf %s "$1" | pbcopy', "copy", "/a b/c"]]);
  assert.deepEqual(copyPlan("C:\\it's", "windows"),
    ["powershell", ["-NoProfile", "-Command", `Set-Clipboard -Value ${decoded("C:\\it's")}`]]);
  assert.equal(copyPlan("/x", "linux"), null);
});

test("reveal: open -R on macOS, explorer /select on Windows ignoring its exit code", () => {
  assert.deepEqual(revealPlan("/a b/c", "macos"), ["open", ["-R", "/a b/c"]]);
  assert.deepEqual(revealPlan("C:\\a\\b", "windows"), ["explorer.exe", ["/select,C:\\a\\b"], { anyExit: true }]);
  assert.equal(revealPlan("/x", "linux"), null);
});

test("create: sh without overwriting on macOS, Linux and other machines", () => {
  assert.deepEqual(createPlan("file", "/r/docs/a.md", "macos", null), ["sh", ["-c", 'set -C; : > "$1"', "new", "/r/docs/a.md"]]);
  assert.deepEqual(createPlan("folder", "/r/docs", "linux", null), ["sh", ["-c", 'mkdir -- "$1"', "new", "/r/docs"]]);
  assert.equal(createPlan("file", "/r/a", "windows", "devbox")[0], "sh");
});

test("create: New-Item on Windows, failing when it exists", () => {
  assert.deepEqual(createPlan("folder", "C:\\r\\it's", "windows", null),
    ["powershell", ["-NoProfile", "-Command", `New-Item -ItemType Directory -Path ${decoded("C:\\r\\it's")} -ErrorAction Stop | Out-Null`]]);
  assert.equal(createPlan("file", "C:\\r\\a", "windows", null)[1][2].includes("-ItemType File"), true);
});

test("Windows: a name can't break out of PowerShell, even with curly quotes", () => {
  const evil = "x\u2019; Start-Process calc; #\u2018\u201a\u201b'ñ😀";
  for (const command of [copyPlan(evil, "windows")[1][2], createPlan("file", `C:\\r\\${evil}`, "windows", null)[1][2]]) {
    assert.equal(/[\u2018-\u201b']([^A-Za-z0-9+/=]|$)/.test(command.replace(/'[A-Za-z0-9+/=]*'/g, "")), false);
    assert.equal(command.includes("Start-Process"), false);
  }
  const b64 = copyPlan(evil, "windows")[1][2].match(/'([A-Za-z0-9+/=]*)'/)[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), evil);
});
