import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkName, claimTab, contextOf, copyPlan, pastePlan, createError, deletePlan, languageOf, planOpen, previewOf, tabTitle, mentionOf, openPlan, pasteBlocker, pasteSteps, pickAgent, reloadOnFocus, runSteps, createPlan, menuHeight, menuItems, opensImage, pathsOf, revealPlan, targetFolder,
} from "../mods/file-actions/actions.js";

const ids = (items) => items.map((it) => it.id);
// PowerShell that turns UTF-8 base64 back into the text.
const decoded = (s) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(s, "utf8").toString("base64")}')))`;

test("opensImage: image files on this machine open in the image-viewer mod", () => {
  for (const n of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.svg", "h.ico", "i.tiff", "j.TIF"]) {
    assert.equal(opensImage(n, null), true, n);
  }
  for (const n of ["a.txt", "b.js", "c.md", "d.pngx", "png", "e.PnG.md", ""]) {
    assert.equal(opensImage(n, null), false, n);
  }
  assert.equal(opensImage("a.png", "machine2"), false, "another machine's file: the viewer reads local files only");
});

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
  assert.deepEqual(copyPlan("/a b/c", "macos"), ["sh", ["-c", 'printf %s "$1" | LANG=en_US.UTF-8 pbcopy', "copy", "/a b/c"]]);
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

test("send to agent: refuses a missing agent or one waiting on a dialog", () => {
  assert.equal(pasteBlocker(null), "No agent in this space");
  assert.equal(pasteBlocker({ address: "t3", status: "blocked", title: "pi" }), "t3 is waiting for an answer");
  for (const status of ["idle", "working", "done"]) assert.equal(pasteBlocker({ address: "t3", status }), null);
});

test("send to agent: pastes, then shows the agent's live screen", () => {
  assert.deepEqual(pasteSteps("t3"), [
    ["terminal.paste", {}],
    ["terminal.scroll", { to: "bottom", terminal: "t3" }, { optional: true }],
  ]);
});

test("send to agent: a scroll that fails doesn't fail a paste that worked", () => {
  const ran = [];
  const run = (command) => { ran.push(command); if (command === "terminal.scroll") throw new Error("unknown command"); };
  assert.doesNotThrow(() => runSteps(pasteSteps("t3"), run));
  assert.deepEqual(ran, ["terminal.paste", "terminal.scroll"]);
});

test("send to agent: a paste that fails stops there and fails", () => {
  const ran = [];
  const run = (command) => { ran.push(command); if (command === "terminal.paste") throw new Error("no terminal"); };
  assert.throws(() => runSteps(pasteSteps("t3"), run), /no terminal/);
  assert.deepEqual(ran, ["terminal.paste"]);
});

test("viewer: another machine's file reloads when the window gets focus back", () => {
  assert.equal(reloadOnFocus(false, true, "devbox"), true);
  // Not on the first render, not while focus stays or goes away.
  for (const [was, now] of [[undefined, true], [true, true], [true, false], [false, false], [undefined, false]])
    assert.equal(reloadOnFocus(was, now, "devbox"), false, `${was} -> ${now}`);
  // This computer's files already reload when their folder changes.
  for (const on of [null, undefined, ""]) assert.equal(reloadOnFocus(false, true, on), false);
});

test("viewer: the language from the extension, as the Files panel maps it", () => {
  assert.equal(languageOf("src/app.component.ts"), "js");
  assert.equal(languageOf("a/b.vue"), "html");
  assert.equal(languageOf("README.md"), "md");
  assert.equal(languageOf("Makefile"), "txt");
  assert.equal(languageOf(".gitignore"), "gitignore");
});

test("viewer: text as is, a gone or binary file says so, a big one is cut", () => {
  assert.deepEqual(previewOf("hi\n"), { value: "hi\n" });
  assert.deepEqual(previewOf(null), { error: "This file is no longer available" });
  assert.deepEqual(previewOf("a\0b"), { error: "Binary file · no text preview" });
  const big = previewOf("x".repeat(400001));
  assert.equal(big.value.length, 400000 + "\n… (file truncated)".length);
  assert.equal(big.value.endsWith("… (file truncated)"), true);
});

