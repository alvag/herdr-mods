import { errorReport } from "./report.js";

// Mod timeout must be shorter than the exec timeout so the mod's own message
// is deterministic: the exec's rejection text depends on the app/runtime.
export const EXEC_TIMEOUT_MS = 30_000;
export const MOD_TIMEOUT_MS = 25_000;

// `schedule(ms, fn)` schedules `fn` after `ms` and returns a cancel function.
// In the mod runtime this wraps `cx.timer.after`; in Node tests it can wrap
// `setTimeout`/`clearTimeout`. The mod code must never touch global timer APIs.
export async function fetchProvider(run, schedule, helperPath, source, parse, now, modTimeoutMs = MOD_TIMEOUT_MS) {
  let execPromise;
  try {
    execPromise = run("sh", [helperPath], { timeout: EXEC_TIMEOUT_MS });
  } catch (e) {
    return { installed: true, report: errorReport(source, String(e?.message ?? e), now) };
  }

  let cancelTimer = () => {};
  const timer = new Promise((resolve) => {
    cancelTimer = schedule(modTimeoutMs, () => resolve({ timedOut: true }));
  });
  // If the exec rejects after we already timed out, swallow it: the mod has
  // moved on and we must not crash the runtime with an unhandled rejection.
  execPromise.catch(() => {});

  try {
    const r = await Promise.race([execPromise, timer]);
    cancelTimer();
    if (r?.timedOut) {
      return { installed: true, report: errorReport(source, `${source} did not respond in ${Math.round(modTimeoutMs / 1000)}s`, now) };
    }
    if (r.code === 127) return { installed: false, report: null };
    return { installed: true, report: parse(r.stdout, now) };
  } catch (e) {
    cancelTimer();
    return { installed: true, report: errorReport(source, String(e?.message ?? e), now) };
  }
}
