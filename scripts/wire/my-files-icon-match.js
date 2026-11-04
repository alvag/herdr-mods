// File and folder icon matching for my-files, ported from cybertron288's file-icons mod
// (https://github.com/cybertron288/herdr-mods, MIT, commit 34e7c33), which follows
// VS Code's Material Icon Theme. The table-free half: my-files-icons.js binds it to
// the table, so tests can pass a small fake one. Copied into my-files by the installer.
//
// Names match case-insensitively; a path rule (".github/workflows") beats a name, a name
// beats an extension, and the longest extension wins ("spec.ts" over "ts"). Light themes
// check the table's light entries first.
const DIR = "mods/file-icons";
const bare = name => name.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "");
const opened = id => id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`;
const lookup = (icons, table, key, dark) => (dark ? undefined : icons.light[table][key]) ?? icons[table][key];

export function iconFor(icons, path, dir, open, dark) {
  const parts = path.toLowerCase().split("/"), name = parts[parts.length - 1];
  const table = dir ? "folderNames" : "fileNames";
  const find = key => lookup(icons, table, key, dark) ?? (dir ? lookup(icons, table, bare(key), dark) : undefined);
  let id;
  for (let i = 0; !id && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) {
    id ??= find(name) ?? icons.folder;
    return `${DIR}/icons/${open ? opened(id) : id}.svg`;
  }
  id ??= lookup(icons, table, name, dark);
  for (let dot = name.indexOf("."); !id && dot !== -1; dot = name.indexOf(".", dot + 1)) id = lookup(icons, "fileExtensions", name.slice(dot + 1), dark);
  return `${DIR}/icons/${id ?? icons.file}.svg`;
}
