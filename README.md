# herdr-mods

Personal [Herdr](https://herdr.dev) mods, each installed on its own so every computer gets only the ones it wants.

| Mod | What it does |
|---|---|
| [`open-in-editor`](docs/open-in-editor.md) | Opens a space's folder in VS Code, WebStorm or Finder/Explorer, from the space right-click menu |
| [`file-actions`](docs/file-actions.md) | Click a file in the Files panel to read it in a tab (preview tab, double-click pins; ⌘C then ⌘⌥C copies with file and lines); right-click a file or folder: copy its path, reveal it, open it in an editor, send it to an agent, create a file or folder, move it to the Trash |

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

## Update

Run the same install command again. There is no separate update step: the mods are copied again and patches already applied are skipped.

```sh
npx github:alvag/herdr-mods file-actions                 # gets main's latest commit each time
git pull && npm run install-mod -- file-actions          # from a clone
```

- `npx` checks GitHub on every run, so it installs `main`'s latest commit even with an older copy in its cache. To install a given version, add its commit: `npx github:alvag/herdr-mods#5241310 file-actions`.
- Installing again reloads the mod: Herdr closes the tabs it had open (such as `file-actions`' file tabs).
- Clones of Herdr's own mods and layouts (`my-files`, `my-main`, `my-menu`, `my-spaces`) are made only when missing, so updating keeps them as they are and they don't get Herdr's updates. To take a newer Herdr version of one, move the clone out of `~/.config/herdr-app/` and install again; each mod's page in [`docs/`](docs/) says when and how.

Herdr loads every folder in `~/.config/herdr-app/mods/`; there is no on/off switch, so choosing happens here. `HERDR_APP_HOME` picks another home.

## Layout

```
mods/<name>/             copied as-is to ~/.config/herdr-app/mods/<name>/
scripts/wire/<name>.mjs  optional: what the mod needs beyond its folder
scripts/install.mjs      copies the selected mods, runs their hooks, checks them
```

A hook default-exports `wire({ home, herdr, patch })` and returns `{ checks, note }`: extra mod folders to `herdr-app check`, and a line to print. It runs only when its mod is installed. `patch(file, marker, from, to)` replaces once and skips when `marker` is already there, so installing again is safe.

Each mod's page in [`docs/`](docs/) says how to install and uninstall it on its own, and what its hook creates.
