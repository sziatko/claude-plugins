# context-meter

A Claude Code plugin that keeps an eye on the two things a long session quietly spends:
**context** and **prompt cache**.

- **A usage bar above the prompt.** `▰▰▰▰▰▱▱▱▱▱ 52% · 156k / 300k · $4.17` shows how full the
  context is, measured against the point where auto-compaction starts, and what the session has
  cost so far. It is green, then yellow, then red.
- **A question before a cold-cache request.** After a long break the prompt cache has expired.
  The next request re-writes the whole context to the cache at 1.25× or 2× the input price,
  where a warm cache would have cost 0.1×. With a 300k context that difference is real money.
  Before sending such a request the plugin asks what to do: **continue here**, **copy a handoff
  for a new session**, or **stop**.
- **An optional compaction guard.** While `git status` shows uncommitted changes, an
  auto-compaction is skipped, so a summary does not cut a half-done step in two. After a
  compaction Claude gets a short note telling it to re-read the task before going on.

Every part is configurable, and each one can be turned off.

<!-- Screenshots: docs/images/band.png (the bar above the prompt), docs/images/cold-cache.png (the question) -->

## Install

At the prompt of a Claude Code session:

```
/plugin install context-meter --marketplace sziatko/claude-plugins
```

From a shell:

```
claude plugin install context-meter --marketplace sziatko/claude-plugins
```

In the desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** with
`sziatko/claude-plugins`, then **Add plugin**.

You need a Claude Code build that loads plugin hooks modules (tested on 2.1.319) and Node.js on
`PATH`. The cold-cache check reads the session transcript with a small Node script.

## Where the bar shows

| Surface | Bar above the prompt | Bar inside an open question |
| --- | --- | --- |
| VS Code extension | yes | yes (the panel hides the bar while a question is open) |
| Desktop app | yes | no |
| Terminal | off by default, `show_in_terminal` turns it on | no |

The terminal is opt-in because most people already have a status line there with the same
figures.

## Settings

Change them in `/config` (each one is a row under **context-meter**), or in `settings.json`
under `pluginConfigs["context-meter"].options`.

### The bar

| Setting | Default | What it does |
| --- | --- | --- |
| `bar_scale` | `auto-compact` | `auto-compact` measures against `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when it is set, and against the model's window when it is not. `window` always measures against the model's whole window (for example 1M). |
| `warn_percent` | `70` | The bar turns yellow at this fill. |
| `alert_percent` | `90` | The bar turns red at this fill. |
| `show_cost` | `true` | Ends the line with the session's estimated cost in USD. |
| `show_in_terminal` | `false` | Also draws the bar in a terminal session. |

The percentage can go past 100% when the compaction guard skips a compaction. The bar then
stays full and the number shows how far past the limit you are.

### The cold-cache question

| Setting | Default | What it does |
| --- | --- | --- |
| `cold_cache_check` | `true` | Turns the question on or off. |
| `cold_cache_min_tokens` | `100000` | A smaller context is re-sent without asking. |
| `handoff_quote_chars` | `2000` | How much of your last request and of Claude's last message goes into the handoff. |
| `handoff_steps` | *"First run git status and git diff --stat…"* | The last paragraph of the handoff: what the new session should do first. Leave it empty for nothing. |
| `language` | `en` | `en` or `uk`. The language of the question, the buttons, the notices and the handoff. |

**How it decides.** Each model request in the main conversation passes through the check.
Subagents are skipped because they keep caches of their own. The plugin reads the last API
call in the transcript: its context size, when it ended, and the cache TTL it wrote (5 minutes
or 1 hour). It asks only when all of these are true:

- the context is at least `cold_cache_min_tokens`;
- the idle time is longer than the TTL;
- no compaction happened since that call;
- the session has someone to ask (a `claude -p` run is never stopped).

A request made less than 5 minutes after the previous one is not checked at all.

**The three answers:**

- **Continue here.** The request goes out as usual.
- **Copy for a new session.** A handoff goes to the clipboard and the turn stops. The handoff
  holds the session id, the transcript path (with advice not to read it whole), the last
  compaction summary, your last request, Claude's last message, the files edited in the
  session, the subagents still running, and then `handoff_steps`. Paste it into a fresh
  session, which starts with an empty cache that costs far less to fill.
- **Stop.** Nothing is sent and the turn ends. Closing the question does the same.

### Compaction

| Setting | Default | What it does |
| --- | --- | --- |
| `compact_guard` | `false` | Skips an *auto*-compaction while `git status --porcelain` lists changes. A `/compact` you type yourself always runs. Outside a git repository nothing is skipped. |
| `compact_guard_max_percent` | `60` | Past this share of the model's window an auto-compaction always runs. The engine also auto-compacts when a prompt no longer fits, and skipping that one would fail the request. |
| `after_compact_note` | *"The context was just compacted. Before continuing, re-read the task…"* | Given to Claude right after any compaction. Leave it empty for nothing. |

The guard is most useful together with a lowered `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, for example
300k on a 1M model. Auto-compaction then starts well below the ceiling, and a skipped one leaves
room to finish the step and commit.

### Example: a project that works in phases

```json
{
  "pluginConfigs": {
    "context-meter": {
      "options": {
        "bar_scale": "auto-compact",
        "compact_guard": true,
        "handoff_steps": "First: git status, git diff --stat and the first unchecked step in docs/phases/phase-N.md. Then continue my last request.",
        "after_compact_note": "The context was just compacted. Re-read the first unchecked step in docs/phases/phase-N.md and run git diff --stat before continuing."
      }
    }
  }
}
```

## How it is built

```
.claude-plugin/marketplace.json   the marketplace this repository is
context-meter/
  .claude-plugin/plugin.json      manifest and the userConfig settings
  hooks/register.tsx              the bar; wires the other parts
  hooks/settings.ts               options parsed once into typed settings
  hooks/cold-cache.ts             the question before a cold-cache request, the handoff
  hooks/compact.ts                the compaction guard and the note after a compaction
  hooks/text.ts                   every string, in English and Ukrainian
  scripts/meter.js                transcript reader (Node: hooks modules read no file over 4 MiB)
  types/index.d.ts                the session state the plugin keeps
```

The plugin is a single hooks module. It uses `ui.render` for the bar, `turn.step` to hold a
request, `session.compact` for the guard, and `classic.SessionStart` for the note.

## Development

```
claude plugin validate context-meter
claude plugin test context-meter       # hooks module tests: bar, settings, cold cache, compaction
node context-meter/scripts/meter.test.js
```

To try local changes, start a session with `claude --plugin-dir ./context-meter`.

## License

[MIT](LICENSE)
