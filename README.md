# herdr-mods

Personal [Herdr](https://herdr.dev) mods, each installed on its own so every computer gets only the ones it wants.

| Mod | What it does |
|---|---|
| `open-in-editor` | Opens a space's folder in VS Code, WebStorm or Finder/Explorer, from the space right-click menu |

## Install

Without cloning (needs Node and `herdr-app` on the `PATH`):

```sh
npx github:alvag/herdr-mods                  # every mod
npx github:alvag/herdr-mods open-in-editor   # only the named ones
```

From a clone:

```sh
npm test                                # unit tests
npm run install-mod                     # every mod in mods/
npm run install-mod -- open-in-editor   # only the named ones
```

An unknown name stops before copying anything and lists the available mods.

Herdr loads every folder in `~/.config/herdr-app/mods/`; there is no on/off switch, so choosing happens here. `HERDR_APP_HOME` picks another home.

## Layout

```
mods/<name>/             copied as-is to ~/.config/herdr-app/mods/<name>/
scripts/wire/<name>.mjs  optional: what the mod needs beyond its folder
scripts/install.mjs      copies the selected mods, runs their hooks, checks them
```

A hook default-exports `wire({ home, herdr, patch })` and returns `{ checks, note }`: extra mod folders to `herdr-app check`, and a line to print. It runs only when its mod is installed. `patch(file, marker, from, to)` replaces once and skips when `marker` is already there, so installing again is safe.

To remove a mod from a computer, delete its folder from `~/.config/herdr-app/mods/` (plus whatever its hook created).

---

## open-in-editor

Inspired by [CacaoRick/herdr-open-vscode](https://github.com/CacaoRick/herdr-open-vscode).

### Install

```sh
npx github:alvag/herdr-mods open-in-editor
```

Run it again to update; patches already applied are skipped.

### What it does

Right-click a space (or worktree) in the sidebar to get more rows:

- **Open in VS Code**
- **Open in WebStorm**
- **Open in Finder** (macOS) / **Open in Explorer** (Windows); no row on Linux

The folder is the git top level of where the space is now (its first terminal's live folder, else where it was made). Outside git, that folder itself.

A small dialog says `Opening in <Editor>…` and closes by itself. On failure it stays with the reason; Esc closes it.

### Wiring (`scripts/wire/open-in-editor.mjs`)

1. Clones Herdr's read-only `menu` and `spaces` mods as `my-menu` and `my-spaces`, and the `main` layout as `my-main`, if they don't exist yet.
2. Patches them: the rows in the space menu, the sidebar opening `my-menu` (taller popup), and `my-main` using `my-spaces`.
3. Switches to `my-main`; the installer then checks `my-menu` and `my-spaces` too.

If a Herdr update changes the anchors it patches, it stops and names the file.

### Other ways to start it

| From | How |
|---|---|
| A key | `"cmd-g": "mod.open:open-in-editor"` under `global` in `keys.json` (VS Code, focused terminal's folder) |
| A shell | `herdr-app do mod.open --name open-in-editor` |
| Your own mod | `openOverlay({ mod: "open-in-editor", kind: "dialog", width: 460, height: 112, props: { editor: "webstorm", space } })`; `editor` is `vscode`, `webstorm` or `finder` |

### How it launches

- macOS: `open -a "Visual Studio Code" <folder>` / `open -a WebStorm <folder>`, else the `code` / `webstorm` CLI.
- Linux: the `code` / `webstorm` CLI. Windows: `code.cmd` / `webstorm.cmd`, else without `.cmd`.
- File manager: `open <folder>` on macOS, `explorer.exe <folder>` on Windows (backslashes; its exit code is ignored, it returns 1 even when it opens).

### Limits

- Folders on this computer only. A space on another machine shows an error.
- The clones (`my-menu`, `my-spaces`, `my-main`) don't receive Herdr's updates. To go back: `ctrl-shift-l` or `herdr-app do layout.switch '{"name":"main"}'`.

### Uninstall

```sh
herdr-app do layout.switch '{"name":"main"}'
rm -rf ~/.config/herdr-app/mods/{open-in-editor,my-menu,my-spaces} ~/.config/herdr-app/layouts/my-main.json
```
