// A small block for the right of the status bar (layout my-main): says when
// GitHub's main has a newer herdr-mods than the one installed here.
//
// Checks on start and once a day with one `git ls-remote`; any failure stays
// silent. The last answer is kept in shared("herdr-mods.updates") as
// { checked, remote, notified }. version.js is written by the installer.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, notify, run, setShared, shared, theme, window as appWindow } from "herdr";
import { REPO, DAY, isDue, isOutdated, parseLsRemote, updatePlan, waitMs } from "./check.js";
import version from "./version.js";

const KEY = "herdr-mods.updates";
const state = () => shared(KEY) ?? {};

export default class ModsUpdates extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const wait = waitMs(state().checked ?? null, Date.now());
        if (wait) await new Promise((done) => cx.timer.after(wait, done));
        await this.check();
        cx.notify();
        await new Promise((done) => cx.timer.after(DAY, done));
      }
    });
  }

  plan() {
    return updatePlan(version.source, version.mods, appWindow()?.platform);
  }

  async check() {
    if (!version.commit || !isDue(state().checked ?? null, Date.now())) return;
    const r = await exec("git", ["ls-remote", REPO, "refs/heads/main"]).catch(() => null);
    const remote = r?.code === 0 ? parseLsRemote(r.stdout) : null;
    if (!remote) return;
    const was = state();
    const next = { ...was, checked: Date.now(), remote };
    const plan = this.plan();
    if (isOutdated(version.commit, remote) && plan && was.notified !== remote) {
      next.notified = remote;
      notify({ title: "herdr-mods has an update", body: "Click to update your installed mods.", action: { name: "tab.new", args: plan } });
    }
    setShared(KEY, next);
  }

  render() {
    const t = theme();
    const bar = h_flex().size_full().px(14).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8);
    const plan = this.plan();
    if (!plan || !isOutdated(version.commit, state().remote)) return bar;
    return bar.child(div().id("update").text_color(t.accent).cursor_pointer().hover((s) => s.opacity(0.8))
      .on_click(() => run("tab.new", plan)).child("herdr-mods ↑"));
  }
}
