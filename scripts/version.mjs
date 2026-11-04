// Pure helpers for what the installer records in mods/mods-updates/version.js.

// The sha npx resolved for this repo, from its package-lock.json text.
export function commitFromLock(text) {
  return /"resolved":\s*"git\+[^"]*alvag\/herdr-mods(?:\.git)?#([0-9a-f]{40})"/.exec(text ?? "")?.[1] ?? null;
}

// Mods to update later: those recorded before and those just installed that
// still have a folder, without the notifier itself.
export function recordedMods(previous, installed, existing) {
  return [...new Set([...(previous ?? []), ...installed])]
    .filter((m) => m !== "mods-updates" && existing.includes(m))
    .sort();
}

export const renderVersion = (v) => `export default ${JSON.stringify(v, null, 2)};\n`;

export function parseVersion(text) {
  try {
    return JSON.parse(/^export default ([\s\S]*?);\s*$/.exec(text)[1]);
  } catch {
    return null;
  }
}
