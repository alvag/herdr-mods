import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The production main.js, notes-ui.js and notes-send.js, loaded unchanged next to stubs of the modules the Herdr
// runtime provides. The stub elements keep what a view gives them, so a test renders, presses a control by id and
// reads the text on screen. `log` records, in order, every clipboard write and every command sent to Herdr.
const SRC = new URL("../mods/file-actions/", import.meta.url).pathname;
const NODE = Symbol("node");
const STUBS = {
  "gpui-kit": `
    export class View {}
    export const div = () => globalThis.__ui.el("div"), svg = () => globalThis.__ui.el("svg");`,
  "gpui-base": `
    const e = (kind) => () => globalThis.__ui.el(kind);
    export const v_flex = e("v"), h_flex = e("h"), InputState = { new: e("input-state") }, Input = { new: e("input") };
    export const Editor = { new: e("editor") }, EditorState = { new: () => ({ release() {} }) };
    export const Checkbox = { new: (id) => globalThis.__ui.el("checkbox").id(id) };
    export const Textarea = { new: () => globalThis.__ui.el("textarea") }, TextareaState = { new: () => ({ focus() {}, on() {}, release() {}, value: () => "" }) };`,
  herdr: `
    const ui = () => globalThis.__ui;
    export const agents = () => ui().agents, focused = () => ui().focus, panes = () => ui().panes, spaces = () => ui().spaces, watchFolder = () => new Promise(() => {});
    export const run = (cmd, args) => { ui().log.push(["run", cmd, args]); ui().onRun?.(cmd, args); };
    export const props = () => ui().props, shared = (k) => ui().store[k], settings = () => ({ font_family: "mono" });
    export const theme = () => new Proxy({}, { get: () => "#000" }), window = () => ({ platform: ui().platform, active: true });
    export const setShared = (k, v) => { ui().sets++; ui().store[k] = v; };
    export const openOverlay = (o) => { ui().overlays.push(o); return "ov" + ui().overlays.length; }, closeOverlay = (id) => ui().closed.push(id);
    export const notify = (n) => ui().notes.push(n);
    export const readTextFile = async (path) => { ui().reads++; await ui().onRead?.(ui().reads); const t = ui().files[path]; if (t instanceof Error) throw t; return t; };
    export const exec = async (cmd, args) => { ui().log.push(["copy", args[3]]); await ui().onCopy?.(); return { code: 0, stdout: "", stderr: "" }; };`,
};

function el(kind) {
  const node = { kind, ident: null, kids: [], click: null, change: null, checked: undefined };
  const set = {
    id: (v) => { node.ident = v; },
    on_click: (f) => { node.click = f; },
    on_key_down: (f) => { node.keydown = f; },
    on_change: (f) => { node.change = f; },
    checked: (v) => { node.checked = v; },
    child: (c) => { node.kids.push(c); },
    children: (cs) => { node.kids.push(...cs); },
  };
  const proxy = new Proxy(node, { get: (_t, k) => {
    if (k === NODE) return node;
    if (typeof k === "symbol") return undefined;
    return (...a) => (k === "when" ? (a[0] ? a[1](proxy) ?? proxy : proxy) : (set[k]?.(...a), proxy));
  } });
  return proxy;
}

const nodes = (x, out = []) => {
  if (x?.[NODE]) { out.push(x[NODE]); x[NODE].kids.forEach((k) => nodes(k, out)); }
  return out;
};
const find = (tree, ident) => nodes(tree).find((n) => n.ident === ident);
const texts = (x, out = []) => {
  if (typeof x === "string") out.push(x);
  else x?.[NODE]?.kids.forEach((k) => texts(k, out));
  return out;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const FILE = { on: null, root: "/repo", view: "src/a.js" };
const PATH = "/repo/src/a.js";
const TEXT = "alpha beta\ngamma delta\nepsilon\n";
const N1 = { id: "n1", file: FILE, range: { first: 1, last: 1, column: 0 }, excerpt: "alpha beta", note: "First" };
const N2 = { id: "n2", file: FILE, range: { first: 2, last: 3, column: 0 }, excerpt: "gamma delta\nepsilon", note: "Second\nline" };
const stored = (...notes) => ({ next: notes.length + 1, notes });
const agent = (address, extra = {}) => ({ address, pane: `p-${address}`, space: "s1", tab: "t1", tab_name: "main", status: "idle", app: "pi", title: "", seq: 1, focused: false, ...extra });
const P1 = "File: src/a.js\n\nLine: 1\n\n```js\nalpha beta\n```\n\nNote: First";
const P2 = "Lines: 2-3\n\n```js\ngamma delta\nepsilon\n```\n\nNote: Second\nline";

let dir, FileActions, NOTES;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "fa-notes-send-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  for (const [name, code] of Object.entries(STUBS)) {
    const pkg = join(dir, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), `{"name":"${name}","type":"module","main":"index.js"}`);
    writeFileSync(join(pkg, "index.js"), code);
  }
  for (const f of ["main.js", "actions.js", "notes.js", "notes-ui.js", "notes-send.js"]) cpSync(join(SRC, f), join(dir, f));
  globalThis.__ui = { el };
  FileActions = (await import(pathToFileURL(join(dir, "main.js")).href)).default;
  NOTES = (await import(pathToFileURL(join(dir, "notes.js")).href)).NOTES;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
  delete globalThis.__ui;
});

