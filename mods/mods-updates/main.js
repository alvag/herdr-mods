// A small block for the right of the status bar (layout my-main): says when
// GitHub's main has a newer herdr-mods than the one installed here.
//
// Checks on start and once a day with one `git ls-remote`, plus one GitHub API
// request per tracked mod of someone else's (version.js `external`; those are
// only announced, never updated). Any failure stays silent. The last answers
// are kept in shared("herdr-mods.updates") as
// { checked, remote, notified, external: {name: tree}, extNotified: {name: tree} }.
// version.js is written by the installer.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, notify, run, setShared, shared, theme, window as appWindow } from "herdr";
import { REPO, DAY, contentsUrl, externalNotice, folderUrl, isDue, isOutdated, label, openCommand, outdatedExternal, parseLsRemote, parseTree, updatePlan, waitMs } from "./check.js";
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
    return updatePlan(version.source, Object.keys(version.mods), appWindow()?.platform);
  }

  async check() {
    const ext = version.external ?? {};
    if (!(Object.keys(version.mods).length || Object.keys(ext).length) || !isDue(state().checked ?? null, Date.now())) return;
    const was = state();
    const next = { ...was };
    let answered = false;
    const r = Object.keys(version.mods).length ? await exec("git", ["ls-remote", REPO, "refs/heads/main"]).catch(() => null) : null;
    const remote = r?.code === 0 ? parseLsRemote(r.stdout) : null;
    if (remote) {
      answered = true;
      next.remote = remote;
      const plan = this.plan();
      if (isOutdated(version.mods, remote) && plan && was.notified !== remote) {
        next.notified = remote;
        notify({ title: "herdr-mods has an update", body: "Click to update your installed mods.", action: { name: "tab.new", args: plan } });
      }
    }
    next.external = {};
    next.extNotified = { ...was.extNotified };
    const curl = appWindow()?.platform === "windows" ? "curl.exe" : "curl";
    for (const [name, { repo, path }] of Object.entries(ext)) {
      const e = await exec(curl, ["-fsS", "-H", "Accept: application/vnd.github+json", contentsUrl(repo, path)]).catch(() => null);
      const tree = e?.code === 0 ? parseTree(e.stdout, path) : null;
      next.external[name] = tree ?? was.external?.[name];
      if (tree) answered = true;
      if (tree && tree !== ext[name].tree && was.extNotified?.[name] !== tree) {
        next.extNotified[name] = tree;
        notify(externalNotice(name, ext[name]));
      }
    }
    if (!answered) return;
    next.checked = Date.now();
    setShared(KEY, next);
  }

  open(names, plan) {
    const platform = appWindow()?.platform;
    for (const n of names) {
      const [cmd, args] = openCommand(platform, folderUrl(version.external[n].repo, version.external[n].path));
      exec(cmd, args).catch(() => {});
    }
    if (plan) run("tab.new", plan);
  }

  render() {
    const t = theme();
    const bar = h_flex().size_full().px(14).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8);
    const herdr = this.plan() && isOutdated(version.mods, state().remote);
    const names = outdatedExternal(version.external, state().external);
    const text = label(herdr, names);
    if (!text) return bar;
    return bar.child(div().id("update").text_color(t.accent).cursor_pointer().hover((s) => s.opacity(0.8))
      .on_click(() => (names.length ? this.open(names, herdr && this.plan()) : run("tab.new", this.plan()))).child(text));
  }
}
