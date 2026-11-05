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

## Tests

```sh
cd mods/usage-limits && node --test test/*.test.js
```
