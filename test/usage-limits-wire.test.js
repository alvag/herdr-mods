import process from "node:process";
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLimitsBlock } from "../scripts/wire/usage-limits.mjs";
import { withUpdatesBlock } from "../scripts/wire/mods-updates.mjs";

const layout = () => ({
  id: "root", type: "row", children: [{ id: "work", type: "column", children: [
    { id: "tabs", type: "block", content: { mod: "tabs" }, size: { px: 42 } },
    { id: "status", type: "block", content: { mod: "workspace-status" }, size: { px: 28 } },
  ] }],
});

const LIMITS = { id: "usage-limits", type: "block", content: { mod: "usage-limits" }, size: { weight: 2.2 }, min: 130 };
const UPDATES = { id: "status-updates", type: "block", content: { mod: "mods-updates" }, size: { px: 110 } };

test("layout: a plain status block becomes a row with usage-limits after workspace-status", () => {
  const out = withLimitsBlock(layout(), "my-main.json");
  const row = out.children[0].children[1];
  assert.deepEqual(row, {
    id: "status", type: "row", size: { px: 28 }, resizable: false,
    children: [
      { id: "status-main", type: "block", content: { mod: "workspace-status" }, size: { weight: 1 } },
      LIMITS,
    ],
  });
  assert.deepEqual(out.children[0].children[0], layout().children[0].children[0]);
});

test("layout: an existing status row gets usage-limits between workspace-status and the notifier", () => {
  const out = withLimitsBlock(withUpdatesBlock(layout(), "f"), "f");
  const row = out.children[0].children[1];
  assert.deepEqual(row.children.map((c) => c.id), ["status-main", "usage-limits", "status-updates"]);
  assert.deepEqual(row.children[1], LIMITS);
});

test("layout: a second run changes nothing (null)", () => {
  assert.equal(withLimitsBlock(withLimitsBlock(layout(), "f"), "f"), null);
});

test("layout: no status block fails naming the file", () => {
  assert.throws(() => withLimitsBlock({ id: "root", type: "row", children: [] }, "my-main.json"), /my-main\.json: status block not found/);
});

test("hooks are order-independent: both wirings end with the same status row", () => {
  const limitsFirst = withUpdatesBlock(withLimitsBlock(layout(), "f"), "f");
  const updatesFirst = withLimitsBlock(withUpdatesBlock(layout(), "f"), "f");
  const ids = (out) => out.children[0].children[1].children.map((c) => c.id);
  assert.deepEqual(ids(limitsFirst), ["status-main", "usage-limits", "status-updates"]);
  assert.deepEqual(ids(updatesFirst), ["status-main", "usage-limits", "status-updates"]);
  assert.deepEqual(limitsFirst.children[0].children[1], updatesFirst.children[0].children[1]);
});

test("notifier hook: a status row made by the usage-limits hook still gets its block", () => {
  const out = withUpdatesBlock(withLimitsBlock(layout(), "f"), "f");
  const row = out.children[0].children[1];
  assert.deepEqual(row.children[2], UPDATES);
  assert.equal(withUpdatesBlock(out, "f"), null, "second run is a no-op");
});
