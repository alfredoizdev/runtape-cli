# Hindsight CLI

> Flight recorder for AI coding agents. Replay every run, find every bug.

`hindsight` is the open-source CLI for [Hindsight](https://hindsight.dev) — observability and replay for AI coding agents like Claude Code.

## Status

v0.1 — MVP. The CLI captures Claude Code sessions via hooks and streams them to a Hindsight backend.

## Install

```bash
npm install -g hindsight
```

(Requires Node.js ≥ 20.)

## Get started

```bash
hindsight login        # paste the API key from your hindsight.dev dashboard
hindsight install      # add hooks to ~/.claude/settings.json
# …run Claude Code normally…
hindsight runs         # open your dashboard in the browser
hindsight status       # buffer state, server reachability, flusher PID
hindsight uninstall    # remove the hooks when you're done
```

## How it works

`hindsight install` adds entries to `~/.claude/settings.json` so that Claude Code fires `hindsight push --event <HookName>` on every relevant hook event. When installed via `npm install -g`, the entry uses the bare command name `hindsight` so it survives package upgrades; in a local-dev or pnpm-workspace context it uses the absolute path from `process.argv[1]`. Override with the `HINDSIGHT_CLI_BIN` env var if you need a specific path. Each invocation appends one validated JSON line to `~/.hindsight/buffer/<session_id>.ndjson` (sub-10ms) and lazily spawns a detached flusher daemon. The daemon batches events (up to 100 per POST) and ships them to the backend with exponential backoff on transient failures. It exits after 30s of idle.

## State on disk

```
~/.hindsight/
  config.json                 # api_key (chmod 600), server_url
  buffer/<session_id>.ndjson  # pending events
  seq/<session_id>            # monotonic sequence counter
  flusher.pid                 # daemon PID
  flusher.log                 # daemon log (append-only)
```

Override the home dir with `HINDSIGHT_HOME` (useful for tests). Override the server with `HINDSIGHT_API_URL` or `hindsight login --server-url <url>`.

## Subpath exports

Backend services that ingest Hindsight events can import the shared Zod schemas:

```ts
import { HindsightEvent, IngestionRequest } from 'hindsight/types';
```

The schemas live in `src/types.ts`. The package's `exports` map points TypeScript at the source file (no build step required for type consumers) and Node at the compiled `dist/types.js`.

## Open source

MIT licensed. Audit exactly what's captured. The Hindsight backend (dashboard, ingestion API) is closed-source SaaS at [hindsight.dev](https://hindsight.dev).

## Repos

- This repo (`hindsight-cli`) — the open-source CLI
- `hindsight-mcp` — MCP server for Hindsight (coming v0.2)

## License

[MIT](./LICENSE)
