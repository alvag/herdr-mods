// Wires mods-updates into the status bar of the my-main layout: the bar's
// `status` block becomes a row, Herdr's workspace-status plus a 110 px block
// for the notifier at the right. Edits the layout JSON, so it can run again.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MOD = "mods-updates";
const LAYOUT = "my-main";

const find = (node, test) => test(node) ? node : (node.children ?? []).reduce((hit, c) => hit ?? find(c, test), null);

// The layout with the notifier added, or null when it's already there.
export function withUpdatesBlock(layout, file) {
  if (find(layout, (n) => n.content?.mod === MOD)) return null;
  const out = structuredClone(layout);
  const status = find(out, (n) => n.id === "status");
  if (!status) throw new Error(`${file}: status block not found, Herdr changed it`);
  // Another wire hook (usage-limits) may have made the status a row already.
  if (status.type === "row") {
    status.children.push({ id: "status-updates", type: "block", content: { mod: MOD }, size: { px: 110 } });
    return out;
  }
  const { size } = status;
  const main = { ...status, id: "status-main", size: { weight: 1 } };
  for (const k of Object.keys(status)) delete status[k];
  Object.assign(status, {
    id: "status", type: "row", size, resizable: false,
    children: [main, { id: "status-updates", type: "block", content: { mod: MOD }, size: { px: 110 } }],
  });
  return out;
}

export default function wire({ home, herdr }) {
  // layout.clone also switches the window to the clone.
  if (!existsSync(join(home, "layouts", `${LAYOUT}.json`))) herdr("do", "layout.clone", JSON.stringify({ name: "main", as: LAYOUT }));
  const file = join(home, "layouts", `${LAYOUT}.json`);
  const next = withUpdatesBlock(JSON.parse(readFileSync(file, "utf8")), file);
  if (next) {
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    console.log(`patched ${file}`);
  }
  return { note: `an indicator appears in the status bar of layout "${LAYOUT}" when herdr-mods has an update.` };
}
