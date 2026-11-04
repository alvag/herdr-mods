# mods-updates

A small block at the right of Herdr's status bar that says when `herdr-mods` has a newer version than the one installed here. It works for any mod from this repo.

## Install

It is installed with every other mod; there is nothing to choose. To install only it:

```sh
npx github:alvag/herdr-mods mods-updates          # without cloning
npm run install-mod -- mods-updates               # from a clone
```

## What it does

- Reserves 110 px at the right of the status bar of `my-main`. While nothing is behind it shows a dim check and **up to date**, once a check has answered; before any answer (never checked, or offline since install) it stays empty. "Up to date" is as of the last check that answered.
- Compares the installed commit with GitHub's `main` when Herdr starts, right after each install or update, and once a day. When `main` is ahead, the block shows **herdr-mods ↑** and one notification appears per new commit (restarts don't repeat it).
- Clicking the block or the notification opens a tab, `Update herdr-mods`, that runs the update for the mods installed here:
  - installed with `npx`: `npx --yes github:alvag/herdr-mods <mods>`
  - installed from a clone: `git pull --ff-only && npm run install-mod -- <mods>`, in that clone
- Any failure (no `git`, offline, no mods recorded) stays silent: the block keeps what the last answer said, or shows nothing if there was none. When nothing answered (offline), it tries again in an hour instead of a day. `git` and `curl` give up on a request stalled for 30 s.

Which mods (each with the commit it was installed at) and how they were installed is recorded by the installer in `~/.config/herdr-app/mods/mods-updates/version.js` (never in the repo). Installing again updates only the commits of the mods just installed and keeps the others, so the block shows while any recorded mod is behind. Mods installed before the notifier have no known commit and show as an update once. The last answer from GitHub is in `shared("herdr-mods.updates")`.

## Other people's mods

It can also tell you when a mod from someone else's repo changed. It only **notifies**: it never updates them. Herdr's guide says to read every file of a third-party mod, and check its network and exec use, before adding it; an update button would skip that review.

```sh
npx github:alvag/herdr-mods track <name> <owner/repo> <path in that repo>
npx github:alvag/herdr-mods untrack <name>
```

`track` records the git tree sha of that folder on GitHub (so run it right after installing or updating the mod) in `~/.config/herdr-app/herdr-mods.external.json`, and refreshes `version.js` (`external`) without installing anything else. `untrack` removes it. Example:

```sh
npx github:alvag/herdr-mods track file-icons cybertron288/herdr-mods file-icons/mods/file-icons
```

- Once a day, in the same check, one unauthenticated `curl` to `https://api.github.com/repos/<owner/repo>/contents/<parent folder>?ref=HEAD` per tracked mod (`curl.exe` on Windows). A failure for one stays silent and doesn't block the others.
- A tracked mod is outdated when GitHub's tree sha is known and differs from the recorded one. One notification per new sha: "<name> has an update", with the track command to run after updating. For `file-icons` it adds "and install file-actions again", since `my-files` keeps a copy of its icons (`DEPENDENTS` in `check.js`).
- The block shows `<name> ↑` for one external mod only, `herdr-mods ↑` for herdr-mods only, and `<n> updates ↑` for several (herdr-mods counted). A click opens each outdated mod's folder (`https://github.com/<repo>/tree/HEAD/<path>`) in the browser (`open`, `xdg-open`, `explorer.exe`) and, if herdr-mods is outdated, also opens the update tab.
- To update one: review the new code, update it as its page says, then run the `track` command again. To stop, run `untrack`.

## Privacy

One `git ls-remote https://github.com/alvag/herdr-mods.git refs/heads/main` per day, from this computer to GitHub, plus one GitHub API request per tracked mod of someone else's. Nothing is sent but what those requests themselves carry.

## Wiring (`scripts/wire/mods-updates.mjs`)

Clones the `main` layout as `my-main` if it doesn't exist yet, and turns its `status` block into a row (28 px): `status-main` (Herdr's `workspace-status`, flexible) and `status-updates` (`mods-updates`, 110 px). Running it again changes nothing. If Herdr moves or renames the `status` block, it stops and names the file.

`my-main` is shared with [`open-in-editor`](open-in-editor.md) and [`file-actions`](file-actions.md); each one patches only its own part.

## Limits

- Needs `git` on the `PATH`, and the mod's copy keeps running while `my-main` is shown (a check every 24 h).
- The notifier compares commits: any new commit on `main` counts, even one that touches mods you don't have.
- Updating from a clone fails when the clone has local changes that don't fast-forward; the tab shows git's message.

## Uninstall

Put the status block back and delete the mod:

```sh
H=~/.config/herdr-app
node -e '
const f = process.argv[1], l = JSON.parse(fs.readFileSync(f, "utf8"));
const walk = (n) => { (n.children ?? []).forEach((c, i) => { if (c.id === "status" && c.type === "row") { const m = { ...c.children[0], id: "status", size: c.size }; n.children[i] = m; } else walk(c); }); };
walk(l); fs.writeFileSync(f, JSON.stringify(l, null, 2) + "\n");' $H/layouts/my-main.json
rm -rf $H/mods/mods-updates
```

Installing any mod again brings it back, since the notifier is always installed.
