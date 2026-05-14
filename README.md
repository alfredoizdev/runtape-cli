# Hindsight CLI

> Flight recorder for AI coding agents. Replay every run, find every bug.

`hindsight` is the open-source CLI for [Hindsight](https://hindsight.dev) — observability and replay for AI coding agents like Claude Code.

## Status

**Pre-release.** The CLI is in active development. Commands (`login`, `install`, `push`, `uninstall`, `status`, `runs`) land in v0.1. Today this package ships:

- The CLI binary scaffold (`hindsight --version`, `hindsight --help`).
- The Zod event schemas under the `hindsight/types` subpath export — consumed by the Hindsight backend for ingestion validation.

## What it will do (v0.1)

Installs lightweight hooks into Claude Code so every tool call, file edit, command, and error is captured and streamed to your Hindsight dashboard — with zero changes to your code.

```bash
npm install -g hindsight
hindsight login
hindsight install   # adds hooks to ~/.claude/settings.json
# now run Claude Code normally
```

Open your dashboard and watch your session replay in real time.

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
