// Right-click actions for a row of the Files panel (the my-files clone opens it).
//
// Three overlays, chosen by props:
//   popup  { root, path, dir, on }               the menu for one entry
//   dialog { create: "file" | "folder", root, folder, on }   the name of a new entry
//   dialog { remove: true, root, path, dir }     confirms moving an entry to the Trash
//   dialog { note: "add", file, range, excerpt }  the text of a new note (notes-ui.js)
//   dialog { note: "edit", id }                  the text of a note already saved
//   dialog { sendNotes: true, file, ids, space } sends notes to an agent of that space (notes-send.js)
//   tab    { key }                               a file, read-only, as a whole tab (tab.new); which
//                                                file is shared("file-actions.tabs")[key] (see panel.js);
//                                                the file's notes are drawn beside it
// `root` is the panel's folder, `path` the entry relative to it ("/" separated),
// `on` the machine of a space on another computer (null here).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState } from "gpui-base";
import {
  agents, closeOverlay, exec, focused, notify, openOverlay, panes, props, readTextFile, run, setShared, settings, shared, spaces, theme, watchFolder,
  window as appWindow,
} from "herdr";
import {
  checkName, claimTab, contextOf, copyPlan, createError, createPlan, deletePlan, languageOf, mentionOf, previewOf, menuItems, openPlan, pasteBlocker, pasteSteps, pathsOf, pickAgent, reloadOnFocus, revealPlan, runSteps, targetFolder,
} from "./actions.js";
import { NoteDialog, NotesPanel, startNote } from "./notes-ui.js";
import { SendDialog, openSend } from "./notes-send.js";

// Runs [program, args, options?]; resolves when it worked, else throws its reason.
async function attempt([cmd, args, opts], on) {
  const r = await exec(cmd, args, on ? { on } : undefined).catch((e) => ({ failed: true, code: -1, stderr: e?.message ?? String(e) }));
  if (r.code === 0 || (opts?.anyExit && !r.failed)) return;
  throw new Error(r.stderr?.trim() || `${cmd} exited with ${r.code}`);
}

// Tries each [program, args] in order until one works; throws the last reason.
async function attemptAll(plan) {
  if (!plan.length) throw new Error("Not supported on this platform.");
  let last;
  for (const step of plan) {
    try { return await attempt(step); } catch (e) { last = e; }
  }
  throw last;
}

const TABS = "file-actions.tabs";
const DESKTOP_PLATFORMS = ["macos", "windows"];

const fail = (title, e) => notify({ title, body: e?.message ?? String(e), level: "error" });

function button(t, id, text, primary, action) {
  return h_flex().id(id).h(32).px(14).items_center().rounded(8)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
    .hover((s) => s.opacity(0.88)).on_click(action).child(text);
}

