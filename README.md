# Runtape CLI

> Flight recorder for AI coding agents. Replay every run, find every bug.

`runtape` is the open-source CLI for [Runtape](https://runtape.dev) — observability and replay for AI coding agents like Claude Code.

## Status

v0.2 — Adds model + token usage capture per turn and tool error surfacing.

## Install

```bash
npm install -g runtape
```

(Requires Node.js ≥ 20.)

## Get started

One command walks you through the whole setup:

```bash
runtape setup
```

It asks for your backend (defaults to `https://runtape.dev`), opens the dashboard so you can copy your API key, then installs the Claude Code hooks.

After setup, run Claude Code normally and your sessions stream to the dashboard.

```bash
runtape status       # buffer state, server reachability, flusher PID
runtape runs         # open your dashboard in the browser
runtape uninstall    # remove the hooks when you're done
```

If you prefer the granular commands instead of the wizard, `runtape login` and `runtape install` are still available — `setup` is just a convenience that chains them.

## How it works

`runtape install` adds entries to `~/.claude/settings.json` so that Claude Code fires `runtape push --event <HookName>` on every relevant hook event. When installed under any `node_modules` tree (npm-global, pnpm-workspace, etc.), the entry uses the bare command name `runtape` so it survives package upgrades; when run from source (e.g. `tsx bin/runtape.ts` during local development) it uses the absolute path from `process.argv[1]`. Override with the `RUNTAPE_CLI_BIN` env var if you need a specific path. Each invocation appends one validated JSON line to `~/.runtape/buffer/<session_id>.ndjson` (sub-10ms) and lazily spawns a detached flusher daemon. The daemon batches events (up to 100 per POST) and ships them to the backend with exponential backoff on transient failures. It exits after 30s of idle.

## State on disk

```
~/.runtape/
  config.json                  # api_key (chmod 600), server_url
  buffer/<session_id>.ndjson   # pending events
  seq/<session_id>             # monotonic sequence counter
  transcript/<session_id>      # uuids of assistant turns already emitted (v0.2+)
  flusher.pid                  # daemon PID
  flusher.log                  # daemon log (append-only)
```

Override the home dir with `RUNTAPE_HOME` (useful for tests). Override the server with `RUNTAPE_API_URL` or `runtape login --server-url <url>`.

## Subpath exports

Backend services that ingest Runtape events can import the shared Zod schemas:

```ts
import { RuntapeEvent, IngestionRequest } from "runtape/types";
```

The schemas live in `src/types.ts`. The package's `exports` map points TypeScript at the source file (no build step required for type consumers) and Node at the compiled `dist/types.js`.

## Changelog

### 0.2.0 — 2026-05-15

- **Model + token usage per turn.** The CLI now reads the Claude Code transcript JSONL on `PostToolUse` / `Stop` / `SubagentStop` and emits a new `assistant_turn` event for every assistant message, carrying `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, and `cache_creation_tokens`. The dashboard surfaces a per-turn model + cost pill and a run-level total.
- **Tool error surfacing.** `tool_call` events now carry `is_error` + `error_message` (derived from the tool response shape — Bash exits, Edit/Write rejections, `is_error` content blocks, interrupts). Errored tools are visible in the run timeline without expanding the step.
- **State.** Adds `~/.runtape/transcript/<session_id>` to track which assistant message uuids have already been emitted (idempotent scans across hook fires).

To upgrade:

```bash
npm install -g runtape@latest
runtape install   # safe to re-run; refreshes the hook entries
```

No changes to the existing hook commands or config file format.

### 0.1.x

Initial MVP. Hook-based capture of Claude Code sessions (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`), buffered to disk and flushed by a detached daemon.

## Open source

MIT licensed. Audit exactly what's captured. The Runtape backend (dashboard, ingestion API) is closed-source SaaS at [runtape.dev](https://runtape.dev).

## Repos

- This repo (`runtape`) — the open-source CLI
- `runtape-mcp` — MCP server for Runtape (planned)

## License

[MIT](./LICENSE)
