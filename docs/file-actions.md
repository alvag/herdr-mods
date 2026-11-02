# file-actions

Right-click a file or folder in Herdr's Files panel for a small menu.

## Install

```sh
npx github:alvag/herdr-mods file-actions          # without cloning
npm run install-mod -- file-actions               # from a clone
```

Run it again to update; patches already applied are skipped.

## What it does

| Row | What it does |
|---|---|
| **Copy path** | The entry's full path, to the clipboard |
| **Copy relative path** | Its path relative to the panel's folder (the one shown in its header) |
| **Reveal in Finder** / **Reveal in Explorer** | Opens the file manager with the entry selected |
| **New file…** / **New folder…** | Asks for a name and creates it inside the clicked folder, or beside the clicked file |

- Copying shows a `Copied` notification. Windows paths are copied with backslashes.
- A new entry never replaces an existing one: the dialog shows the reason and stays open. Esc closes it. The panel shows the new entry by itself (it watches its folder; spaces on another machine refresh within 10 s).
- Names are one entry, not a path (`a/b` is refused).

| Platform | Copy | Reveal | New file / folder |
|---|---|---|---|
| macOS | `pbcopy` | `open -R` | `sh` |
| Windows | `Set-Clipboard` | `explorer.exe /select,` (its exit code is ignored, it returns 1 even when it opens) | `New-Item` |
| Linux | no row | no row | `sh` |
| A space on another machine | to this computer's clipboard | no row | `sh` on that machine |

## Wiring (`scripts/wire/file-actions.mjs`)

1. Clones Herdr's read-only `files` mod as `my-files`, and the `main` layout as `my-main`, if they don't exist yet.
2. Copies `mods/file-actions/actions.js` into `my-files/file-actions.js` on every install. A mod can't import from another mod's folder; the clone uses it to size the popup.
3. Patches `my-files`: each row opens `file-actions` as a popup on right-click.
4. Points `my-main`'s Files panel at `my-files`, switches to `my-main`; the installer then checks `my-files` too.

`my-main` is shared with [`open-in-editor`](open-in-editor.md); each one patches only its own part.

If a Herdr update changes the anchors it patches, it stops and names the file.

## Limits

- Right-click on a row only, not on the panel's empty space. To create at the top level, right-click a top-level file.
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

The `diff` should show only this mod's two patches: the `openOverlay` / `menuHeight` imports, and the `.on_mouse_down("right", …)` line. Anything else means Herdr changed the Files panel. Then clone it again:

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
