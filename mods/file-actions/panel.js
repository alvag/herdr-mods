// Opens files from the Files panel in tabs. Not part of this mod: the installer
// copies it into the my-files clone as file-actions-panel.js, beside its copy of
// actions.js (file-actions.js); mods can't import from another mod's folder.
import { run, setShared, shared, spaces } from "herdr";
import { planOpen, tabTitle } from "./file-actions.js";

export const TABS = "file-actions.tabs";

// A click on a file (pin: a double click): select its tab, show it in the
// space's preview tab, or open a new tab.
export function openFile(path, name, pin, root, on) {
  const space = spaces().find((s) => s.active);
  const live = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  const key = `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const before = (space?.tabs ?? []).map((t) => t.id);
  const r = planOpen(shared(TABS) ?? {}, live, space?.id, { view: path, root, on, name }, pin, key, before);
  setShared(TABS, r.entries);
  const e = r.entries[r.key];
  if (r.action === "new") return run("tab.new", { name: tabTitle(name, e.preview), mod: "file-actions", props: { key: r.key } });
  if (!e.tab) return;
  if (r.rename) run("tab.rename", { id: e.tab, name: r.rename });
  run("tab.select", { id: e.tab });
}

// Where the Files panel stands while a file tab is focused (a mod pane has no
// folder): the file's root, as location() returns it; null for other tabs.
export function viewerLocation(tab, space) {
  const e = Object.values(shared(TABS) ?? {}).find((x) => x.tab === tab);
  return e ? { cwd: e.root, on: e.on ?? null, space } : null;
}
