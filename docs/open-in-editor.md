# open-in-editor

Inspired by [CacaoRick/herdr-open-vscode](https://github.com/CacaoRick/herdr-open-vscode).

## Install

```sh
npx github:alvag/herdr-mods open-in-editor          # without cloning
npm run install-mod -- open-in-editor               # from a clone
```

Run it again to update; patches already applied are skipped.

## What it does

Right-click a space (or worktree) in the sidebar to get more rows:

- **Open in VS Code**
- **Open in WebStorm**
- **Open in Finder** (macOS) / **Open in Explorer** (Windows); no row on Linux

The folder is the git top level of where the space is now (its first terminal's live folder, else where it was made). Outside git, that folder itself.

A small dialog says `Opening in <Editor>…` and closes by itself. On failure it stays with the reason; Esc closes it.

## Wiring (`scripts/wire/open-in-editor.mjs`)

1. Clones Herdr's read-only `menu` and `spaces` mods as `my-menu` and `my-spaces`, and the `main` layout as `my-main`, if they don't exist yet.
2. Patches them: the rows in the space menu, the sidebar opening `my-menu` (taller popup), and `my-main` using `my-spaces`.
3. Switches to `my-main`; the installer then checks `my-menu` and `my-spaces` too.

`my-main` is shared with [`file-actions`](file-actions.md); each one patches only its own part.

If a Herdr update changes the anchors it patches, it stops and names the file.

## Other ways to start it

| From | How |
|---|---|
| A key | `"cmd-g": "mod.open:open-in-editor"` under `global` in `keys.json` (VS Code, focused terminal's folder) |
| A shell | `herdr-app do mod.open --name open-in-editor` |
| Your own mod | `openOverlay({ mod: "open-in-editor", kind: "dialog", width: 460, height: 112, props: { editor: "webstorm", space } })`; `editor` is `vscode`, `webstorm` or `finder` |

## How it launches

- macOS: `open -a "Visual Studio Code" <folder>` / `open -a WebStorm <folder>`, else the `code` / `webstorm` CLI.
- Linux: the `code` / `webstorm` CLI. Windows: `code.cmd` / `webstorm.cmd`, else without `.cmd`.
- File manager: `open <folder>` on macOS, `explorer.exe <folder>` on Windows (backslashes; its exit code is ignored, it returns 1 even when it opens).

## Limits

- Folders on this computer only. A space on another machine shows an error.
- The clones (`my-menu`, `my-spaces`, `my-main`) don't receive Herdr's updates. To go back: `ctrl-shift-l` or `herdr-app do layout.switch '{"name":"main"}'`.

## Uninstall

Point `my-main` back at Herdr's sidebar, then delete the mod and its clones:

```sh
H=~/.config/herdr-app
sed -i '' 's/"mod": "my-spaces"/"mod": "spaces"/' $H/layouts/my-main.json   # Linux: sed -i '…'
rm -rf $H/mods/{open-in-editor,my-menu,my-spaces}
```

If no other mod uses `my-main` ([`file-actions`](file-actions.md) does), also go back to `main` and delete it:

```sh
herdr-app do layout.switch '{"name":"main"}'
rm ~/.config/herdr-app/layouts/my-main.json
```
