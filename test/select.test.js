import { test } from "node:test";
import assert from "node:assert/strict";
import { selectMods } from "../scripts/select.mjs";

const available = ["open-in-editor", "b-mod", "c-mod"];

test("no names selects every mod, sorted", () => {
  assert.deepEqual(selectMods(available, []), ["b-mod", "c-mod", "open-in-editor"]);
});

test("names select only those, in the given order, without duplicates", () => {
  assert.deepEqual(selectMods(available, ["open-in-editor"]), ["open-in-editor"]);
  assert.deepEqual(selectMods(available, ["c-mod", "b-mod", "c-mod"]), ["c-mod", "b-mod"]);
});

test("an unknown name fails and lists the available mods", () => {
  assert.throws(() => selectMods(available, ["open-in-editor", "nope"]), {
    message: "Unknown mod: nope. Available: b-mod, c-mod, open-in-editor",
  });
});
