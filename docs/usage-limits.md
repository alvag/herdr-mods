# usage-limits

Every Claude Code / Codex / OpenCode Go limit window in the status bar, and one
panel on hover: the details, and behind ⚙ the checkboxes to choose what shows.

Forked from [`nozikov/herdr-usage-limits`](https://github.com/nozikov/herdr-usage-limits)
(MIT, tree `f593713b83c5d1852733250d3f175721dd1ac6ec`). Upstream providers
(Claude, Codex) are unchanged; the fork adds the OpenCode Go provider.

The installer wires it into the `my-main` layout's status bar by itself
(`scripts/wire/usage-limits.mjs`): between `workspace-status` and the
`mods-updates` notifier, order-independent with that hook, and safe to rerun.

## OpenCode Go provider

Reads the OpenCode Go subscription meters — rolling 5-hour, weekly and monthly
usage — from `GET https://opencode.ai/zen/go/v1/usage`.

The key is the one the opencode CLI already stores; nothing is configured here:

- v2 CLI: the `opencode-go` row in `~/.local/share/opencode/opencode.db`
  (table `credential`, read-only).
- Older CLIs: the `opencode-go` or `opencode` entry in
  `~/.local/share/opencode/auth.json`.

The helper puts the key only in the `Authorization` header: it is never
printed, logged, or written anywhere. An expired key surfaces the API's own
message ("This API key has expired. Create a new API key in OpenCode
Console…"); renewing it is an opencode Console action, not a mod setting.

Overrides for testing: `HERDR_USAGE_OPENCODE_DB`, `HERDR_USAGE_OPENCODE_AUTH`,
`HERDR_USAGE_OPENCODE_URL`.

## Fetch timeout

Each provider helper is run with an explicit `exec` timeout of **30 s**. That is
above Herdr's default exec timeout and above the longest internal bound of the
helpers: OpenCode's helper uses `curl -m 20`, while Claude and Codex helpers
time out after 15 s (and Codex may then fall back to reading its session log
snapshot, which must not be cut short).

The mod races every exec against its own **25 s** safety net. The safety net
wins first, so the user always sees the mod's deterministic message (for
example `helpers/claude-usage.sh did not respond in 25s`) instead of text that
depends on the runtime or the app. If the exec itself has not resolved after
25 s, the mod stops waiting on its own, marks the provider as failing, and
clears the in-flight flag. The provider then retries on the normal cadence
(5 min for installed providers, 1 h for missing ones). The session path
(`hc get` and `helpers/session.sh`) is not affected by this change.

The timer is injected into the pure fetch helper (`lib/fetch.js`) from
`main.js` via `cx.timer.after`; the mod code never uses global `setTimeout`,
`setInterval`, `clearTimeout` or `clearInterval`, because those APIs are not
available in the mod runtime.

## Tests

```sh
cd mods/usage-limits && node --test test/*.test.js
```
