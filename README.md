# claude-plugins

Plugins for [Claude Code](https://claude.com/claude-code). This repository is a plugin
marketplace: add it once, then install any plugin listed here.

| Plugin | What it does |
| --- | --- |
| [context-meter](context-meter/) | A context-usage bar and session cost above the prompt; asks before a request re-sends a big context to an expired prompt cache (continue, copy a short handoff for a new session, or stop); can skip auto-compaction while uncommitted work is in progress. |

## Install

At the prompt of a Claude Code session:

```
/plugin install <plugin> --marketplace sziatko/claude-plugins
```

From a shell:

```
claude plugin install <plugin> --marketplace sziatko/claude-plugins
```

In the desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** with
`sziatko/claude-plugins`, then **Add plugin**.

Each plugin's folder has a README with its settings and how it works.

## License

[MIT](LICENSE)
