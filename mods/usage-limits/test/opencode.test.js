import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import opencode from "../providers/opencode.js";
import { MOD, NOW, read } from "./_util.js";

test("descriptor", () => {
  assert.equal(opencode.id, "opencode-go");
  assert.equal(opencode.name, "OpenCode Go");
  assert.equal(opencode.icon, "icons/opencode.svg");
  assert.equal(opencode.helper, "helpers/opencode-usage.sh");
});

test("usage fixture → three windows in order", () => {
  const r = opencode.parse(read("opencode-usage.ok.json"), NOW);
  assert.equal(r.status, "ok");
  assert.equal(r.plan, "OpenCode Go");
  assert.equal(r.source, "opencode API");
  assert.equal(r.observedAt, NOW);
  assert.deepEqual(r.windows.map((w) => [w.id, w.short, w.long, w.percent]), [
    ["rolling", "5h", "5-hour", 13],
    ["weekly", "wk", "Weekly", 5],
    ["monthly", "mo", "Monthly", 2],
  ]);
  assert.equal(r.windows[0].resetsAt, Math.floor(Date.parse("2026-11-05T17:15:52.000Z") / 1000));
  assert.equal(r.windows[1].resetsAt, Math.floor(Date.parse("2026-11-09T00:00:00.000Z") / 1000));
  assert.equal(r.windows[2].resetsAt, Math.floor(Date.parse("2026-12-05T12:00:06.000Z") / 1000));
  assert.deepEqual(r.windows.map((w) => w.durationSec), [18000, 604800, null]);
});

test("partial usage → only the meters that report percent", () => {
  const r = opencode.parse(JSON.stringify({ usage: { rolling: { status: "ok", percent: 42, resetsAt: null } } }), NOW);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.windows.map((w) => w.id), ["rolling"]);
  assert.equal(r.windows[0].percent, 42);
  assert.equal(r.windows[0].resetsAt, null);
});

test("expired key body → error with the API message", () => {
  const r = opencode.parse(read("opencode-usage.expired.json"), NOW);
  assert.equal(r.status, "error");
  assert.match(r.message, /expired/);
  assert.equal(r.plan, null);
  assert.equal(r.windows.length, 0);
});

test("empty usage object → unavailable", () => {
  const r = opencode.parse(JSON.stringify({ usage: {} }), NOW);
  assert.equal(r.status, "unavailable");
});

test("not JSON → error", () => {
  const r = opencode.parse("gateway banner, no JSON", NOW);
  assert.equal(r.status, "error");
});

// ---- helper ----

function runHelper(env) {
  return spawnSync("sh", [join(MOD, "helpers", "opencode-usage.sh")], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30000,
  });
}

test("helper: no credentials anywhere → exit 127, no stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-none-"));
  const r = runHelper({ HERDR_USAGE_OPENCODE_DB: join(dir, "nope.db"), HERDR_USAGE_OPENCODE_AUTH: join(dir, "nope.json") });
  assert.equal(r.status, 127);
  assert.equal(r.stdout, "");
});

test("helper: key in auth.json, unreachable API → exit 1, key never printed", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-auth-"));
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ "opencode-go": { type: "api", key: "sk-test-opencode-secret" } }));
  const r = runHelper({
    HERDR_USAGE_OPENCODE_DB: join(dir, "nope.db"),
    HERDR_USAGE_OPENCODE_AUTH: join(dir, "auth.json"),
    HERDR_USAGE_OPENCODE_URL: "http://127.0.0.1:1/usage",
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.doesNotMatch((r.stdout ?? "") + (r.stderr ?? ""), /sk-test-opencode-secret/, "the key leaked");
});
