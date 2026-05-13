# Hindsight CLI

> Flight recorder for AI coding agents. Replay every run, find every bug.

`hindsight` is the open-source CLI for [Hindsight](https://hindsight.dev) — observability and replay for AI coding agents like Claude Code.

## Status

**Pre-release.** This repo is a placeholder. The CLI is in active development. Follow [@hindsight_dev](https://twitter.com/hindsight_dev) for launch.

## What it does (planned)

Installs lightweight hooks into Claude Code so every tool call, file edit, command, and error is captured and streamed to your Hindsight dashboard — with zero changes to your code.

```bash
npm install -g hindsight
hindsight login
hindsight install   # adds hooks to ~/.claude/settings.json
# now run Claude Code normally
```

Open your dashboard and watch your session replay in real time.

## Open source

The CLI is MIT licensed. You can audit exactly what's captured and what's sent. The Hindsight backend (dashboard, ingestion API) is a closed SaaS at [hindsight.dev](https://hindsight.dev).

## Repos

- This repo (`hindsight-cli`) — the open-source CLI
- `hindsight-mcp` — MCP server for Hindsight (coming v0.2)

## License

[MIT](./LICENSE)