beforeEach(() => {
  Object.assign(globalThis.__ui, {
    store: { [NOTES]: stored(N1, N2) }, sets: 0, overlays: [], closed: [], notes: [], log: [], reads: 0, platform: "macos",
    files: { [PATH]: TEXT }, props: { view: "src/a.js", root: "/repo" }, spaces: [{ id: "s9", active: true, tabs: [] }], panes: [],
    agents: [agent("t1")], focus: { pane: "p-files", space: "s1" }, onRun: null, onRead: null, onCopy: null,
  });
  // Herdr applies pane.focus a moment later.
  globalThis.__ui.onRun = (cmd, a) => {
    if (cmd !== "pane.focus") return;
    const found = globalThis.__ui.agents.find((x) => x.address === a.terminal);
    setTimeout(() => { if (found && !globalThis.__ui.noFocus) globalThis.__ui.focus = { pane: found.pane, space: found.space }; }, 0);
  };
  globalThis.__ui.noFocus = false;
});

// Mounts a view the way Herdr does; every task it spawns is awaited by settle().
async function mount() {
  const pending = [];
  const taskCx = { notify() {}, timer: { after: (_ms, cb) => setTimeout(cb, 0) }, read_from_clipboard() { throw new Error("stale cx"); } };
  const cx = {
    notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), timer: { after() {} },
    spawn: (fn) => { const p = fn(taskCx); pending.push(p); return p; },
    read_from_clipboard: () => "gamma delta", write_to_clipboard() { throw new Error("the event clipboard is not for sends"); },
  };
  const view = new FileActions();
  view.platform = globalThis.__ui.platform;
  view.init?.({}, cx);
  let tree = view.render(cx);
  const settle = async () => { for (let i = 0; i < 4 || (view.sender?.sending && i < 200); i++) { await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 5))]); await tick(); } };
  await settle();
  const draw = () => (tree = view.render(cx));
  draw();
  return {
    view, draw, settle,
    get tree() { return tree; },
    get lines() { return texts(tree); },
    get text() { return texts(tree).join("\n"); },
    // Pressing a control that isn't there, or is disabled (no handler), does nothing.
    async press(id) { draw(); find(tree, id)?.click?.({}, cx); await settle(); draw(); },
    async toggle(id, on) { draw(); find(tree, id).change(on, cx); await settle(); draw(); },
  };
}

const viewer = () => mount();
async function chooser(ids = ["n1"], space = "s1", file = FILE) {
  globalThis.__ui.props = { sendNotes: true, file, ids, space, overlay: "ov1" };
  return mount();
}
const kinds = (u) => u.log.map((l) => l[0] === "run" ? l[1] : l[0]);
const pristine = (u, store) => { assert.equal(u.sets, 0); assert.deepEqual(u.store[NOTES], store); };

test("a card's Send opens the chooser for that note in the space of its tab entry", async () => {
  const u = globalThis.__ui;
  u.props = { key: "k1" };
  u.store["file-actions.tabs"] = { k1: { view: "src/a.js", root: "/repo", on: null, space: "s2", tab: "t7" } };
  const v = await viewer();
  await v.press("fa-note-send-n2");
  assert.deepEqual(u.overlays.map((o) => [o.mod, o.kind, o.props]), [["file-actions", "dialog", { sendNotes: true, file: FILE, ids: ["n2"], space: "s2" }]]);
  assert.deepEqual(u.log, []);
  pristine(u, stored(N1, N2));
});

