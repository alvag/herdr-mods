// Opens files from the Files panel in tabs. Not part of this mod: the installer
// copies it into the my-files clone as file-actions-panel.js, beside its copy of
// actions.js (file-actions.js); mods can't import from another mod's folder.
import { appHome, readTextFile, run, setShared, shared, spaces, window as appWindow } from "herdr";
import { opensImage, pathsOf, planOpen, tabTitle } from "./file-actions.js";

export const TABS = "file-actions.tabs";

// A click on a file (pin: a double click): select its tab, show it in the
// space's preview tab, or open a new tab. Images instead go to the
// image-viewer mod, when it is installed; without it they keep the text tab.
export function openFile(path, name, pin, root, on) {
  if (opensImage(name, on)) {
    readTextFile(`${appHome()}/mods/image-viewer/mod.json`)
      .then((mod) => {
        if (mod != null) {
          const file = pathsOf(root, path, appWindow()?.platform, null).full;
          run("tab.new", { name, mod: "image-viewer", props: { file } });
        } else {
          openText(path, name, pin, root, on);
        }
      })
      .catch(() => openText(path, name, pin, root, on));
    return;
  }
  openText(path, name, pin, root, on);
}

// The text-viewer tab flow, as it always was.
function openText(path, name, pin, root, on) {
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
