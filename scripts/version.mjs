// Pure helpers for what the installer records in mods/mods-updates/version.js.

// The sha npx resolved for this repo, from its package-lock.json text.
export function commitFromLock(text) {
  return /"resolved":\s*"git\+[^"]*alvag\/herdr-mods(?:\.git)?#([0-9a-f]{40})"/.exec(text ?? "")?.[1] ?? null;
}

// Mod -> commit it was installed at, for repository mods with a folder in the
// home (without the notifier). Just installed ones get `commit`; the rest keep
// their recorded one, or null when unknown (installed before tracking).
export function recordedMods(previous, installed, existing, commit, available) {
  return Object.fromEntries(available
    .filter((m) => m !== "mods-updates" && existing.includes(m))
    .sort()
    .map((m) => [m, installed.includes(m) ? commit : previous?.[m] ?? null]));
}

export const renderVersion = (v) => `export default ${JSON.stringify(v, null, 2)};\n`;

export function parseVersion(text) {
  try {
    return JSON.parse(/^export default ([\s\S]*?);\s*$/.exec(text)[1]);
  } catch {
    return null;
  }
}