test("Send selected takes the ticked notes in the order added; a legacy view uses the active space", async () => {
  const u = globalThis.__ui;
  const v = await viewer();
  assert.equal(find(v.tree, "fa-notes-send-selected"), undefined);
  await v.toggle("fa-note-pick-n2", true);
  await v.toggle("fa-note-pick-n1", true);
  await v.press("fa-notes-send-selected");
  assert.deepEqual(u.overlays.map((o) => o.props), [{ sendNotes: true, file: FILE, ids: ["n1", "n2"], space: "s9" }]);
  pristine(u, stored(N1, N2));
});

test("Send is not offered while the notes are corrupt, the file is not loaded or the platform has no clipboard", async () => {
  const u = globalThis.__ui;
  u.store[NOTES] = { next: 0, notes: [] };
  await (await viewer()).press("fa-note-send-n1");
  u.store[NOTES] = stored(N1);
  u.files[PATH] = new Error("denied");
  await (await viewer()).press("fa-note-send-n1");
  u.files[PATH] = TEXT;
  u.platform = "linux";
  await (await viewer()).press("fa-note-send-n1");
  assert.deepEqual(u.overlays, []);
});

test("the chooser previews one note as plain text with its destination before anything is sent", async () => {
  const u = globalThis.__ui;
  u.agents = [agent("t1", { app: "claude-code", status: "working" })];
  const c = await chooser(["n1"]);
  assert.ok(c.lines.includes(P1));
  assert.match(c.text, /Send 1 note to an agent/);
  assert.match(c.text, /Destination: choose an agent/);
  assert.match(c.text, /claude-code · t1 · working/);
  assert.match(c.text, /without pressing Enter/);
  assert.match(c.text, /replaces what you had copied/);
  await c.press("fa-send-agent-t1");
  assert.match(c.text, /Destination: claude-code · t1 · working/);
  assert.deepEqual(u.log, []);
});

test("a batch is pasted in the order notes were added, each fenced safely", async () => {
  const u = globalThis.__ui;
  const ticks = { ...N1, excerpt: "alpha ```x``` beta", note: "Has ticks" };
  u.store[NOTES] = stored(ticks, N2);
  u.files[PATH] = "alpha ```x``` beta\ngamma delta\nepsilon\n";
  const c = await chooser(["n2", "n1"]);
  const expected = [
    "File: src/a.js",
    "Line: 1\n\n````js\nalpha ```x``` beta\n````\n\nNote: Has ticks",
    P2,
  ].join("\n\n");
  assert.ok(c.lines.includes(expected));
  assert.match(c.text, /Send 2 notes to an agent/);
});

test("a note of a file on another machine names the machine; a file without extension has no language", async () => {
  const u = globalThis.__ui;
  const remote = { on: "devbox", root: "/srv", view: "Makefile" };
  u.store[NOTES] = stored({ id: "n1", file: remote, range: { first: 1, last: 1, column: 0 }, excerpt: "all:", note: "Remote" });
  u.files["/srv/Makefile"] = "all:\n";
  const c = await chooser(["n1"], "s1", remote);
  assert.ok(c.lines.includes("File: Makefile\nMachine: devbox\n\nLine: 1\n\n```\nall:\n```\n\nNote: Remote"));
});

test("Cancel after the preview leaves clipboard, commands, notes and counters untouched", async () => {
  const u = globalThis.__ui;
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  await c.press("fa-send-cancel");
  assert.deepEqual(u.closed, ["ov1"]);
  assert.deepEqual(u.log, []);
  pristine(u, stored(N1, N2));
});

test("only agents of the origin space are listed; blocked ones are disabled and explained; none says so", async () => {
  const u = globalThis.__ui;
  u.agents = [agent("t1"), agent("t2", { space: "s2" }), agent("t3", { status: "blocked" }), agent("t4", { tab: "t9", tab_name: "other", status: "done" })];
  const c = await chooser(["n1"]);
  assert.ok(find(c.tree, "fa-send-agent-t1") && find(c.tree, "fa-send-agent-t4"));
  assert.equal(find(c.tree, "fa-send-agent-t2"), undefined);
  assert.match(c.text, /Waiting for an answer: not available/);
  await c.press("fa-send-agent-t3");
  assert.match(c.text, /Destination: choose an agent/);
  assert.equal(find(c.tree, "fa-send-paste").click, null);
  u.agents = [agent("t2", { space: "s2" })];
  c.draw();
  assert.match(c.text, /No agents in this space\. Start one/);
  assert.deepEqual(u.log, []);
});

test("Paste is only possible with a payload and a chosen agent", async () => {
  const u = globalThis.__ui;
  const c = await chooser(["n1"]);
  assert.equal(find(c.tree, "fa-send-paste").click, null);
  await c.press("fa-send-paste");
  const bad = await chooser(["n1", "n1"]);
  await bad.press("fa-send-agent-t1");
  assert.equal(find(bad.tree, "fa-send-paste").click, null);
  assert.deepEqual(u.log, []);
});

