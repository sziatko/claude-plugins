# claude-plugins

Plugins for [Claude Code](https://claude.com/claude-code). This repository is a plugin
marketplace, which is a catalog: adding it installs nothing. Each plugin is installed on its
own, so you pick only the ones you want.

| Plugin | What it does |
| --- | --- |
| [context-meter](context-meter/) | A context-usage bar and session cost above the prompt; asks before a request re-sends a big context to an expired prompt cache (continue, copy a short handoff for a new session, or stop); can skip auto-compaction while uncommitted work is in progress. |

## Install

Install one plugin by its name. For example, at the prompt of a Claude Code session:

```
/plugin install context-meter --marketplace sziatko/claude-plugins
```

From a shell:

```
claude plugin install context-meter --marketplace sziatko/claude-plugins
```

The first install adds the marketplace, and the other plugins in it stay uninstalled. In the
desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** with
`sziatko/claude-plugins`, then **Add plugin** for the one you want.

Each plugin's folder has a README with its settings and how it works.

## License

[MIT](LICENSE)
