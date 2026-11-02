// Right-click actions for a row of the Files panel (the my-files clone opens it).
//
// Two overlays, chosen by props:
//   popup  { root, path, dir, on }               the menu for one entry
//   dialog { create: "file" | "folder", root, folder, on }   the name of a new entry
// `root` is the panel's folder, `path` the entry relative to it ("/" separated),
// `on` the machine of a space on another computer (null here).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, notify, openOverlay, props, theme, window as appWindow } from "herdr";
import { checkName, copyPlan, createPlan, menuItems, pathsOf, revealPlan, targetFolder } from "./actions.js";

// Runs [program, args, options?]; resolves when it worked, else throws its reason.
async function attempt([cmd, args, opts], on) {
  const r = await exec(cmd, args, on ? { on } : undefined).catch((e) => ({ failed: true, code: -1, stderr: e?.message ?? String(e) }));
  if (r.code === 0 || (opts?.anyExit && !r.failed)) return;
  throw new Error(r.stderr?.trim() || `${cmd} exited with ${r.code}`);
}

const fail = (title, e) => notify({ title, body: e?.message ?? String(e), level: "error" });

export default class FileActions extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.platform = appWindow()?.platform;
    this.handle = cx.focus_handle();
    this.at = 0;
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

  choose(item, cx) {
    const p = props();
    closeOverlay(p.overlay);
    const { full, relative } = pathsOf(p.root, p.path, this.platform, p.on);
    if (item.id === "copy" || item.id === "copy-relative") {
      const text = item.id === "copy" ? full : relative;
      // The clipboard is this computer's, also for a space on another machine.
      cx.spawn(async () => {
        try { await attempt(copyPlan(text, this.platform)); notify({ title: "Copied", body: text, level: "success", timeout: 2000 }); }
        catch (e) { fail("Could not copy", e); }
      });
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
      catch (e) { this.error = e?.message ?? String(e); cx.notify(); }
    });
  }

  render(cx) {
    return props()?.create ? this.dialog() : this.menu();
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
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("file-actions-new").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(`New ${p.create} in ${where}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.error ? t.blocked : t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().pt(6).text_size(11.5).text_color(t.blocked).truncate().child(this.error)))
      .child(h_flex().pt(16).gap(8).justify_end()
        .child(button("fa-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("fa-create", "Create", true, (_e, cx) => this.create(cx))));
  }
}
