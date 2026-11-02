// Opens a space's folder in VS Code, WebStorm or the file manager (Finder,
// Explorer) on this computer.
//
// Props: { editor: "vscode" | "webstorm" | "finder", space?: id }. No space: the focused one.
// The folder is the git top level of where the space is now (its first
// terminal's live folder, else where it was made), else that folder itself.
//
// Run it with `mod.open {name: "open-in-editor"}`, or open it as a dialog with
// props from a menu (see the my-menu clone).
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { closeOverlay, exec, focused, panes, props, spaces, theme, window as appWindow } from "herdr";
import { editorOf, launchPlan } from "./editors.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

async function topLevel(folder) {
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder }).catch(() => null);
  return r?.code === 0 && r.stdout.trim() ? r.stdout.trim() : folder;
}

async function launch(editorId, folder, platform) {
  const plan = launchPlan(editorId, folder, platform);
  if (!plan.length) throw new Error("Not supported on this platform.");
  let last = "";
  for (const [cmd, args, opts] of plan) {
    const r = await exec(cmd, args).catch((e) => ({ failed: true, code: -1, stderr: e?.message ?? String(e) }));
    if (r.code === 0 || (opts?.anyExit && !r.failed)) return;
    last = r.stderr?.trim() || `${cmd} exited with ${r.code}`;
  }
  throw new Error(last);
}

export default class OpenInEditor extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props() ?? {};
    this.platform = appWindow()?.platform;
    this.editor = editorOf(p.editor, this.platform);
    const f = focused();
    const space = spaces().find((s) => s.id === (p.space ?? f?.space)) ?? spaces().find((s) => s.active);
    // From a menu, the space's own folder; from a key, the focused terminal's.
    this.folder = (p.space ? space && place(space) : f?.cwd || (space && place(space))) || "";
    this.error = !this.folder
      ? "This space has no folder yet."
      : space?.machine
        ? `${space.machine} is another machine: only folders on this computer open here.`
        : null;
    if (this.error) return;
    cx.spawn(async (cx) => {
      try {
        this.folder = await topLevel(this.folder);
        cx.notify();
        await launch(p.editor, this.folder, this.platform);
        closeOverlay(p.overlay);
      } catch (e) {
        this.error = e?.message ?? String(e);
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const title = this.error ? `Could not open ${this.editor.title}` : `Opening in ${this.editor.title}…`;
    return v_flex().id("open-in-editor").track_focus(this.handle).size_full().p(16).gap(6).justify_center().bg(t.popover).text_size(13)
      .child(div().text_color(this.error ? t.blocked : t.foreground).font_semibold().child(title))
      .child(div().text_size(12).text_color(t.muted).child(this.error ?? this.folder));
  }
}
