import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The production main.js and notes-ui.js, loaded unchanged next to stubs of the modules the Herdr runtime
// provides. The stub elements keep what a view gives them (id, handlers, children) so a test can render,
// find a control by id, press it, and read the text on screen.
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
    export const Textarea = { new: (area) => globalThis.__ui.el("textarea") }, TextareaState = { new: (o) => globalThis.__ui.area(o) };`,
  herdr: `
    const ui = () => globalThis.__ui;
    export const agents = () => [], focused = () => null, panes = () => [], run = () => {}, spaces = () => [], watchFolder = () => new Promise(() => {});
    export const props = () => ui().props, shared = (k) => ui().store[k], settings = () => ({ font_family: "mono" });
    export const theme = () => new Proxy({}, { get: () => "#000" }), window = () => ({ platform: ui().platform, active: true });
    export const setShared = (k, v) => { ui().sets++; ui().store[k] = v; };
    export const openOverlay = (o) => { ui().overlays.push(o); return "ov" + ui().overlays.length; }, closeOverlay = (id) => ui().closed.push(id);
    export const notify = (n) => ui().notes.push(n);
    export const readTextFile = async (path) => { const t = ui().files[path]; if (t instanceof Error) throw t; return t; };
    export const exec = async (cmd, args) => { ui().execs.push([cmd, args]); return { code: 0, stdout: "", stderr: "" }; };`,
};

function el(kind) {
  const node = { kind, ident: null, kids: [], click: null, change: null, checked: undefined };
  const set = {
    id: (v) => { node.ident = v; },
    on_click: (f) => { node.click = f; },
    on_change: (f) => { node.change = f; },
    on_key_down: (f) => { node.key = f; },
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
const screen = (tree) => texts(tree).join("\n");
const tick = () => new Promise((r) => setTimeout(r, 0));

const FILE = { on: null, root: "/repo", view: "src/a.js" };
const PATH = "/repo/src/a.js";
const TEXT = "alpha beta\ngamma delta\nepsilon\n";
const note = (id, copied, text, file = FILE) => ({ id, file, range: { first: 1, last: 1, column: 0 }, excerpt: copied, note: text });
const stored = (...notes) => ({ next: notes.length + 1, notes });

let dir, FileActions, NOTES;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "fa-notes-ui-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  for (const [name, code] of Object.entries(STUBS)) {
    const pkg = join(dir, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), `{"name":"${name}","type":"module","main":"index.js"}`);
    writeFileSync(join(pkg, "index.js"), code);
  }
  for (const f of ["main.js", "actions.js", "notes.js", "notes-ui.js", "notes-send.js"]) cpSync(join(SRC, f), join(dir, f));
  globalThis.__ui = { el, area: null };
  FileActions = (await import(pathToFileURL(join(dir, "main.js")).href)).default;
  NOTES = (await import(pathToFileURL(join(dir, "notes.js")).href)).NOTES;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
  delete globalThis.__ui;
});

beforeEach(() => {
  const areas = [];
  Object.assign(globalThis.__ui, {
    store: {}, timers: [], sets: 0, overlays: [], closed: [], notes: [], execs: [], areas, platform: "macos",
    files: { [PATH]: TEXT }, props: { view: "src/a.js", root: "/repo" },
    area: (o) => { const a = { text: o?.value ?? "", released: 0, value() { return this.text; }, set_value(v) { this.text = v; }, focuses: 0, focus() { this.focuses++; }, on() {}, release() { this.released++; return true; } }; areas.push(a); return a; },
  });
});

// A context for one event: the clipboard is only reachable here, never from a task started with spawn.
function context(clip) {
  return {
    read_from_clipboard: () => clip.text,
    write_to_clipboard: (t) => { clip.text = t; clip.writes++; },
    notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), timer: { after: (_ms, f) => globalThis.__ui.timers.push(f) },
    spawn: (fn) => fn({ read_from_clipboard() { throw new Error("stale cx"); }, notify() {}, timer: { after() {} } }),
  };
}

// Mounts a view the way Herdr does (init, then render) and returns helpers to see it and press its controls.
async function mount(clip = { text: undefined, writes: 0 }) {
  const cx = context(clip);
  const view = new FileActions();
  view.platform = globalThis.__ui.platform;
  view.init?.({}, cx);
  let tree = view.render(cx);
  await tick();
  const draw = () => (tree = view.render(cx));
  draw();
  return {
    view, clip, draw,
    get tree() { return tree; },
    get text() { return screen(tree); },
    // Pressing a control that is not there, or is disabled (no handler), does nothing.
    async press(id) { draw(); find(tree, id)?.click?.({}, cx); await tick(); draw(); },
    async toggle(id, on) { draw(); find(tree, id).change(on, cx); await tick(); draw(); },
  };
}

const viewer = (clip) => mount(clip);
async function dialog(p) {
  globalThis.__ui.props = { ...p, overlay: "ov1" };
  return mount();
}
const unchanged = (u, store) => { assert.equal(u.sets, 0); assert.deepEqual(u.store, store); };

test("Add note with a unique copied selection opens a dialog and leaves the clipboard alone", async () => {
  const clip = { text: "gamma delta", writes: 0 };
  const v = await viewer(clip);
  await v.press("fa-note-add");
  const u = globalThis.__ui;
  assert.deepEqual(u.overlays.map((o) => [o.mod, o.kind, o.props]), [["file-actions", "dialog",
    { note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" }]]);
  assert.deepEqual(clip, { text: "gamma delta", writes: 0 });
  assert.deepEqual(u.execs, []);
  unchanged(u, {});
});

test("Add note refuses text that is empty, missing from the file or found more than once", async () => {
  const cases = [["", "Copy the text to annotate first."], [undefined, "Copy the text to annotate first."],
    ["elsewhere", "The copied text isn't in this file."],
    ["a", "The copied text appears more than once in this file; select a longer, unique piece."]];
  for (const [text, why] of cases) {
    const clip = { text, writes: 0 };
    const v = await viewer(clip);
    globalThis.__ui.notes.length = 0;
    await v.press("fa-note-add");
    const u = globalThis.__ui;
    assert.deepEqual(u.notes, [{ title: "Could not add a note", body: why, level: "warning" }]);
    assert.deepEqual(u.overlays, []);
    assert.deepEqual(clip, { text, writes: 0 });
    unchanged(u, {});
  }
});

test("Add note is not offered while no text of the file is loaded", async () => {
  for (const failure of [new Error("denied"), "bin\0ary"]) {
    globalThis.__ui.files[PATH] = failure;
    const v = await viewer({ text: "bin", writes: 0 });
    await v.press("fa-note-add");
    assert.deepEqual(globalThis.__ui.overlays, []);
    assert.deepEqual(globalThis.__ui.notes, []);
  }
});

test("the dialog shows the file, lines and source as plain text, and Save stores the note", async () => {
  const props = { note: "add", file: FILE, range: { first: 1, last: 2, column: 6 }, excerpt: "beta\ngamma" };
  const d = await dialog(props);
  assert.match(d.text, /src\/a\.js/);
  assert.match(d.text, /Lines 1-2/);
  assert.match(d.text, /beta\ngamma/);
  globalThis.__ui.areas[0].set_value("  Check this  ");
  await d.press("fa-note-save");
  const u = globalThis.__ui;
  assert.equal(u.sets, 1);
  assert.deepEqual(u.store[NOTES], { next: 2, notes: [{ id: "n1", file: FILE, range: props.range, excerpt: "beta\ngamma", note: "Check this" }] });
  assert.deepEqual(u.closed, ["ov1"]);
  assert.deepEqual(u.execs, []);
});

test("a note saved is shown as a card, and a new view of the file restores it", async () => {
  globalThis.__ui.store[NOTES] = stored(note("n1", "alpha beta", "Look here"));
  const v = await viewer();
  assert.match(v.text, /Line 1/);
  assert.match(v.text, /alpha beta/);
  assert.match(v.text, /Look here/);
  assert.ok(find(v.tree, "fa-note-edit-n1") && find(v.tree, "fa-note-delete-n1"));
  const again = await viewer();
  assert.match(again.text, /Look here/);
});

test("Cancel closes the dialog without touching the notes", async () => {
  const store = stored(note("n1", "alpha beta", "Look here"));
  globalThis.__ui.store[NOTES] = store;
  const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
  globalThis.__ui.areas[0].set_value("typed");
  await d.press("fa-note-cancel");
  assert.deepEqual(globalThis.__ui.closed, ["ov1"]);
  unchanged(globalThis.__ui, { [NOTES]: store });
});

test("closing the dialog releases its textarea", async () => {
  const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
  await d.view.close();
  assert.equal(globalThis.__ui.areas[0].released, 1);
});

test("a blank note shows an inline error and the dialog stays open", async () => {
  const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
  globalThis.__ui.areas[0].set_value("  \n ");
  await d.press("fa-note-save");
  assert.match(d.text, /Write a note first\./);
  assert.deepEqual(globalThis.__ui.closed, []);
  unchanged(globalThis.__ui, {});
});

test("saving keeps the dialog open when the file no longer has the text where it was copied", async () => {
  const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
  globalThis.__ui.files[PATH] = "zeta\nalpha beta\ngamma delta\n";
  globalThis.__ui.areas[0].set_value("Note");
  await d.press("fa-note-save");
  assert.match(d.text, /The file changed since the text was copied\. Close this and copy it again\./);
  assert.deepEqual(globalThis.__ui.closed, []);
  unchanged(globalThis.__ui, {});
});

test("saving reports a file that cannot be read and keeps the dialog open", async () => {
  const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
  globalThis.__ui.files[PATH] = new Error("denied");
  globalThis.__ui.areas[0].set_value("Note");
  await d.press("fa-note-save");
  assert.match(d.text, /Cannot read the file: denied/);
  assert.deepEqual(globalThis.__ui.closed, []);
  unchanged(globalThis.__ui, {});
});

test("corrupt saved notes are shown as an error, disable Add note and are never overwritten", async () => {
  const corrupt = { next: 0, notes: [] };
  globalThis.__ui.store[NOTES] = corrupt;
  const v = await viewer({ text: "gamma delta", writes: 0 });
  assert.match(v.text, /Saved notes are invalid/);
  await v.press("fa-note-add");
  assert.deepEqual(globalThis.__ui.overlays, []);
  const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
  globalThis.__ui.areas[0].set_value("Note");
  await d.press("fa-note-save");
  assert.match(d.text, /Saved notes are invalid/);
  assert.deepEqual(globalThis.__ui.closed, []);
  unchanged(globalThis.__ui, { [NOTES]: corrupt });
});

test("a note whose text is no longer at its range shows a warning and keeps its range", async () => {
  const store = stored(note("n1", "gamma delta", "Moved"));
  globalThis.__ui.store[NOTES] = store;
  globalThis.__ui.files[PATH] = TEXT;
  const stale = await viewer();
  assert.match(stale.text, /no longer at these lines/);
  globalThis.__ui.files[PATH] = "gamma delta\n";
  assert.doesNotMatch((await viewer()).text, /no longer at these lines/);
  unchanged(globalThis.__ui, { [NOTES]: store });
});

test("two notes are listed in order, each with its own selection that is not saved", async () => {
  const other = note("n3", "x", "Another file", { ...FILE, view: "src/b.js" });
  globalThis.__ui.store[NOTES] = { next: 4, notes: [note("n1", "alpha beta", "First"), note("n2", "gamma delta", "Second"), other] };
  const v = await viewer();
  assert.ok(v.text.indexOf("First") < v.text.indexOf("Second"));
  assert.doesNotMatch(v.text, /Another file/);
  assert.equal(find(v.tree, "fa-note-pick-n1").checked, false);
  await v.toggle("fa-note-pick-n2", true);
  assert.equal(find(v.tree, "fa-note-pick-n1").checked, false);
  assert.equal(find(v.tree, "fa-note-pick-n2").checked, true);
  assert.match(v.text, /1 selected/);
  assert.equal(globalThis.__ui.sets, 0);
  // Selection belongs to the file being shown.
  globalThis.__ui.props = { view: "src/b.js", root: "/repo" };
  globalThis.__ui.files["/repo/src/b.js"] = "x\n";
  v.draw();
  await tick();
  v.draw();
  assert.doesNotMatch(v.text, /selected/);
});

test("Edit opens the note's dialog; Save changes only its text", async () => {
  const store = { next: 3, notes: [note("n1", "alpha beta", "First"), note("n2", "gamma delta", "Second")] };
  globalThis.__ui.store[NOTES] = store;
  const v = await viewer();
  await v.press("fa-note-edit-n1");
  const open = globalThis.__ui.overlays[0].props;
  assert.deepEqual(open, { note: "edit", id: "n1" });
  const d = await dialog(open);
  assert.equal(globalThis.__ui.areas.at(-1).value(), "First");
  assert.match(d.text, /alpha beta/);
  globalThis.__ui.areas.at(-1).set_value("Revised");
  await d.press("fa-note-save");
  assert.deepEqual(globalThis.__ui.store[NOTES], { next: 3, notes: [{ ...store.notes[0], note: "Revised" }, store.notes[1]] });
  assert.deepEqual(globalThis.__ui.closed, ["ov1"]);
});

test("Edit of a note that was removed meanwhile or left blank changes nothing", async () => {
  const store = stored(note("n1", "alpha beta", "First"));
  globalThis.__ui.store[NOTES] = store;
  const blank = await dialog({ note: "edit", id: "n1" });
  globalThis.__ui.areas.at(-1).set_value(" ");
  await blank.press("fa-note-save");
  assert.match(blank.text, /Write a note first\./);
  const gone = await dialog({ note: "edit", id: "n9" });
  globalThis.__ui.areas.at(-1).set_value("Text");
  await gone.press("fa-note-save");
  assert.match(gone.text, /That note no longer exists\./);
  assert.deepEqual(globalThis.__ui.closed, []);
  unchanged(globalThis.__ui, { [NOTES]: store });
});

test("Delete asks first; only the confirmation removes the note", async () => {
  const store = { next: 3, notes: [note("n1", "alpha beta", "First"), note("n2", "gamma delta", "Second")] };
  globalThis.__ui.store[NOTES] = store;
  const v = await viewer();
  await v.toggle("fa-note-pick-n1", true);
  await v.press("fa-note-delete-n1");
  assert.match(v.text, /Delete this note\?/);
  unchanged(globalThis.__ui, { [NOTES]: store });
  await v.press("fa-note-keep-n1");
  assert.doesNotMatch(v.text, /Delete this note\?/);
  unchanged(globalThis.__ui, { [NOTES]: store });
  await v.press("fa-note-delete-n1");
  await v.press("fa-note-confirm-n1");
  assert.deepEqual(globalThis.__ui.store[NOTES], { next: 3, notes: [store.notes[1]] });
  assert.doesNotMatch(v.text, /First/);
  assert.doesNotMatch(v.text, /1 selected/);
});

test("with no notes the panel explains how to add one", async () => {
  assert.match((await viewer()).text, /Select text, press ⌘C, then Add note\./);
  globalThis.__ui.platform = "windows";
  assert.match((await viewer()).text, /Select text, press Ctrl\+C, then Add note\./);
});

test("closing the dialog while Save waits for the file stores nothing and touches nothing after it", async () => {
  const closers = {
    Cancel: (d) => d.press("fa-note-cancel"),
    Escape: async (d) => { find(d.tree, "file-actions-note").key({ key: "escape" }, context({})); },
    "host close": () => {},
  };
  for (const [name, close] of Object.entries(closers)) {
    const store = stored(note("n1", "alpha beta", "First")), before = JSON.stringify(store);
    Object.assign(globalThis.__ui, { store: { [NOTES]: store }, sets: 0, closed: [], timers: [] });
    let read;
    globalThis.__ui.files[PATH] = new Promise((done) => { read = done; });
    const d = await dialog({ note: "add", file: FILE, range: { first: 2, last: 2, column: 0 }, excerpt: "gamma delta" });
    const area = globalThis.__ui.areas.at(-1);
    area.set_value("Late");
    await d.press("fa-note-save");
    await close(d);
    await d.view.close();
    await d.view.close();
    read(TEXT);
    await tick();
    globalThis.__ui.timers.forEach((f) => f());
    d.draw();
    const u = globalThis.__ui;
    assert.equal(u.sets, 0, name);
    assert.equal(JSON.stringify(u.store[NOTES]), before, name);
    assert.deepEqual(u.closed, name === "host close" ? [] : ["ov1"], name);
    assert.equal(area.released, 1, name);
    assert.equal(area.focuses, 1, name);
    assert.doesNotMatch(d.text, /Cannot read|changed since/, name);
    u.files[PATH] = TEXT;
  }
});
