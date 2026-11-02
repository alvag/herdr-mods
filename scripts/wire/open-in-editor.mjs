// Wires open-in-editor into the space right-click menu.
//
// Herdr's own `menu` and `spaces` mods are read-only, so this clones them as
// `my-menu` and `my-spaces`, and clones the `main` layout as `my-main` with
// its sidebar pointing at `my-spaces`. Clones don't receive Herdr's updates.
import { existsSync } from "node:fs";
import { join } from "node:path";

const MOD = "open-in-editor";
const MENU = "my-menu";
const SPACES = "my-spaces";
const LAYOUT = "my-main";

export default function wire({ home, herdr, patch }) {
  if (!existsSync(join(home, "mods", MENU))) herdr("do", "mod.clone", JSON.stringify({ name: "menu", as: MENU }));
  if (!existsSync(join(home, "mods", SPACES))) herdr("do", "mod.clone", JSON.stringify({ name: "spaces", as: SPACES }));
  // layout.clone also switches the window to the clone.
  if (!existsSync(join(home, "layouts", `${LAYOUT}.json`))) herdr("do", "layout.clone", JSON.stringify({ name: "main", as: LAYOUT }));

  const menu = join(home, "mods", MENU, "main.js");
  patch(menu, `"${MOD}", { editor: "vscode"`,
    `        ["Close", "space.close", { id: tg.id }],`,
    `        ["Open in VS Code", "${MOD}", { editor: "vscode", space: tg.id }],
        ["Open in WebStorm", "${MOD}", { editor: "webstorm", space: tg.id }],
        ["Close", "space.close", { id: tg.id }],`);
  patch(menu, `mod: "${MOD}", kind: "dialog"`,
    `    else run(it[1], it[2]);`,
    `    else if (it[1] === "${MOD}") openOverlay({ mod: "${MOD}", kind: "dialog", width: 460, height: 112, props: it[2] });
    else run(it[1], it[2]);`);
  patch(menu, "`mods/" + MOD + "/${it[2].editor}.svg`",
    `svg(menuIcon(it[1]))`,
    "svg(it[1] === \"" + MOD + "\" ? `mods/" + MOD + "/${it[2].editor}.svg` : menuIcon(it[1]))");

  // Two more rows (31 px each) in the space menu.
  const spaces = join(home, "mods", SPACES, "main.js");
  patch(spaces, `mod: "${MENU}"`,
    `openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260,`,
    `openOverlay({ mod: "${MENU}", kind: "popup", width: 200, height: 330,`);

  // A file manager row where there is one to open: Finder or Explorer.
  const fileManager = { darwin: "Finder", win32: "Explorer" }[process.platform];
  if (fileManager) {
    patch(menu, `editor: "finder"`,
      `        ["Open in WebStorm", "${MOD}", { editor: "webstorm", space: tg.id }],`,
      `        ["Open in WebStorm", "${MOD}", { editor: "webstorm", space: tg.id }],
        ["Open in ${fileManager}", "${MOD}", { editor: "finder", space: tg.id }],`);
    patch(spaces, `width: 200, height: 361,`, `width: 200, height: 330,`, `width: 200, height: 361,`);
  }

  patch(join(home, "layouts", `${LAYOUT}.json`), `"mod": "${SPACES}"`,
    `"mod": "spaces"`,
    `"mod": "${SPACES}"`);

  herdr("do", "layout.switch", JSON.stringify({ name: LAYOUT }));
  return { checks: [MENU, SPACES], note: `right-click a space in the sidebar of layout "${LAYOUT}".` };
}
