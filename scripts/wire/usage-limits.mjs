// Wires usage-limits into the status bar of the my-main layout: the mod is
// "place": "none", so it only shows where a layout puts it. This inserts a
// block between Herdr's workspace-status and the mods-updates notifier.
// Tolerates running before or after the mods-updates hook (a plain status
// block is converted here; an existing row is extended), and it can run again.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MOD = "usage-limits";
const LAYOUT = "my-main";

const find = (node, test) => test(node) ? node : (node.children ?? []).reduce((hit, c) => hit ?? find(c, test), null);

const block = () => ({ id: MOD, type: "block", content: { mod: MOD }, size: { weight: 2.2 }, min: 130 });

// The layout with the usage-limits block added, or null when it's already there.
export function withLimitsBlock(layout, file) {
  if (find(layout, (n) => n.content?.mod === MOD)) return null;
  const out = structuredClone(layout);
  const status = find(out, (n) => n.id === "status");
  if (!status) throw new Error(`${file}: status block not found, Herdr changed it`);
  if (status.type === "row") {
    // mods-updates already wired: keep its notifier last.
    const at = status.children.findIndex((c) => c.id === "status-updates");
    status.children.splice(at === -1 ? status.children.length : at, 0, block());
    return out;
  }
  const { size } = status;
  const main = { ...status, id: "status-main", size: { weight: 1 } };
  for (const k of Object.keys(status)) delete status[k];
  Object.assign(status, {
    id: "status", type: "row", size, resizable: false,
    children: [main, block()],
  });
  return out;
}

export default function wire({ home, herdr }) {
  // layout.clone also switches the window to the clone.
  if (!existsSync(join(home, "layouts", `${LAYOUT}.json`))) herdr("do", "layout.clone", JSON.stringify({ name: "main", as: LAYOUT }));
  const file = join(home, "layouts", `${LAYOUT}.json`);
  const next = withLimitsBlock(JSON.parse(readFileSync(file, "utf8")), file);
  if (next) {
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    console.log(`patched ${file}`);
  }
  return { note: `the limit meters appear in the status bar of layout "${LAYOUT}".` };
}
