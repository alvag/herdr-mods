// Pure helpers: the right-click menu of a Files row, its paths, and the
// programs behind each action. `on` is the machine of a space on another
// computer (null here); `platform` is this computer's ("macos", "windows", ...).
//
// The installer also copies this file into the my-files clone, which uses
// menuHeight() to size the popup; mods can't import from another mod's folder.

const DESKTOP = ["macos", "windows"];
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Text as a PowerShell expression that never parses the text itself: UTF-8 bytes
// in base64, decoded by PowerShell. Quoting isn't enough, PowerShell also ends
// strings at curly quotes (’ ‘ ‚ ‛). No Buffer or btoa in Herdr's runtime.
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

// Rows in order; `copy` and `reveal` need this computer's clipboard and file manager.
export function menuItems(platform, on) {
  const desk = DESKTOP.includes(platform);
  return [
    ...(desk ? [{ id: "copy", label: "Copy path", icon: "files" }, { id: "copy-relative", label: "Copy relative path", icon: "file-text" }] : []),
    ...(desk && !on ? [{ id: "reveal", label: `Reveal in ${platform === "windows" ? "Explorer" : "Finder"}`, icon: "folder" }] : []),
    { id: "new-file", label: "New file…", icon: "plus", separated: desk },
    { id: "new-folder", label: "New folder…", icon: "folder-plus" },
  ];
}

// Popup height: 31 px rows, 5 px padding top and bottom, 9 px per separator.
export function menuHeight(platform, on) {
  const items = menuItems(platform, on);
  return 10 + 31 * items.length + 9 * items.filter((it) => it.separated).length;
}

// The entry's full path and its path relative to the panel's root. Windows paths
// on this computer use backslashes; another machine's stay as they are.
export function pathsOf(root, path, platform, on) {
  const full = path ? `${root}/${path}` : root;
  const win = (s) => (platform === "windows" && !on ? s.replaceAll("/", "\\") : s);
  return { full: win(full), relative: win(path) };
}

// Where a new file or folder goes: inside a folder, beside a file ("" is the root).
export function targetFolder(path, dir) {
  return dir ? path : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

// Why a new entry's name can't be used, or null.
export function checkName(name) {
  const n = name.trim();
  if (!n) return "Enter a name.";
  if (n === "." || n === "..") return "Not a valid name.";
  if (/[\\/]/.test(n)) return "A name, not a path.";
  return null;
}

// [program, args] that put text on this computer's clipboard, or null.
// exec has no stdin, so macOS pipes the argument into pbcopy through sh.
export function copyPlan(text, platform) {
  if (platform === "macos") return ["sh", ["-c", 'printf %s "$1" | pbcopy', "copy", text]];
  if (platform === "windows") return ["powershell", ["-NoProfile", "-Command", `Set-Clipboard -Value ${literal(text)}`]];
  return null;
}

// [program, args, options?] that show the entry selected in the file manager, or null.
// Explorer exits 1 even when it opens.
export function revealPlan(full, platform) {
  if (platform === "macos") return ["open", ["-R", full]];
  if (platform === "windows") return ["explorer.exe", [`/select,${full}`], { anyExit: true }];
  return null;
}

// [program, args] that create a file or folder, failing when it already exists.
// Through sh everywhere except Windows on this computer.
export function createPlan(kind, full, platform, on) {
  if (platform === "windows" && !on)
    return ["powershell", ["-NoProfile", "-Command", `New-Item -ItemType ${kind === "folder" ? "Directory" : "File"} -Path ${literal(full)} -ErrorAction Stop | Out-Null`]];
  return ["sh", ["-c", kind === "folder" ? 'mkdir -- "$1"' : 'set -C; : > "$1"', "new", full]];
}
