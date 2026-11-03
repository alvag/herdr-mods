import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkName, copyPlan, createError, deletePlan, mentionOf, openPlan, pickAgent, createPlan, menuHeight, menuItems, pathsOf, revealPlan, targetFolder,
} from "../mods/file-actions/actions.js";

const ids = (items) => items.map((it) => it.id);
// PowerShell that turns UTF-8 base64 back into the text.
const decoded = (s) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(s, "utf8").toString("base64")}')))`;

test("menu: copy and reveal, new file and folder, then delete on macOS and Windows", () => {
  assert.deepEqual(ids(menuItems("macos", null)),
    ["copy", "copy-relative", "reveal", "open-vscode", "open-webstorm", "send-agent", "new-file", "new-folder", "delete"]);
  assert.equal(menuItems("macos", null)[2].label, "Reveal in Finder");
  assert.equal(menuItems("windows", null)[2].label, "Reveal in Explorer");
  assert.equal(menuItems("macos", null)[8].label, "Move to Trash");
  assert.equal(menuItems("windows", null)[8].label, "Move to Recycle Bin");
});

test("menu: no reveal or delete on another machine, no copy, reveal or delete on Linux", () => {
  assert.deepEqual(ids(menuItems("macos", "devbox")), ["copy", "copy-relative", "send-agent", "new-file", "new-folder"]);
});

test("menu height fits its rows (31 px), padding and the separator", () => {
  assert.equal(menuHeight("macos", null), 10 + 9 * 31 + 3 * 9);
  assert.equal(menuHeight("macos", "devbox"), 10 + 5 * 31 + 2 * 9);
  assert.equal(menuHeight("linux", null), 10 + 4 * 31 + 9);
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

test("create errors: an existing entry says so by name, other errors pass through", () => {
  assert.equal(createError("new: /r/scripts/install.mjs: cannot overwrite existing file", "install.mjs"), "install.mjs already exists.");
  assert.equal(createError("mkdir: /r/wire: File exists", "wire"), "wire already exists.");
  assert.equal(createError("New-Item : An item with the specified name C:\\r\\a already exists.", "a"), "a already exists.");
  assert.equal(createError("mkdir: /r/x: Permission denied", "x"), "mkdir: /r/x: Permission denied");
});

test("delete: to the Trash with trash -s, else through Finder, on macOS", () => {
  assert.deepEqual(deletePlan("/a b/it's", "macos"), [
    ["trash", ["-s", "/a b/it's"]],
    ["osascript", ["-e", "on run argv", "-e", 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', "-e", "end run", "/a b/it's"]],
  ]);
});

test("delete: to the Recycle Bin on Windows, the path as base64; none elsewhere", () => {
  const [[cmd, args]] = deletePlan("C:\\r\\x\u2019; Start-Process calc", "windows");
  assert.equal(cmd, "powershell");
  assert.equal(args[2].includes("Start-Process"), false);
  assert.equal(args[2].includes("SendToRecycleBin"), true);
  assert.equal(args[2].startsWith("$ErrorActionPreference = 'Stop'"), true);
  assert.deepEqual(deletePlan("/x", "linux"), []);
});

test("menu: Linux keeps the editor rows, no Send to agent (no clipboard)", () => {
  assert.deepEqual(ids(menuItems("linux", null)), ["open-vscode", "open-webstorm", "new-file", "new-folder"]);
});

test("open in an editor: a file inside its project, as open-in-editor launches", () => {
  assert.deepEqual(openPlan("webstorm", "/r/a b.md", "macos", "/r"),
    [["open", ["-a", "WebStorm", "/r", "/r/a b.md"]], ["webstorm", ["/r", "/r/a b.md"]]]);
  assert.deepEqual(openPlan("vscode", "C:\\r\\a", "windows", "C:\\r"), [["code.cmd", ["C:\\r", "C:\\r\\a"]], ["code", ["C:\\r", "C:\\r\\a"]]]);
  assert.deepEqual(openPlan("vscode", "/r/a", "linux", "/r"), [["code", ["/r", "/r/a"]]]);
});

test("open in an editor: a folder alone, as its own project", () => {
  assert.deepEqual(openPlan("vscode", "/r/docs", "macos", null), [["open", ["-a", "Visual Studio Code", "/r/docs"]], ["code", ["/r/docs"]]]);
});

test("mention: relative to the agent's folder when inside it, else the full path", () => {
  assert.equal(mentionOf("/r/scripts/install.mjs", "/r"), "@scripts/install.mjs ");
  assert.equal(mentionOf("/r/scripts/install.mjs", "/r/"), "@scripts/install.mjs ");
  assert.equal(mentionOf("/r2/x.md", "/r"), "@/r2/x.md ");
  assert.equal(mentionOf("/r/x.md", null), "@/r/x.md ");
  assert.equal(mentionOf("C:\\r\\a\\b.md", "C:\\r"), "@a\\b.md ");
});

test("mention: a path with spaces is quoted", () => {
  assert.equal(mentionOf("/r/my docs/a.md", "/r"), '@"my docs/a.md" ');
});

test("agent: the focused one in the space, else the active tab's, else the latest", () => {
  const a = (address, space, tab, extra = {}) => ({ address, space, tab, seq: 0, focused: false, ...extra });
  const list = [a("t1", "s1", "x", { seq: 9 }), a("t2", "s2", "y", { seq: 1 }), a("t3", "s2", "z", { seq: 5 }), a("t4", "s2", "y", { focused: true })];
  assert.equal(pickAgent(list, "s2", "z").address, "t4");
  assert.equal(pickAgent(list.slice(0, 3), "s2", "y").address, "t2");
  assert.equal(pickAgent(list.slice(0, 3), "s2", "nope").address, "t3");
  assert.equal(pickAgent(list, "s3", "y"), null);
});