export default class FileActions extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.platform = appWindow()?.platform;
    this.handle = cx.focus_handle();
    this.at = 0;
    if (p.key) return this.register(cx);
    if (p.view) return;
    if (p.sendNotes) {
      this.sender = new SendDialog(p, cx, (text) => this.copyText(text));
      return;
    }
    if (p.note) {
      this.noteDialog = new NoteDialog(p, cx);
      return;
    }
    if (p.create) {
      this.name = "";
      this.error = null;
      this.input = InputState.new({ value: "" });
      this.input.on("change", (_e, cx) => { this.name = this.input.value(); this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.create(cx));
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    } else this.handle.focus();
  }

  async close() {
    this.noteDialog?.close();
    this.sender?.close();
  }

  // Writes this computer's clipboard through the same process-based path as Send to agent.
  copyText(text) {
    const plan = copyPlan(text, this.platform);
    if (!plan) throw new Error("Not supported on this platform.");
    return attempt(plan);
  }

  choose(item, cx) {
    const p = props();
    // Send to agent waits on this popup's timer, which stops once it closes.
    if (item.id !== "send-agent") closeOverlay(p.overlay);
    const { full, relative } = pathsOf(p.root, p.path, this.platform, p.on);
    if (item.id === "copy" || item.id === "copy-relative") {
      const text = item.id === "copy" ? full : relative;
      // The clipboard is this computer's, also for a space on another machine.
      cx.spawn(async () => {
        try { await attempt(copyPlan(text, this.platform)); notify({ title: "Copied", body: text, level: "success", timeout: 2000 }); }
        catch (e) { fail("Could not copy", e); }
      });
    } else if (item.id === "open-vscode" || item.id === "open-webstorm") {
      const editor = item.id === "open-vscode" ? "VS Code" : "WebStorm";
      const root = p.dir ? null : pathsOf(p.root, "", this.platform, p.on).full;
      cx.spawn(async () => { try { await attemptAll(openPlan(item.id.slice(5), full, this.platform, root)); } catch (e) { fail(`Could not open ${editor}`, e); } });
    } else if (item.id === "send-agent") {
      cx.spawn(async (cx) => {
        try { await this.sendToAgent(full, cx); } catch (e) { fail("Could not send to the agent", e); }
        finally { closeOverlay(p.overlay); }
      });
    } else if (item.id === "delete") {
      openOverlay({ mod: "file-actions", kind: "dialog", width: 420, height: 168,
        props: { remove: true, root: p.root, path: p.path, dir: p.dir } });
    } else if (item.id === "reveal") {
      cx.spawn(async () => { try { await attempt(revealPlan(full, this.platform)); } catch (e) { fail("Could not reveal", e); } });
    } else {
      openOverlay({ mod: "file-actions", kind: "dialog", width: 420, height: 196,
        props: { create: item.id === "new-folder" ? "folder" : "file", root: p.root, folder: targetFolder(p.path, p.dir), on: p.on } });
    }
  }

  create(cx) {
    const p = props();
    this.error = checkName(this.name);
    if (this.error) return cx.notify();
    const rel = p.folder ? `${p.folder}/${this.name.trim()}` : this.name.trim();
    const { full } = pathsOf(p.root, rel, this.platform, p.on);
    cx.spawn(async (cx) => {
      // The Files panel watches its folder, so the new entry shows up by itself.
      try { await attempt(createPlan(p.create, full, this.platform, p.on), p.on); closeOverlay(p.overlay); }
      catch (e) { this.error = createError(e?.message ?? String(e), this.name.trim()); cx.notify(); }
    });
  }

  // Herdr can't type into a terminal without pressing Enter, so the mention goes
  // through the clipboard: copy it, focus the agent, paste. It stays unsent.
  async sendToAgent(full, cx) {
    const f = focused(), space = spaces().find((s) => s.active);
    const tab = f?.pane ? panes().find((x) => x.pane === f.pane)?.tab : null;
    const agent = pickAgent(agents(), space?.id, tab);
    const blocker = pasteBlocker(agent);
    if (!agent) return notify({ title: blocker, body: "Start one, then send the path again.", level: "warning" });
    const text = mentionOf(full, panes().find((x) => x.pane === agent.pane)?.cwd);
    await attempt(copyPlan(text, this.platform));
    if (blocker) return notify({ title: blocker, body: "Not pasted. The path is on the clipboard.", level: "warning" });
    // pane.focus applies a moment later; pasting before that lands in the Files panel.
    run("pane.focus", { terminal: agent.address });
    for (let i = 0; i < 20 && focused()?.pane !== agent.pane; i++) await new Promise((done) => cx.timer.after(50, done));
    if (focused()?.pane !== agent.pane) throw new Error(`Could not focus ${agent.address}. The path is on the clipboard.`);
    runSteps(pasteSteps(agent.address), run);
  }

  remove(cx) {
    const p = props();
    const { full } = pathsOf(p.root, p.path, this.platform, null);
    cx.spawn(async (cx) => {
      // The Files panel watches its folder, so the entry goes away by itself.
      try { await attemptAll(deletePlan(full, this.platform)); closeOverlay(p.overlay); }
      catch (e) { this.error = e?.message ?? String(e); cx.notify(); }
    });
  }

  // A new tab's entry has no tab id yet: claim this viewer's tab (claimTab),
  // retrying while Herdr creates it.
  register(cx) {
    const key = props().key;
    const tryOnce = (left) => {
      const all = shared(TABS) ?? {}, entry = all[key];
      if (!entry || entry.tab) return;
      const space = spaces().find((s) => s.id === entry.space);
      const tab = claimTab(all, key, panes(), space?.tabs ?? [], focused()?.tab);
      if (tab) setShared(TABS, { ...all, [key]: { ...entry, tab } });
      else if (left > 0) cx.timer.after(100, () => tryOnce(left - 1));
    };
    tryOnce(20);
  }

  // Shows the entry's file, again whenever its folder changes (on this
  // computer; another machine's file: see refresh). A preview tab's file changes:
  // `gen` stops the loop of the file shown before.
  follow(entry, cx) {
    const gen = (this.gen = (this.gen ?? 0) + 1);
    this.loaded = false;
    const full = `${entry.root}/${entry.view}`, folder = full.slice(0, full.lastIndexOf("/"));
    cx.spawn(async (cx) => {
      for (;;) {
        await this.load(full, entry.on, gen);
        if (gen !== this.gen) return;
        cx.notify();
        if (entry.on) return;
        try { await watchFolder(folder); } catch { return; }
        if (gen !== this.gen) return;
      }
    });
  }

  // Another machine's file, again when the window gets the focus back.
  refresh(entry, cx) {
    const now = appWindow()?.active, was = this.active;
    this.active = now;
    if (!reloadOnFocus(was, now, entry.on)) return;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      await this.load(`${entry.root}/${entry.view}`, entry.on, gen);
      if (gen === this.gen) cx.notify();
    });
  }

  async load(full, on, gen) {
    let text, failure = null;
    try { text = await readTextFile(full, { on: on ?? null }); }
    catch (e) { failure = `Cannot preview this file: ${e?.message ?? e}`; }
    if (gen !== this.gen) return;
    if (!failure && this.loaded && text === this.text) return;
    this.loaded = true;
    this.text = text;
    const shown = failure ? { error: failure } : previewOf(text);
    this.code?.release();
    this.code = null;
    this.viewError = shown.error ?? null;
    if (shown.value === undefined) return;
    const t = theme();
    this.code = EditorState.new({ language: languageOf(full), readonly: true, value: shown.value,
      font_family: settings().font_family, font_size: 13,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  render(cx) {
    const p = props() ?? {};
    return p.key || p.view ? this.viewer(cx) : p.sendNotes ? this.sender.render(theme()) : p.note ? this.noteDialog.render(theme()) : p.create ? this.dialog() : p.remove ? this.confirm() : this.menu();
  }

  // Herdr's editor tells no selection: the text copied from it with ⌘C is found
  // in the file to know its lines, then put back on the clipboard with them.
  // Both ends use the app's own clipboard through the key handler's cx (it is
  // not kept past that call).
  copyContext(view, cx) {
    const ctx = contextOf(this.text ?? "", cx.read_from_clipboard() ?? "", view);
    if (!ctx) return notify({ title: "Copy the text first", body: "Select it and press ⌘C (Ctrl+C), then this again.", level: "warning" });
    cx.write_to_clipboard(ctx.text);
    notify({ title: "Copied with context", body: ctx.text.split("\n").slice(0, 2).join(" · ") + (ctx.unique ? "" : " (first match in the file)"), level: "success", timeout: 2500 });
  }

  // Add note: the text copied with ⌘C is found in the file loaded now, and the
  // dialog opens for it. The clipboard is read here, in the click's own cx, and
  // is only read, never changed.
  addNote(file, cx) {
    try { startNote(file, this.text, cx.read_from_clipboard() ?? ""); }
    catch (e) { notify({ title: "Could not add a note", body: e?.message ?? String(e), level: "warning" }); }
  }

  viewer(cx) {
    // A tab opened by an earlier version names its file in its props.
    const t = theme(), p = props(), entry = p.view ? { view: p.view, root: p.root, on: p.on } : (shared(TABS) ?? {})[p.key];
    if (!entry) return div().size_full().p(12).bg(t.background).text_color(t.dim).child("This file tab is no longer tracked. Close it and open the file again.");
    const showing = `${entry.on ?? ""}|${entry.root}/${entry.view}`;
    this.notes ??= new NotesPanel();
    if (showing !== this.showing) { this.showing = showing; this.notes.reset(); this.follow(entry, cx); }
    this.refresh(entry, cx);
    const keys = this.platform === "macos" ? "⌘C, then ⌘⌥C" : "Ctrl+C, then Ctrl+Alt+C";
    // Notes belong to the file, not to this tab. Adding one needs the file's text loaded.
    const file = { on: entry.on ?? null, root: entry.root, view: entry.view }, state = this.notes.state(file);
    const add = this.code ? (_e, cx) => this.addNote(file, cx) : null;
    // The space is read when Send is pressed for a tab with none recorded (an earlier version's).
    const send = this.code && !state.error && DESKTOP_PLATFORMS.includes(this.platform)
      ? (ids) => {
        try { openSend(file, ids, entry.space ?? spaces().find((s) => s.active)?.id); }
        catch (e) { notify({ title: "Could not send the notes", body: e?.message ?? String(e), level: "warning" }); }
      } : null;
    return v_flex().id("file-actions-view").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Keys reach this element while the editor inside it is focused.
      .on_key_down((e, cx) => {
        if (e.key !== "c" || !e.modifiers.alt || !(e.modifiers.platform || e.modifiers.control)) return;
        cx.stop_propagation();
        try { this.copyContext(entry.view, cx); } catch (err) { fail("Could not copy with context", err); }
      })
      .child(h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(entry.view))
        .when(DESKTOP_PLATFORMS.includes(this.platform), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${keys}: copy with context`)))
        .child(this.notes.addButton(t, state, add))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(entry.root.split(/[\\/]/).pop())))
      .child(h_flex().flex_1().min_h(0)
        .child(this.code ? Editor.new(this.code).flex_1().min_w(0).h_full()
          : div().flex_1().min_w(0).p(12).text_color(t.dim).child(this.viewError ?? "Loading file…"))
        .child(this.notes.panel(t, state, this.code ? this.text : null, this.platform === "macos" ? "⌘C" : "Ctrl+C", send)));
  }

  menu() {
    const t = theme(), p = props() ?? {};
    const list = menuItems(this.platform, p.on);
    return v_flex().id("file-actions").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(list[this.at], cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => v_flex()
        .when(Boolean(it.separated), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`fa-${it.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(it, cx))
          .child(svg(`mods/workspace-chrome/${it.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(it.label)))));
  }

  dialog() {
    const t = theme(), p = props();
    const where = p.folder || p.root.split(/[\\/]/).pop();
    return v_flex().id("file-actions-new").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(`New ${p.create} in ${where}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.error ? t.blocked : t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().pt(6).text_size(11.5).text_color(t.blocked).truncate().child(this.error)))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(button(t, "fa-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button(t, "fa-create", "Create", true, (_e, cx) => this.create(cx))));
  }

  confirm() {
    const t = theme(), p = props();
    const name = p.path.split("/").pop();
    const bin = this.platform === "windows" ? "Recycle Bin" : "Trash";
    return v_flex().id("file-actions-delete").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); }
        else if (e.key === "enter") { this.remove(cx); cx.stop_propagation(); }
      })
      .child(h_flex().items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(`Move ${name} to the ${bin}?`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(10).text_size(12).text_color(this.error ? t.blocked : t.muted).truncate()
        .child(this.error ?? (p.dir ? `${p.path} and everything in it` : p.path)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button(t, "fa-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button(t, "fa-delete", `Move to ${bin}`, true, (_e, cx) => this.remove(cx))));
  }
}
