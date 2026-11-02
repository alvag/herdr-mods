# herdr-mods

Personal [Herdr](https://herdr.dev) mods, each installed on its own so every computer gets only the ones it wants.

| Mod | What it does |
|---|---|
| [`open-in-editor`](docs/open-in-editor.md) | Opens a space's folder in VS Code, WebStorm or Finder/Explorer, from the space right-click menu |
| [`file-actions`](docs/file-actions.md) | Right-click a file or folder in the Files panel: copy its path, reveal it, create a file or folder, move it to the Trash |

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

Each mod's page in [`docs/`](docs/) says how to install and uninstall it on its own, and what its hook creates.
