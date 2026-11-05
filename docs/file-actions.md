# file-actions

Right-click a file or folder in Herdr's Files panel for a small menu. Click a file to open it in its own tab, with the whole width to read it.

## Install

```sh
npx github:alvag/herdr-mods file-actions          # without cloning
npm run install-mod -- file-actions               # from a clone
```

Run it again to update; patches already applied are skipped.

## What it does

**Click a file** to read it in a tab, read-only, with syntax highlighting and line numbers and the whole width (the panel's own small preview is gone). Tabs work like an editor's preview:

| Action | Result |
|---|---|
| Click a file | Shows it in the space's preview tab, `◌ <name>`; makes one when there's none |
| Click another file | Shows it in that same preview tab |
| Click a file already open | Selects its tab, never a second one |
| Double-click a file | Pins its tab (`<name>`, no `◌`); the next file gets a new preview tab |

**Copy with context**: in a file tab, select text, press ⌘C, then ⌘⌥C (Windows: Ctrl+C, then Ctrl+Alt+C). Windows line endings are fine, and text holding ``` gets a longer fence. The clipboard becomes:

````
File: biome.json
Lines: 11-17

```json
"formatter": {
  …
},
```
````

Herdr's editor tells no selection, so it's two keys: ⌘C copies the text, ⌘⌥C finds it in the file for its lines and wraps it. The context shortcut reads and writes the system clipboard through Herdr's native API (`read_from_clipboard` / `write_to_clipboard`), without launching `pbpaste` / `pbcopy`. Text that's in the file more than once takes the first place (the notification says "first match"). Text not from the file (nothing copied first) gets a reminder instead. The tab's header shows the keys.

The `◌` stands for italics: Herdr's tab bar draws names as plain text, and italics would mean cloning it too. A tab reloads when its file changes on disk (on this computer); a file on another machine can't be watched, so its tab reloads when you come back to the Herdr window. While a file tab is focused, the Files panel keeps showing that file's folder. Which file each tab shows lives in `shared("file-actions.tabs")`; closed tabs are dropped from it on the next click.

**Right-click** a file or folder:

| Row | What it does |
|---|---|
| **Copy path** | The entry's full path, to the clipboard |
| **Copy relative path** | Its path relative to the panel's folder (the one shown in its header) |
| **Reveal in Finder** / **Reveal in Explorer** | Opens the file manager with the entry selected |
| **Open in VS Code** / **Open in WebStorm** | Opens the file inside its project's window (the panel's folder), or the folder as its own project |
| **Send to agent** | Puts `@<path> ` in the prompt of the space's agent, unsent, so you can keep typing |
| **New file…** / **New folder…** | Asks for a name and creates it inside the clicked folder, or beside the clicked file |
| **Move to Trash** / **Move to Recycle Bin** | Asks first, then moves the entry (a folder with everything in it) to the Trash or Recycle Bin, so it can be restored |

- Copying shows a `Copied` notification. Windows paths are copied with backslashes.
- A new entry never replaces an existing one: the dialog says `<name> already exists.` and stays open. Esc closes it. The panel shows the new entry by itself (it watches its folder; spaces on another machine refresh within 10 s).
- Names are one entry, not a path (`a/b` is refused).
- **Send to agent** picks the space's focused agent, else one in the active tab, else the one active last. The path is relative to the agent's folder when the entry is inside it, else full; quoted when it has spaces. Herdr can't type into a terminal without pressing Enter, so it goes through the clipboard: **it replaces what you had copied.** After pasting, the agent's terminal scrolls back to its live screen, so the prompt shows even if you had scrolled up through its history (`terminal.scroll`, Herdr 0.1.13 or later; on an earlier Herdr, or if the scroll fails, the path is still pasted and nothing is reported). No agent in the space: a notification says so. An agent waiting for an answer (a permission prompt) gets nothing pasted, since the text could answer it: the path stays on the clipboard.
- Deleting asks in a dialog (Enter confirms, Esc cancels). There is no permanent delete: where there's no Trash (Linux, a space on another machine) the row isn't shown.

| Platform | Copy, Send to agent | Reveal | Open in an editor | New file / folder | Delete |
|---|---|---|---|---|---|
| macOS | `pbcopy` | `open -R` | `open -a <app>`, else the `code` / `webstorm` CLI | `sh` | `trash -s` (macOS 15+), else Finder through `osascript` |
| Windows | `Set-Clipboard` | `explorer.exe /select,` (its exit code is ignored, it returns 1 even when it opens) | `code.cmd` / `webstorm.cmd`, else without `.cmd` | `New-Item` | `Microsoft.VisualBasic` `SendToRecycleBin` |
| Linux | no row | no row | the `code` / `webstorm` CLI | `sh` | no row |
| A space on another machine | to this computer's clipboard | no row | no row | `sh` on that machine | no row |

The editor table and launch order are copied from [`open-in-editor`](open-in-editor.md) (`mods/file-actions/actions.js`, `EDITORS`): a mod can't import from another mod's folder, so keep both in step.

On Windows, paths reach PowerShell as UTF-8 base64, never inside its source: PowerShell also ends strings at curly quotes, so quoting a file name isn't safe. On macOS before 15, the first delete asks once to let Herdr control Finder.

## File icons (optional)

The Files panel can show VS Code Material Icon Theme icons. Install [`file-icons`](https://herdr.dev/mods/cybertron288/file-icons) as its page says, then install `file-actions` again: with `~/.config/herdr-app/mods/file-icons/icons.js` present, the installer gives `my-files` the icon table and the matching code. The icons come from `mods/file-icons` (MIT, Material Icon Theme), which stays installed as the icon store; removing it blanks the icons, so reinstall it or clone `my-files` again. Without it the installer changes nothing and says so.

`file-icons` is an optional dependency this repo doesn't manage: the installer doesn't install it or pin its version. To get notified of its updates, track it after installing it: `npx github:alvag/herdr-mods track file-icons cybertron288/herdr-mods file-icons/mods/file-icons` ([`mods-updates`](mods-updates.md#other-peoples-mods)). `my-files` keeps the copy of its icon table made at install time, so **after updating `file-icons`, install `file-actions` again**; otherwise icons renamed in the new version show blank.

The matching (`scripts/wire/my-files-icon-match.js`) is ported from file-icons' `main.js`: a path rule beats a name, a name beats an extension, the longest extension wins, case-insensitive, light and open-folder variants.

## Wiring (`scripts/wire/file-actions.mjs`)

1. Clones Herdr's read-only `files` mod as `my-files`, and the `main` layout as `my-main`, if they don't exist yet.
2. Copies `mods/file-actions/actions.js` into `my-files/file-actions.js` and `mods/file-actions/panel.js` into `my-files/file-actions-panel.js` on every install. A mod can't import from another mod's folder; the clone uses them to size the popup, open files in tabs, and find a file tab's folder.
3. Patches `my-files`: each row opens `file-actions` as a popup on right-click; a click on a file calls `openFile()` (preview tab, pin, no duplicates); while a file tab is focused, `location()` returns that file's folder. An install from an earlier version, with one new tab per click, is moved over.
4. Only when `mods/file-icons/icons.js` exists: copies it into `my-files/file-icons-table.js`, with `my-files-icon-match.js` and `my-files-icons.js` from `scripts/wire/`, on every install, and patches each row to draw `image(icon(...))` instead of the plain folder/file SVG.
5. Points `my-main`'s Files panel at `my-files`, switches to `my-main`; the installer then checks `my-files` too.

`my-main` is shared with [`open-in-editor`](open-in-editor.md); each one patches only its own part.

If a Herdr update changes the anchors it patches, it stops and names the file.

## File notes data model (MVP foundation)

> **Not usable yet.** Only the model in `mods/file-actions/notes.js` exists. There is no Add note dialog, panel or send to agent; those come in later steps. Copy with context is unchanged.

Notes are kept in `shared("file-actions.notes")` (exported as `NOTES`) as `{ next, notes }`. Each note has an `id` (`n1`, `n2`, ... never reused), the file (`on`, `root`, `view`: machine, panel root and relative path, with no machine stored as `null`), the original range, the copied `excerpt` (LF line endings) and the user's `note`. Notes belong to the file, not to a tab, and a file on another machine or under another root has its own notes.

- **Matching:** `sourceOf(fileText, copied)` finds the copied text in the file like copy with context does (CRLF and one final newline ignored), but it throws when the text is empty, missing, or appears more than once, instead of taking the first place. The range is `first`..`last` lines plus `column`, the offset in the first line, so a selection that starts mid-line is kept exactly.
- **Stale notes:** `isCurrent(fileText, note)` is true only while the excerpt is still at exactly that range. After an edit it is false; nothing moves the note to where the text went.
- **Operations:** `addNote`, `updateNote`, `removeNote` and `notesOf` take the stored state and return a new one (the input is never changed); the caller saves it with `setShared`. Notes keep the order they were added. Note text is trimmed and can't be empty.
- **Corrupted state:** every operation validates the stored state first and throws `Saved notes are invalid: ...` (bad format, repeated or malformed id, empty note, range not matching the excerpt). Nothing is dropped or repaired, so a caller can't overwrite notes it couldn't read. Missing state means no notes. There is no limit on the number of notes and no migration of older data.

## Limits

- Installing again (or updating) reloads the mod: Herdr closes the file tabs that were open.
- Right-click on a row only, not on the panel's empty space. To create at the top level, right-click a top-level file.
- Send to agent: a path with spaces is sent as `@"a b/c"`; not checked against each agent, and a path with both spaces and `"` comes out wrongly quoted. Outside the agent's folder (or with a different case or separator) the path is full instead of relative.
- Copy and reveal need macOS or Windows. Only macOS is tested on a real Herdr.

## Maintenance: `my-files` doesn't receive Herdr's updates

> **Known restriction.** `my-files` is a frozen copy of Herdr's `files` mod as it was when it was cloned. When Herdr ships a new version of the Files panel (fixes, new features), `my-files` keeps the old code. The files it shows are always current; its code is not.
>
> So this mod depends on checking, from time to time and after each Herdr update, whether `files` changed, and if it did, cloning it again.

Check after updating Herdr:

```sh
H=~/.config/herdr-app
herdr-app --version                          # the running version
grep -A3 cloned_from $H/mods/my-files/mod.json   # the version my-files was cloned from
diff $H/mods/files/main.js $H/mods/my-files/main.js
```

The `diff` should show only this mod's patches: the `openOverlay` / `run` / `menuHeight` / `openFile, viewerLocation` imports, `lastLocation` and `viewerLocation` in `location()`, the row's `.on_click` (`openFile`) and `.on_mouse_down("right", …)`, and the `image` / `icon` imports and the row's icon line (with file-icons), and the icon paths Herdr rewrites to `mods/my-files/` when it clones. Anything else means Herdr changed the Files panel. Then clone it again:

```sh
rm -rf ~/.config/herdr-app/mods/my-files
npx github:alvag/herdr-mods file-actions
```

The installer clones the new `files` and patches it again. If it stops with `anchor not found`, Herdr changed the lines it patches: update `scripts/wire/file-actions.mjs` to the new code.

## Uninstall

Point `my-main` back at Herdr's Files panel, then delete the mod and its clone:

```sh
H=~/.config/herdr-app
sed -i '' 's/"mod": "my-files"/"mod": "files"/' $H/layouts/my-main.json   # Linux: sed -i '…'
rm -rf $H/mods/{file-actions,my-files}
```

If no other mod uses `my-main` (`open-in-editor` does), also go back to `main` and delete it:

```sh
herdr-app do layout.switch '{"name":"main"}'
rm ~/.config/herdr-app/layouts/my-main.json
```
