import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';

// Returns an absolute path to the `hindsight` binary the user just invoked.
// This is what we write into `~/.claude/settings.json` so the hooks call the same install.
// Falls back to "hindsight" (on PATH) if we can't resolve it — useful when users want a
// non-pinned reference and have the CLI installed globally.
export function resolveCliBinPath(): string {
  if (process.env.HINDSIGHT_CLI_BIN) return process.env.HINDSIGHT_CLI_BIN;

  const argv1 = process.argv[1];
  if (argv1) {
    // If we live under a node_modules tree, the absolute path embeds the
    // package's extraction location, which changes on `npm install -g <newer>`.
    // Writing that path into ~/.claude/settings.json would break the hook on
    // the next upgrade. Fall back to the bare command name — `hindsight` is on
    // PATH after `npm install -g`, and a fresh install re-points the symlink.
    if (argv1.includes(`${sep}node_modules${sep}`)) return 'hindsight';
    try {
      return resolve(argv1);
    } catch {
      /* fall through */
    }
  }
  // Last resort: assume "hindsight" is on PATH.
  return 'hindsight';
}

// Exported for tests — turns a relative path into something we can stick in JSON.
export function moduleFileFromImportMeta(metaUrl: string): string {
  return fileURLToPath(metaUrl);
}

// Suppress unused-import warning for `dirname`.
void dirname;