test("tab title: a preview tab is marked, a pinned one isn't", () => {
  assert.equal(tabTitle("install.sh", true), "◌ install.sh");
  assert.equal(tabTitle("install.sh", false), "install.sh");
});

const file = (view, name = view.split("/").pop()) => ({ view, root: "/r", on: null, name });
const live = (...ids) => new Set(ids);

test("open: the first click makes a preview tab", () => {
  const r = planOpen({}, live(), "s1", file("a.js"), false, "k1");
  assert.equal(r.action, "new");
  assert.equal(r.key, "k1");
  assert.deepEqual(r.entries.k1, { view: "a.js", root: "/r", on: null, name: "a.js", space: "s1", tab: null, preview: true });
});

test("open: another file reuses the space's preview tab and renames it", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: "t1", preview: true } };
  const r = planOpen(entries, live("t1"), "s1", file("b/c.md"), false, "k2");
  assert.deepEqual([r.action, r.key, r.rename], ["replace", "k1", "◌ c.md"]);
  assert.equal(r.entries.k1.view, "b/c.md");
  assert.equal(r.entries.k2, undefined);
});

test("open: a file already open selects its tab, no duplicate", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: "t1", preview: false }, k2: { ...file("b.js"), space: "s1", tab: "t2", preview: true } };
  const r = planOpen(entries, live("t1", "t2"), "s1", file("a.js"), false, "k3");
  assert.deepEqual([r.action, r.key, r.rename], ["select", "k1", undefined]);
  assert.deepEqual(r.entries, entries);
});

test("open: a double click pins the preview tab; the next file gets a new preview", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: "t1", preview: true } };
  const pinned = planOpen(entries, live("t1"), "s1", file("a.js"), true, "k2");
  assert.deepEqual([pinned.action, pinned.key, pinned.rename, pinned.entries.k1.preview], ["select", "k1", "a.js", false]);
  const next = planOpen(pinned.entries, live("t1"), "s1", file("b.js"), false, "k3");
  assert.deepEqual([next.action, next.key], ["new", "k3"]);
});

test("open: closed tabs are forgotten; each space has its own preview tab", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: "t1", preview: true }, k2: { ...file("a.js"), space: "s2", tab: "t2", preview: true } };
  const r = planOpen(entries, live("t2"), "s1", file("a.js"), false, "k3");
  assert.deepEqual([r.action, r.key], ["new", "k3"]);
  assert.equal(r.entries.k1, undefined);
  assert.equal(r.entries.k2.tab, "t2");
});

test("open: a tab not registered yet is kept, and not reused", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: null, preview: true } };
  const r = planOpen(entries, live(), "s1", file("a.js"), false, "k2");
  assert.deepEqual([r.action, r.key], ["select", "k1"]);
});

test("claim: a new tab takes its own pane, never an earlier version's viewer", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: null, preview: true } };
  const tabs = [{ id: "old", name: "README.md" }, { id: "t1", name: "◌ a.js" }];
  const panes = [{ mod: "file-actions", tab: "old" }, { mod: "file-actions", tab: "t1" }];
  assert.equal(claimTab(entries, "k1", panes, tabs, "t1"), "t1");
  assert.equal(claimTab(entries, "k1", panes, tabs, "x"), "t1");
});

test("claim: nothing when the pane isn't there yet or the name is ambiguous", () => {
  const entries = { k1: { ...file("a.js"), space: "s1", tab: null, preview: true }, k2: { ...file("b.js"), space: "s1", tab: "t2", preview: false } };
  assert.equal(claimTab(entries, "k1", [{ mod: "file-actions", tab: "old" }], [{ id: "old", name: "README.md" }], "old"), null);
  const twins = [{ id: "t1", name: "◌ a.js" }, { id: "t3", name: "◌ a.js" }];
  assert.equal(claimTab(entries, "k1", [{ mod: "file-actions", tab: "t1" }, { mod: "file-actions", tab: "t3" }], twins, "x"), null);
  assert.equal(claimTab(entries, "k1", [{ mod: "file-actions", tab: "t2" }], [{ id: "t2", name: "◌ a.js" }], "t2"), null);
});

