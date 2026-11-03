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

// Rows in groups, a separator between groups. `copy`, `reveal` and `send-agent`
// need this computer's clipboard or file manager; the editors and `reveal` need
// the entry on this computer; deleting only where it can be undone (this
// computer's Trash or Recycle Bin).
export function menuItems(platform, on) {
  const desk = DESKTOP.includes(platform), here = !on;
  const groups = [
    [
      ...(desk ? [{ id: "copy", label: "Copy path", icon: "files" }, { id: "copy-relative", label: "Copy relative path", icon: "file-text" }] : []),
      ...(desk && here ? [{ id: "reveal", label: `Reveal in ${platform === "windows" ? "Explorer" : "Finder"}`, icon: "folder" }] : []),
    ],
    [
      ...(here ? [{ id: "open-vscode", label: "Open in VS Code", icon: "panel-right" }, { id: "open-webstorm", label: "Open in WebStorm", icon: "panel-right" }] : []),
      ...(desk ? [{ id: "send-agent", label: "Send to agent", icon: "terminal" }] : []),
    ],
    [{ id: "new-file", label: "New file…", icon: "plus" }, { id: "new-folder", label: "New folder…", icon: "folder-plus" }],
    desk && here ? [{ id: "delete", label: platform === "windows" ? "Move to Recycle Bin" : "Move to Trash", icon: "x" }] : [],
  ].filter((g) => g.length);
  return groups.flatMap((g, i) => g.map((it, j) => (i > 0 && j === 0 ? { ...it, separated: true } : it)));
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

// What the dialog says when creating fails: the name when it already exists
// (sh, mkdir and New-Item each word it differently), else the program's error.
export function createError(message, name) {
  return /already exists|existing file|File exists/i.test(message) ? `${name} already exists.` : message;
}

// [program, args] that put text on this computer's clipboard, or null.
// exec has no stdin, so macOS pipes the argument into pbcopy through sh. pbcopy
// reads it in LANG's encoding, unset when Herdr runs it: without UTF-8 "año"
// would be copied as "a√±o".
export function copyPlan(text, platform) {
  if (platform === "macos") return ["sh", ["-c", 'printf %s "$1" | LANG=en_US.UTF-8 pbcopy', "copy", text]];
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

// The commands to try in order, each [program, args], that move an entry to the
// Trash or Recycle Bin; empty where there is none. macOS 15+ ships `trash`;
// older ones go through Finder.
export function deletePlan(full, platform) {
  if (platform === "macos") return [
    ["trash", ["-s", full]],
    ["osascript", ["-e", "on run argv", "-e", 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', "-e", "end run", full]],
  ];
  if (platform === "windows") return [["powershell", ["-NoProfile", "-Command",
    `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; $p = ${literal(full)}; $fs = [Microsoft.VisualBasic.FileIO.FileSystem]; ` +
    `if (Test-Path -LiteralPath $p -PathType Container) { $fs::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { $fs::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }`]]];
  return [];
}

// Editors a file opens in; the same table and launch order as open-in-editor
// (a mod can't import from another mod's folder).
const EDITORS = {
  vscode: { app: "Visual Studio Code", cli: "code" },
  webstorm: { app: "WebStorm", cli: "webstorm" },
};

// The commands to try in order, each [program, args], that open an entry in an
// editor. A file goes with its project's folder (`root`), so it opens in that
// project's window instead of whichever one was last used; a folder (root null)
// opens alone, as its own project.
export function openPlan(editor, full, platform, root) {
  const e = EDITORS[editor] ?? EDITORS.vscode;
  const paths = root ? [root, full] : [full];
  if (platform === "macos") return [["open", ["-a", e.app, ...paths]], [e.cli, paths]];
  if (platform === "windows") return [[`${e.cli}.cmd`, paths], [e.cli, paths]];
  return [[e.cli, paths]];
}

// How an agent's prompt names the entry: `@` and its path relative to the agent's
// folder when inside it, else the full path; quoted when it has spaces. Ends with a
// space so the person can keep typing.
export function mentionOf(full, cwd) {
  const base = cwd?.replace(/[\\/]+$/, "");
  const sep = full.includes("\\") ? "\\" : "/";
  const path = base && full.startsWith(base + sep) ? full.slice(base.length + 1) : full;
  return `@${path.includes(" ") ? `"${path}"` : path} `;
}

// The agent a path goes to, from agents() for a space: its focused agent, else
// one in the active tab, else the one that changed last; null when it has none.
export function pickAgent(agents, space, tab) {
  const mine = agents.filter((a) => a.space === space);
  return mine.find((a) => a.focused) ?? mine.find((a) => a.tab === tab)
    ?? mine.reduce((best, a) => (!best || a.seq > best.seq ? a : best), null);
}

// Why the path can't be pasted into this agent, or null. A blocked agent shows a
// dialog (a permission prompt) that the pasted text could answer; hc send
// refuses it too.
export function pasteBlocker(agent) {
  if (!agent) return "No agent in this space";
  if (agent.status === "blocked") return `${agent.address} is waiting for an answer`;
  return null;
}

// The viewer tab shows a file the way the Files panel previewed it (same
// language map, size cap and messages; copied from Herdr's files mod).
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const MAX_TEXT = 400000;

// The editor language for a path, from its extension ("txt" without one).
export function languageOf(path) {
  const name = path.split("/").pop();
  const ext = name.includes(".") ? name.split(".").pop() : "txt";
  return LANG[ext] ?? ext;
}

// What the viewer shows for a file's text (null: it's gone): { value } or { error }.
export function previewOf(text) {
  if (text === null) return { error: "This file is no longer available" };
  if (text.includes("\0")) return { error: "Binary file · no text preview" };
  return { value: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n… (file truncated)" : text };
}
