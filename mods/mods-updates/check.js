// Pure helpers: is the installed copy behind GitHub's main, and the command
// that updates it. `platform` is this computer's ("macos", "windows", ...).
export const REPO = "https://github.com/alvag/herdr-mods.git";
export const DAY = 24 * 60 * 60 * 1000;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Text as a PowerShell expression that never parses the text itself (UTF-8
// base64, decoded by PowerShell). Copied from file-actions: a mod can't import
// from another mod's folder.
function literal(text) {
  const bytes = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    b64 += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`;
}

// The sha on `git ls-remote <repo> refs/heads/main`, else null.
export function parseLsRemote(stdout) {
  return /^([0-9a-f]{40})\s+refs\/heads\/main$/m.exec(stdout ?? "")?.[1] ?? null;
}

export const isOutdated = (commit, remote) => Boolean(commit && remote && commit !== remote);

// Milliseconds until the next check; 0 when it's due.
export const waitMs = (last, now) => (last == null ? 0 : Math.max(0, last + DAY - now));
export const isDue = (last, now) => waitMs(last, now) === 0;

// Arguments of `tab.new` that run the update. A clone pulls and installs in its
// folder; names reach the shell as arguments, never inside its script.
export function updatePlan(source, mods, platform) {
  const names = mods.length ? mods : ["mods-updates"];
  const name = "Update herdr-mods";
  const win = platform === "windows";
  if (source?.kind === "npx") return { name, argv: [win ? "npx.cmd" : "npx", "--yes", "github:alvag/herdr-mods", ...names] };
  if (source?.kind !== "clone") return null;
  const argv = win
    ? ["powershell", "-NoProfile", "-Command", `git pull --ff-only; if ($LASTEXITCODE -eq 0) { npm.cmd run install-mod -- ${names.map(literal).join(" ")} }`]
    : ["sh", "-c", 'git pull --ff-only && npm run install-mod -- "$@"', "sh", ...names];
  return { name, folder: source.path, argv };
}