test("claim: an earlier viewer with the very same name is never taken", () => {
  const entries = { k1: { ...file("README.md"), space: "s1", tab: null, preview: false, before: ["old"] } };
  const tabs = [{ id: "old", name: "README.md" }];
  // The new tab isn't there yet: the earlier one must not be claimed, active or not.
  assert.equal(claimTab(entries, "k1", [{ mod: "file-actions", tab: "old" }], tabs, "old"), null);
  const both = [...tabs, { id: "t1", name: "README.md" }];
  assert.equal(claimTab(entries, "k1", [{ mod: "file-actions", tab: "old" }, { mod: "file-actions", tab: "t1" }], both, "old"), "t1");
});

test("open: a new tab remembers which tabs existed before it", () => {
  const r = planOpen({}, live("t1", "t2"), "s1", file("a.js"), false, "k1", ["t1", "t2"]);
  assert.deepEqual(r.entries.k1.before, ["t1", "t2"]);
});

const BIOME = '{\n\t"files": {\n\t\t"includes": ["**"]\n\t},\n\t"formatter": {\n\t\t"enabled": true,\n\t\t"lineWidth": 120\n\t},\n\t"linter": {}\n}\n';

test("context: file, lines and a fenced block named after the extension", () => {
  const copied = '"formatter": {\n\t\t"enabled": true,\n\t\t"lineWidth": 120\n\t},';
  assert.deepEqual(contextOf(BIOME, copied, "biome.json"), {
    text: 'File: biome.json\nLines: 5-8\n\n```json\n"formatter": {\n\t\t"enabled": true,\n\t\t"lineWidth": 120\n\t},\n```',
    unique: true,
  });
});

test("context: one line says Line; a trailing newline isn't an extra line", () => {
  assert.equal(contextOf(BIOME, '"linter": {}\n', "a/biome.json").text, 'File: a/biome.json\nLine: 9\n\n```json\n"linter": {}\n```');
  assert.equal(contextOf("x\n", "x", "Makefile").text, "File: Makefile\nLine: 1\n\n```\nx\n```");
});

test("context: text found twice takes the first and says so; not found or empty is null", () => {
  const r = contextOf("a\nb\na\n", "a", "f.txt");
  assert.deepEqual([r.text.split("\n")[1], r.unique], ["Line: 1", false]);
  assert.equal(contextOf(BIOME, "nope", "biome.json"), null);
  assert.equal(contextOf(BIOME, "", "biome.json"), null);
});

test("paste: pbpaste with UTF-8 on macOS, Get-Clipboard as UTF-8 on Windows, none elsewhere", () => {
  assert.deepEqual(pastePlan("macos"), ["sh", ["-c", "LANG=en_US.UTF-8 pbpaste"]]);
  assert.deepEqual(pastePlan("windows"), ["powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw"]]);
  assert.equal(pastePlan("linux"), null);
});

test("context: text with ``` gets a longer fence", () => {
  const md = "# Install\n\n```sh\nnpm test\n```\n";
  assert.equal(contextOf(md, "```sh\nnpm test\n```", "README.md").text,
    "File: README.md\nLines: 3-5\n\n````md\n```sh\nnpm test\n```\n````");
});

test("context: Windows line endings in the file or the clipboard still match", () => {
  const crlf = "a\r\nb\r\nc\r\n";
  assert.equal(contextOf(crlf, "b\nc", "f.txt").text, "File: f.txt\nLines: 2-3\n\n```txt\nb\nc\n```");
  assert.equal(contextOf("a\nb\nc\n", "b\r\nc\r\n", "f.txt").text, "File: f.txt\nLines: 2-3\n\n```txt\nb\nc\n```");
});
