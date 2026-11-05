// OpenCode Go: the Go subscription usage API (helpers/opencode-usage.sh).
// The opencode CLI stores the key (v2 SQLite credentials, or legacy auth.json);
// the helper reads it read-only and it only ever travels in the Authorization
// header — nothing here prints, logs, or persists a token.
import { makeWindow, okReport, errorReport, unavailableReport, toEpoch, jsonLines } from "../lib/report.js";

const SOURCE = "opencode API";
const HOUR = 3600;

// Each meter reports percent (0–100) and an absolute resetsAt timestamp.
const METERS = [
  { key: "rolling", id: "rolling", short: "5h", long: "5-hour", durationSec: 5 * HOUR },
  { key: "weekly", id: "weekly", short: "wk", long: "Weekly", durationSec: 7 * 24 * HOUR },
  { key: "monthly", id: "monthly", short: "mo", long: "Monthly", durationSec: null },
];

export function parse(text, now) {
  const body = jsonLines(text)[0];
  if (!body) return errorReport(SOURCE, "No reply from the opencode usage API", now);
  if (body.error) return errorReport(SOURCE, String(body.error.message ?? body.error.code ?? "opencode API rejected the request"), now);
  const usage = body.usage ?? {};
  const windows = METERS.flatMap((m) => {
    const u = usage[m.key];
    if (!u || u.percent == null) return [];
    return [makeWindow({ id: m.id, short: m.short, long: m.long, percent: u.percent, resetsAt: toEpoch(u.resetsAt), durationSec: m.durationSec })];
  });
  if (windows.length === 0) return unavailableReport(SOURCE, "No OpenCode Go usage meters", now);
  return okReport(SOURCE, now, windows, "OpenCode Go");
}

export default {
  id: "opencode-go",
  name: "OpenCode Go",
  icon: "icons/opencode-white.svg",
  helper: "helpers/opencode-usage.sh",
  parse,
};