test("pasting copies the payload, focuses the exact agent, verifies it, then pastes without Enter", async () => {
  const u = globalThis.__ui;
  u.agents = [agent("t1"), agent("t2", { tab: "t9", tab_name: "other", app: "codex" })];
  const c = await chooser(["n1", "n2"]);
  await c.press("fa-send-agent-t2");
  await c.press("fa-send-paste");
  assert.deepEqual(u.log, [
    ["copy", `File: src/a.js\n\n${P1.split("\n\n").slice(1).join("\n\n")}\n\n${P2}`],
    ["run", "pane.focus", { terminal: "t2" }],
    ["run", "terminal.paste", {}],
    ["run", "terminal.scroll", { to: "bottom", terminal: "t2" }],
  ]);
  assert.deepEqual(u.closed, ["ov1"]);
  assert.deepEqual(u.notes.map((n) => [n.title, n.level]), [["Notes pasted", "success"]]);
  assert.match(u.notes[0].body, /Not sent/);
  pristine(u, stored(N1, N2));
});

test("the paste is not done when the focus never reaches the chosen agent; the overlay stays with the reason", async () => {
  const u = globalThis.__ui;
  u.noFocus = true;
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  await c.press("fa-send-paste");
  assert.deepEqual(kinds(u), ["copy", "pane.focus"]);
  assert.match(c.text, /Could not focus t1\. The notes are on the clipboard\./);
  assert.deepEqual(u.closed, []);
  pristine(u, stored(N1, N2));
});

test("focus landing in another pane than the agent's is not pasted", async () => {
  const u = globalThis.__ui;
  u.onRun = () => setTimeout(() => { u.focus = { pane: "p-files", space: "s1" }; }, 0);
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  await c.press("fa-send-paste");
  assert.deepEqual(kinds(u), ["copy", "pane.focus"]);
  assert.deepEqual(u.closed, []);
});

test("an agent that is gone, blocked, or moved to another space gets nothing and the clipboard is untouched", async () => {
  for (const change of [[], [agent("t1", { status: "blocked" })], [agent("t1", { space: "s2" })]]) {
    const u = globalThis.__ui;
    u.agents = [agent("t1")];
    u.log.length = 0;
    const c = await chooser(["n1"]);
    await c.press("fa-send-agent-t1");
    u.agents = change;
    await c.press("fa-send-paste");
    assert.deepEqual(u.log, []);
    assert.match(c.text, /(t1 is no longer an agent in this space|t1 is waiting for an answer)\. Nothing was pasted\./);
    assert.deepEqual(u.closed, []);
  }
});

test("an agent that becomes blocked while the clipboard is written is not focused or pasted", async () => {
  const u = globalThis.__ui;
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  u.onCopy = async () => { u.agents = [agent("t1", { status: "blocked" })]; };
  await c.press("fa-send-paste");
  assert.deepEqual(kinds(u), ["copy"]);
  assert.match(c.text, /t1 is waiting for an answer\. The notes are on the clipboard\./);
});

test("a note edited while the file is read is not pasted: the preview changes and asks again", async () => {
  const u = globalThis.__ui;
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  u.onRead = (n) => { if (n === 2) u.store[NOTES] = stored({ ...N1, note: "Edited" }, N2); };
  await c.press("fa-send-paste");
  assert.deepEqual(u.log, []);
  assert.ok(c.lines.includes(P1.replace("First", "Edited")));
  assert.match(c.text, /The notes changed since the preview/);
  u.onRead = null;
  await c.press("fa-send-paste");
  assert.deepEqual(kinds(u), ["copy", "pane.focus", "terminal.paste", "terminal.scroll"]);
  assert.equal(u.log[0][1], P1.replace("First", "Edited"));
});

test("a note deleted, notes gone corrupt, or text moved while the file is read: nothing is copied or pasted", async () => {
  const cases = [
    [(u) => { u.store[NOTES] = { next: 3, notes: [N2] }; }, /A selected note no longer exists\./],
    [(u) => { u.store[NOTES] = { next: 0, notes: [] }; }, /Saved notes are invalid/],
    [(u) => { u.files[PATH] = "zeta\n" + TEXT; }, /The file changed: the text of line 1 is no longer there\. Nothing was sent\./],
    [(u) => { u.files[PATH] = new Error("denied"); }, /Cannot read the file: denied/],
  ];
  for (const [mutate, why] of cases) {
    const u = globalThis.__ui;
    u.store[NOTES] = stored(N1, N2);
    u.files[PATH] = TEXT;
    u.log.length = 0;
    const c = await chooser(["n1"]);
    await c.press("fa-send-agent-t1");
    u.reads = 0;
    u.onRead = (n) => { if (n === 1) mutate(u); };
    await c.press("fa-send-paste");
    assert.deepEqual(u.log, []);
    assert.match(c.text, why);
    assert.deepEqual(u.closed, []);
    u.onRead = null;
  }
});

