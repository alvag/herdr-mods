// Pure helpers: is the installed copy behind GitHub's main, and the command
// that updates it. `platform` is this computer's ("macos", "windows", ...).
export const REPO = "https://github.com/alvag/herdr-mods.git";
export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
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

// A recorded mod (mod -> commit) is behind `remote`; an unknown commit counts.
export const isOutdated = (mods, remote) => Boolean(remote) && Object.values(mods).some((c) => c !== remote);

// Milliseconds until the next check; 0 when it's due.
export const waitMs = (last, now) => (last == null ? 0 : Math.max(0, last + DAY - now));
export const isDue = (last, now) => waitMs(last, now) === 0;

// After a check: a day when anything answered, else (offline) an hour.
export const nextCheckMs = (answered) => (answered ? DAY : HOUR);

// exec has no timeout: both give up on a stalled transfer themselves.
export const lsRemoteArgs = () => ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=30", "ls-remote", REPO, "refs/heads/main"];
export const curlArgs = (url) => ["-fsS", "--connect-timeout", "10", "--max-time", "30", "-H", "Accept: application/vnd.github+json", url];

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

// Other people's mods, tracked as { name: { repo, path, tree } }: GitHub's
// contents listing of the folder's parent says the tree sha of the folder.
const encoded = (segments) => segments.map(encodeURIComponent).join("/");
export const contentsUrl = (repo, path) => `https://api.github.com/repos/${encoded(repo.split("/"))}/contents/${encoded(path.split("/").slice(0, -1))}?ref=HEAD`;
export const folderUrl = (repo, path) => `https://github.com/${encoded(repo.split("/"))}/tree/HEAD/${encoded(path.split("/"))}`;

// The sha of the directory `path` in a contents response, else null.
export function parseTree(stdout, path) {
  try {
    const list = JSON.parse(stdout);
    const hit = list.find((e) => e?.type === "dir" && e.name === path.split("/").pop());
    return typeof hit?.sha === "string" ? hit.sha : null;
  } catch {
    return null;
  }
}

// Tracked names whose remote tree is known and differs from the recorded one.
export const outdatedExternal = (external, remote) => Object.keys(external ?? {}).filter((n) => remote?.[n] && remote[n] !== external[n].tree);

// Mods that keep a copy of another one's files, so need installing again.
export const DEPENDENTS = { "file-icons": "file-actions" };

export function externalNotice(name, { repo, path }) {
  const dep = DEPENDENTS[name];
  return {
    title: `${name} has an update`,
    body: `Review it on GitHub, update it, then run: npx github:alvag/herdr-mods track ${name} ${repo} ${path}${dep ? ` and install ${dep} again.` : ""}`,
  };
}

// The block's text: nothing, "herdr-mods ↑", "<name> ↑" or "<n> updates ↑".
export function label(herdrOutdated, names) {
  const n = names.length + (herdrOutdated ? 1 : 0);
  if (!n) return null;
  if (n > 1) return `${n} updates ↑`;
  return `${herdrOutdated ? "herdr-mods" : names[0]} ↑`;
}

// The block's dim text while nothing is behind: "up to date" once a check has
// answered (`checked` in shared state), else nothing (never checked, or offline).
export const idleLabel = (checked) => (checked == null ? null : "up to date");

// Program and arguments that open a page in the default browser.
export function openCommand(platform, url) {
  if (platform === "windows") return ["explorer.exe", [url]];
  return [platform === "macos" ? "open" : "xdg-open", [url]];
}
