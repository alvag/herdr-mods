import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The production main.js, loaded unchanged next to stubs of the modules the Herdr runtime provides.
const SRC = new URL("../mods/file-actions/", import.meta.url).pathname;
const STUBS = {
  "gpui-kit": `
    export class View {}
    const chain = () => new Proxy(function () {}, { get: (_t, k) => k === "on_key_down"
      ? (fn) => { globalThis.__fa.keyDown = fn; return chain(); } : () => chain() });
    export const div = chain, svg = chain;`,
  "gpui-base": `
    const chain = () => new Proxy(function () {}, { get: (_t, k) => k === "on_key_down"
      ? (fn) => { globalThis.__fa.keyDown = fn; return chain(); } : () => chain() });
    export const v_flex = chain, h_flex = chain, InputState = { new: chain }, Input = { new: chain };
    export const Editor = { new: chain }, EditorState = { new: () => ({ release() {} }) };
    export const Checkbox = { new: chain }, Textarea = { new: chain }, TextareaState = { new: chain };`,
  herdr: `
    const fa = () => globalThis.__fa;
    const noop = () => {};
    export const agents = () => [], closeOverlay = noop, focused = () => null, openOverlay = noop, panes = () => [];
    export const props = () => ({ view: "src/a.js", root: "/repo" }), readTextFile = async () => "", run = noop, setShared = noop;
    export const settings = () => ({ font_family: "mono" }), shared = () => ({}), spaces = () => [];
    export const theme = () => new Proxy({}, { get: () => "#000" }), watchFolder = async () => {};
    export const window = () => ({ platform: fa().platform, active: true });
    export const notify = (n) => fa().notes.push(n);
    export const exec = async (cmd, args) => { fa().execs.push([cmd, args]); return { code: 0, stdout: "", stderr: "" }; };`,
};

let dir, FileActions;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "fa-copy-context-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  for (const [name, code] of Object.entries(STUBS)) {
    const pkg = join(dir, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), `{"name":"${name}","type":"module","main":"index.js"}`);
    writeFileSync(join(pkg, "index.js"), code);
  }
  for (const f of ["main.js", "actions.js", "notes.js", "notes-ui.js", "notes-send.js"]) cpSync(join(SRC, f), join(dir, f));
  globalThis.__fa = { notes: [], execs: [], platform: "macos" };
  FileActions = (await import(pathToFileURL(join(dir, "main.js")).href)).default;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
  delete globalThis.__fa;
});

// Renders the viewer of `fileText` and returns a press(key event) that runs its key handler with a clipboard.
function viewer(fileText, clipboard, platform = "macos") {
  Object.assign(globalThis.__fa, { notes: [], execs: [], keyDown: null, platform });
  const clip = { text: clipboard, writes: 0, stopped: false };
  const cx = { spawn() {}, notify() {} };
  const view = new FileActions();
  view.platform = platform;
  view.text = fileText;
  view.render(cx);
  const press = async (e) => {
    globalThis.__fa.keyDown(e, {
      read_from_clipboard: () => clip.text,
      write_to_clipboard: (t) => { clip.text = t; clip.writes++; },
      stop_propagation: () => { clip.stopped = true; },
      notify() {},
      spawn: (fn) => fn({ read_from_clipboard() { throw new Error("stale cx"); } }),
    });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { clip, press, fa: globalThis.__fa };
}

const mac = { key: "c", modifiers: { platform: true, alt: true, control: false } };
const win = { key: "c", modifiers: { platform: false, alt: true, control: true } };

test("⌘⌥C wraps the copied text with its file and lines through the native clipboard", async () => {
  const v = viewer("one\ntwo\nthree\n", "two\r\nthree\n");
  await v.press(mac);
  assert.equal(v.clip.text, "File: src/a.js\nLines: 2-3\n\n```js\ntwo\nthree\n```");
  assert.equal(v.clip.stopped, true);
  assert.deepEqual(v.fa.execs, []);
  assert.deepEqual(v.fa.notes, [{ title: "Copied with context", body: "File: src/a.js · Lines: 2-3", level: "success", timeout: 2500 }]);
});

test("Ctrl+Alt+C does the same; text found twice says first match", async () => {
  const v = viewer("x\nx\n", "x", "windows");
  await v.press(win);
  assert.equal(v.clip.text, "File: src/a.js\nLine: 1\n\n```js\nx\n```");
  assert.deepEqual(v.fa.execs, []);
  assert.equal(v.fa.notes[0].body, "File: src/a.js · Line: 1 (first match in the file)");
});

test("text not in the file, or nothing copied, leaves the clipboard alone and warns", async () => {
  for (const clipboard of ["elsewhere", undefined, ""]) {
    const v = viewer("one\ntwo\n", clipboard);
    await v.press(mac);
    assert.equal(v.clip.text, clipboard);
    assert.equal(v.clip.writes, 0);
    assert.deepEqual(v.fa.execs, []);
    assert.deepEqual(v.fa.notes, [{ title: "Copy the text first", body: "Select it and press ⌘C (Ctrl+C), then this again.", level: "warning" }]);
  }
});

test("plain ⌘C and Alt+C alone are not intercepted", async () => {
  const v = viewer("one\n", "one");
  await v.press({ key: "c", modifiers: { platform: true, alt: false, control: false } });
  await v.press({ key: "c", modifiers: { platform: false, alt: true, control: false } });
  assert.equal(v.clip.stopped, false);
  assert.equal(v.clip.writes, 0);
  assert.deepEqual(v.fa.notes, []);
});