test("a malformed, empty, repeated or foreign selection or a stale note shows the reason and has no payload", async () => {
  const u = globalThis.__ui;
  const other = { ...N1, id: "n3", file: { ...FILE, view: "src/b.js" } };
  u.store[NOTES] = { next: 4, notes: [N1, N2, other] };
  const cases = [[[], /Select at least one note\./], [["n1", "n1"], /Select at least one note\./], [[1], /Select at least one note\./],
    ["n1", /Select at least one note\./], [["n3"], /A selected note no longer exists\./], [["n9"], /A selected note no longer exists\./]];
  for (const [ids, why] of cases) {
    const c = await chooser(ids);
    assert.match(c.text, why);
    assert.doesNotMatch(c.text, /File: /);
  }
  const noFile = await chooser(["n1"], "s1", null);
  assert.match(noFile.text, /The file of these notes is not valid\./);
  u.files[PATH] = "other\n";
  assert.match((await chooser(["n1"])).text, /no longer there/);
  assert.deepEqual(u.log, []);
});

test("closing the chooser while the clipboard is written stops before focusing or pasting", async () => {
  const u = globalThis.__ui;
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  u.onCopy = async () => { c.view.close(); };
  await c.press("fa-send-paste");
  assert.deepEqual(kinds(u), ["copy"]);
  assert.match(u.notes.at(-1).body, /Cancelled/);
});

test("a path sent from the menu still copies the mention, focuses the agent and pastes", async () => {
  const u = globalThis.__ui;
  u.props = { root: "/repo", path: "src/a.js", dir: false, overlay: "pop" };
  u.spaces = [{ id: "s1", active: true }];
  u.panes = [{ pane: "p-t1", cwd: "/repo", tab: "t1" }, { pane: "p-files", tab: "t1" }];
  const m = await mount();
  await m.press("fa-send-agent");
  assert.deepEqual(u.log, [["copy", "@src/a.js "], ["run", "pane.focus", { terminal: "t1" }], ["run", "terminal.paste", {}], ["run", "terminal.scroll", { to: "bottom", terminal: "t1" }]]);
  assert.deepEqual(u.closed, ["pop"]);
});

// Cancelling while the focus is awaited: the host's close hook (view.close) arrives later than the click or key,
// so the dialog must already know. The focus lands afterwards and must not be followed by a paste.
const cancelDuringFocus = [
  ["the host closing the dialog", (c) => c.view.close()],
  ["the Cancel button", (c) => find(c.tree, "fa-send-cancel").click({}, {})],
  ["Escape", (c) => find(c.tree, "file-actions-send").keydown({ key: "escape" }, { stop_propagation() {} })],
];
for (const [name, cancel] of cancelDuringFocus) {
  test(`${name} while the focus is awaited stops before the paste and says the notes are on the clipboard`, async () => {
    const u = globalThis.__ui;
    const c = await chooser(["n1"]);
    await c.press("fa-send-agent-t1");
    u.onRun = (cmd) => {
      if (cmd !== "pane.focus") return;
      setTimeout(() => { cancel(c); setTimeout(() => { u.focus = { pane: "p-t1", space: "s1" }; }, 0); }, 0);
    };
    await c.press("fa-send-paste");
    assert.deepEqual(kinds(u), ["copy", "pane.focus"]);
    assert.deepEqual(u.notes.map((n) => [n.title, n.level]), [["Not pasted", "warning"]]);
    assert.match(u.notes[0].body, /Cancelled\. The notes are on the clipboard\./);
    pristine(u, stored(N1, N2));
  });
}

test("cancelling before the clipboard is written leaves the clipboard untouched", async () => {
  const u = globalThis.__ui;
  const c = await chooser(["n1"]);
  await c.press("fa-send-agent-t1");
  u.onRead = () => { find(c.tree, "fa-send-cancel").click({}, {}); };
  await c.press("fa-send-paste");
  assert.deepEqual(u.log, []);
  assert.deepEqual(u.notes, []);
});
