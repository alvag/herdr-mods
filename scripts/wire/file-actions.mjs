// Wires file-actions into the Files panel's rows (right-click).
//
// Herdr's own `files` mod is read-only, so this clones it as `my-files` and
// points the `my-main` layout (cloned from `main` if needed) at it. The clone
// doesn't receive Herdr's updates: see docs/file-actions.md.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
  cpSync(join(repo, "mods", MOD, "panel.js"), join(home, "mods", FILES, `${MOD}-panel.js`));

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

  // A click on a file opens it in a tab instead of the panel's small preview: the
  // space's preview tab, reused by the next click; a double click pins it.
  const click = `        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))`;
  const text = readFileSync(files, "utf8"), before = `
          : run("tab.new", { name: entry.name, mod: "${MOD}", props: { view: path, root: this.root, on: this.on } }))`;
  // Installed by an earlier version (one tab per click): put Herdr's line back first.
  if (text.includes(before)) writeFileSync(files, text.replace(`        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx)${before}`, click));
  patch(files, `${MOD}-panel.js`,
    `import { menuHeight } from "./${MOD}.js";`,
    `import { menuHeight } from "./${MOD}.js";
import { openFile } from "./${MOD}-panel.js";`);
  patch(files, `viewerLocation }`,
    `import { openFile } from "./${MOD}-panel.js";`,
    `import { openFile, viewerLocation } from "./${MOD}-panel.js";`);
  patch(files, `openFile(path,`,
    click,
    `        .on_click((e, cx) => entry.dir ? this.toggle(path, cx) : openFile(path, entry.name, e.click_count === 2, this.root, this.on))`);

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
  // Better than the last folder: the focused file tab's own root.
  patch(files, `viewerLocation(f?.tab`,
    `  if (pane?.mod === "${MOD}" && lastLocation`,
    `  if (pane?.mod === "${MOD}") { const v = viewerLocation(f?.tab, space?.id); if (v) return (lastLocation = v); }
  if (pane?.mod === "${MOD}" && lastLocation`);

  // Optional icons, from the file-icons mod (its icon table and SVGs stay where they are).
  const table = join(home, "mods", "file-icons", "icons.js");
  const icons = existsSync(table);
  if (icons) {
    cpSync(table, join(home, "mods", FILES, "file-icons-table.js"));
    for (const f of ["my-files-icon-match.js", "my-files-icons.js"]) cpSync(join(repo, "scripts", "wire", f), join(home, "mods", FILES, f));
    patch(files, `from "./my-files-icons.js"`,
      `import { View, div, svg } from "gpui-kit";`,
      `import { View, div, svg, image } from "gpui-kit";
import { icon } from "./my-files-icons.js";`);
    patch(files, `.child(image(icon(`,
      `        .child(svg(\`mods/${FILES}/\${entry.dir ? "folder" : "file"}.svg\`).size(14).flex_none().text_color(t.muted))`,
      `        .child(image(icon(path, entry.dir, open, Boolean(settings().dark))).size(16).flex_none())`);
  }

  patch(join(home, "layouts", `${LAYOUT}.json`), `"mod": "${FILES}"`,
    `"mod": "files"`,
    `"mod": "${FILES}"`);

  herdr("do", "layout.switch", JSON.stringify({ name: LAYOUT }));
  const note = `right-click a file or folder in the Files panel of layout "${LAYOUT}".`;
  return { checks: [FILES], note: icons ? note : `${note} No file icons: they need mods/file-icons (herdr.dev/mods/cybertron288/file-icons), then install again.` };
}
