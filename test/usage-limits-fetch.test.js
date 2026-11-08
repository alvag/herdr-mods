import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchProvider, EXEC_TIMEOUT_MS, MOD_TIMEOUT_MS } from "../mods/usage-limits/lib/fetch.js";

const NOW = 1_700_000_000;
const HELP = "/home/herdr/mods/usage-limits/helpers/claude-usage.sh";
const SOURCE = "helpers/claude-usage.sh";

const parse = (stdout, now) => ({ status: "ok", source: "fake", observedAt: now, stdout });

// Double of the runtime timer API: Node has setTimeout/clearTimeout and the
// tests are allowed to use them, but the mod code under test is not. Capture
// them in the closure so the runtime simulation test can delete the globals.
const nodeSchedule = (() => {
  const setTimeout_ = setTimeout;
  const clearTimeout_ = clearTimeout;
  return (ms, fn) => {
    const id = setTimeout_(fn, ms);
    return () => clearTimeout_(id);
  };
})();

test("timeout constants", () => {
  assert.equal(EXEC_TIMEOUT_MS, 30_000);
  assert.equal(MOD_TIMEOUT_MS, 25_000);
});

test("run that never resolves → resolves with timeout report before watchdog", async () => {
  let resolveRun;
  const calls = [];
  const run = (_cmd, _args, opts) => {
    calls.push(opts);
    return new Promise((resolve) => { resolveRun = resolve; });
  };

  const p = fetchProvider(run, nodeSchedule, HELP, SOURCE, parse, NOW, 50);
  const watchdog = new Promise((resolve) => setTimeout(() => resolve(null), 500));

  try {
    const r = await Promise.race([p, watchdog]);
    assert.notEqual(r, null, "fetchProvider should resolve before watchdog");
    assert.equal(r.installed, true);
    assert.equal(r.report.status, "error");
    assert.match(r.report.message, /helpers\/claude-usage\.sh did not respond/);
    assert.deepEqual(calls, [{ timeout: 30_000 }]);
  } finally {
    resolveRun?.({ code: 0, stdout: "" });
  }
});

test("timeout message reports the mod limit when the default fires", async () => {
  const run = () => new Promise(() => {});
  // Fire immediately so the test does not wait 25 s; the message still uses
  // the configured mod limit.
  const immediateSchedule = (_ms, fn) => {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  };

  const r = await fetchProvider(run, immediateSchedule, HELP, SOURCE, parse, NOW);
  assert.equal(r.installed, true);
  assert.equal(r.report.status, "error");
  assert.equal(r.report.message, "helpers/claude-usage.sh did not respond in 25s");
});

test("run that rejects after the mod timeout is swallowed, not unhandled", async () => {
  // The exec is a real promise; the thenable wrapper only forwards fulfillment
  // to Promise.race. This simulates a runtime where the race does not keep a
  // rejection handler for the losing promise, so the only protection against
  // a late exec rejection is the explicit execPromise.catch guard.
  let rejectExec;
  const execPromise = new Promise((_resolve, reject) => { rejectExec = reject; });
  const run = () => ({
    // Never resolve via the exec path; the timer wins the race. Crucially,
    // do not attach any handler to execPromise here, so a late rejection is
    // unhandled unless fetchProvider's explicit execPromise.catch guard does.
    then() {},
    catch(onRejected) {
      execPromise.catch(onRejected);
    },
  });

  // Fire the mod timer immediately so we can observe the late exec rejection
  // without waiting for the real 25 s timeout.
  const immediateSchedule = (_ms, fn) => {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  };

  const r = await fetchProvider(run, immediateSchedule, HELP, SOURCE, parse, NOW);
  assert.equal(r.installed, true);
  assert.equal(r.report.status, "error");
  assert.equal(r.report.message, "helpers/claude-usage.sh did not respond in 25s");

  // The exec rejects after the mod has already moved on. Without the
  // execPromise.catch guard in fetch.js this becomes an unhandled rejection
  // in the mod runtime, which has no process.on('unhandledRejection') safety
  // net. Yield to give the runtime a chance to report it.
  rejectExec(new Error("late exec rejection"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("run that rejects → error report, promise does not reject", async () => {
  const run = () => Promise.reject(new Error("boom"));
  const r = await fetchProvider(run, nodeSchedule, HELP, SOURCE, parse, NOW);
  assert.equal(r.installed, true);
  assert.equal(r.report.status, "error");
  assert.equal(r.report.message, "boom");
});

test("run with code 127 → provider not installed", async () => {
  const run = () => Promise.resolve({ code: 127, stdout: "" });
  const r = await fetchProvider(run, nodeSchedule, HELP, SOURCE, parse, NOW);
  assert.equal(r.installed, false);
  assert.equal(r.report, null);
});

test("run with code 0 and valid stdout → parsed report", async () => {
  const run = () => Promise.resolve({ code: 0, stdout: "hello" });
  const r = await fetchProvider(run, nodeSchedule, HELP, SOURCE, parse, NOW);
  assert.equal(r.installed, true);
  assert.equal(r.report.status, "ok");
  assert.equal(r.report.observedAt, NOW);
  assert.equal(r.report.stdout, "hello");
});

test("pending timer is canceled when exec wins the race", async () => {
  let canceled = false;
  const run = () => Promise.resolve({ code: 0, stdout: "winner" });
  const trackingSchedule = (_ms, fn) => {
    const id = setTimeout(fn, 10_000);
    return () => {
      canceled = true;
      clearTimeout(id);
    };
  };

  const r = await fetchProvider(run, trackingSchedule, HELP, SOURCE, parse, NOW);
  assert.equal(r.report.stdout, "winner");
  assert.equal(canceled, true, "timer should be canceled after exec resolves");
});

test("fetchProvider does not call global setTimeout/clearTimeout", async () => {
  // Simulate the mod runtime where global timer APIs do not exist. The
  // injected schedule is the only timer source, so fetching still works.
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  delete globalThis.setTimeout;
  delete globalThis.clearTimeout;

  try {
    const run = () => Promise.resolve({ code: 0, stdout: "runtime ok" });
    const r = await fetchProvider(run, nodeSchedule, HELP, SOURCE, parse, NOW);
    assert.equal(r.report.stdout, "runtime ok");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
