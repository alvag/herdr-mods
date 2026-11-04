// Pure helpers for the registry of other people's mods (herdr-mods.external.json):
// { "<name>": { repo, path, tree } }, kept sorted by name.

const sorted = (reg) => Object.fromEntries(Object.entries(reg).sort(([a], [b]) => (a < b ? -1 : 1)));

// `track <name> <owner/repo> <path>` arguments, or throws with the usage.
export function parseTrackArgs(args) {
  const [name, repo, path, ...rest] = args;
  const ok = name && /^[\w.-]+\/[\w.-]+$/.test(repo ?? "") && path && !rest.length
    && path.split("/").every((s) => s && s !== "." && s !== "..");
  if (!ok) throw new Error("Usage: track <name> <owner/repo> <path in that repo>");
  return { name, repo, path };
}

export const addEntry = (reg, name, entry) => sorted({ ...reg, [name]: entry });

export function removeEntry(reg, name) {
  if (!Object.hasOwn(reg, name)) throw new Error(`Not tracked: ${name}. Tracked: ${Object.keys(reg).join(", ") || "none"}`);
  const { [name]: _gone, ...rest } = reg;
  return rest;
}

export function parseRegistry(text) {
  try {
    const reg = JSON.parse(text);
    return reg && typeof reg === "object" && !Array.isArray(reg) ? sorted(reg) : {};
  } catch {
    return {};
  }
}
