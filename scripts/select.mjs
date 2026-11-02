// Which mods to install: the named ones, or every mod when none is named.
export function selectMods(available, requested) {
  const all = [...available].sort();
  if (requested.length === 0) return all;
  const unknown = requested.filter((name) => !all.includes(name));
  if (unknown.length) throw new Error(`Unknown mod: ${unknown.join(", ")}. Available: ${all.join(", ")}`);
  return [...new Set(requested)];
}
