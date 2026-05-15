# Runtape CLI

> Flight recorder for AI coding agents. Replay every run, find every bug.

`runtape` is the open-source CLI for [Runtape](https://runtape.dev) — observability and replay for AI coding agents like Claude Code.

## Status

v0.1 — MVP. The CLI captures Claude Code sessions via hooks and streams them to a Runtape backend.

## Install

```bash
npm install -g runtape
```

(Requires Node.js ≥ 20.)

## Get started

```bash
runtape login        # paste the API key from your runtape.dev dashboard
runtape install      # add hooks to ~/.claude/settings.json
# …run Claude Code normally…
runtape runs         # open your dashboard in the browser
runtape status       # buffer state, server reachability, flusher PID
runtape uninstall    # remove the hooks when you're done
```

## How it works

`runtape install` adds entries to `~/.claude/settings.json` so that Claude Code fires `runtape push --event <HookName>` on every relevant hook event. When installed under any `node_modules` tree (npm-global, pnpm-workspace, etc.), the entry uses the bare command name `runtape` so it survives package upgrades; when run from source (e.g. `tsx bin/runtape.ts` during local development) it uses the absolute path from `process.argv[1]`. Override with the `RUNTAPE_CLI_BIN` env var if you need a specific path. Each invocation appends one validated JSON line to `~/.runtape/buffer/<session_id>.ndjson` (sub-10ms) and lazily spawns a detached flusher daemon. The daemon batches events (up to 100 per POST) and ships them to the backend with exponential backoff on transient failures. It exits after 30s of idle.

## State on disk

```
~/.runtape/
  config.json                 # api_key (chmod 600), server_url
  buffer/<session_id>.ndjson  # pending events
  seq/<session_id>            # monotonic sequence counter
  flusher.pid                 # daemon PID
  flusher.log                 # daemon log (append-only)
```

Override the home dir with `RUNTAPE_HOME` (useful for tests). Override the server with `RUNTAPE_API_URL` or `runtape login --server-url <url>`.

## Subpath exports

Backend services that ingest Runtape events can import the shared Zod schemas:

```ts
import { RuntapeEvent, IngestionRequest } from "runtape/types";
```

The schemas live in `src/types.ts`. The package's `exports` map points TypeScript at the source file (no build step required for type consumers) and Node at the compiled `dist/types.js`.

## Open source

MIT licensed. Audit exactly what's captured. The Runtape backend (dashboard, ingestion API) is closed-source SaaS at [runtape.dev](https://runtape.dev).

## Repos

- This repo (`runtape`) — the open-source CLI
- `runtape-mcp` — MCP server for Runtape (coming v0.2)

## License

[MIT](./LICENSE)
