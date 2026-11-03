// Wires file-actions into the Files panel's rows (right-click).
//
// Herdr's own `files` mod is read-only, so this clones it as `my-files` and
// points the `my-main` layout (cloned from `main` if needed) at it. The clone
// doesn't receive Herdr's updates: see docs/file-actions.md.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MOD = "file-actions";
const FILES = "my-files";
const LAYOUT = "my-main";
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default function wire({ home, herdr, patch }) {
  if (!existsSync(join(home, "mods", FILES))) herdr("do", "mod.clone", JSON.stringify({ name: "files", as: FILES }));
  // layout.clone also switches the window to the clone.
  if (!existsSync(join(home, "layouts", `${LAYOUT}.json`))) herdr("do", "layout.clone", JSON.stringify({ name: "main", as: LAYOUT }));

  // A mod can't import from another mod's folder: the clone gets its own copy,
  // refreshed on every install.
  cpSync(join(repo, "mods", MOD, "actions.js"), join(home, "mods", FILES, `${MOD}.js`));

  const files = join(home, "mods", FILES, "main.js");
  patch(files, `from "./${MOD}.js"`,
    `import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window } from "herdr";`,
    `import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, openOverlay } from "herdr";
import { menuHeight } from "./${MOD}.js";`);
  patch(files, `mod: "${MOD}", kind: "popup"`,
    `        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))`,
    `        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", () => openOverlay({ mod: "${MOD}", kind: "popup", width: 230, height: menuHeight(window()?.platform, this.on),
          props: { root: this.root, path, dir: entry.dir, on: this.on } }))`);

  // A click on a file opens it as a whole tab instead of the panel's small preview.
  patch(files, `openOverlay, run } from "herdr"`,
    `window, openOverlay } from "herdr";`,
    `window, openOverlay, run } from "herdr";`);
  patch(files, `mod: "${MOD}", props: { view: path`,
    `        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))`,
    `        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx)
          : run("tab.new", { name: entry.name, mod: "${MOD}", props: { view: path, root: this.root, on: this.on } }))`);

  // A viewer tab has no folder, so the panel would fall back to the space's:
  // keep showing the folder the file came from.
  patch(files, `let lastLocation = null;`,
    `function location() {`,
    `let lastLocation = null;
function location() {`);
  patch(files, `pane?.mod === "${MOD}"`,
    `  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };`,
    `  if (pane?.mod === "${MOD}" && lastLocation?.space === space?.id) return lastLocation;
  return (lastLocation = { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id });`);

  patch(join(home, "layouts", `${LAYOUT}.json`), `"mod": "${FILES}"`,
    `"mod": "files"`,
    `"mod": "${FILES}"`);

  herdr("do", "layout.switch", JSON.stringify({ name: LAYOUT }));
  return { checks: [FILES], note: `right-click a file or folder in the Files panel of layout "${LAYOUT}".` };
}
