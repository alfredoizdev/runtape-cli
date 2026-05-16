import { readConfig, writeConfig, type Config, type WatchMode } from '../lib/config.js';
import { normalizePath } from '../lib/watch.js';

// Subcommand surface for the path-watcher feature. Mutates the CLI config's
// `watch` block; no server interaction. Every operation reads → mutates →
// writeConfig() — that re-applies chmod 600 so the credentials stay locked
// down even if the user touched the file manually between calls.

function modeLabel(mode: WatchMode): string {
  if (mode === 'allow_all') return 'allow_all (capturing every session)';
  if (mode === 'allow_list') return 'allow_list (capturing ONLY listed paths)';
  return 'deny_list (capturing every session EXCEPT listed paths)';
}

async function readOrExit(): Promise<Config> {
  const cfg = await readConfig();
  if (!cfg) {
    process.stderr.write('Not logged in. Run `runtape login` first.\n');
    process.exit(1);
  }
  return cfg;
}

function ensureWatch(cfg: Config): { mode: WatchMode; paths: string[] } {
  return cfg.watch
    ? { mode: cfg.watch.mode, paths: [...cfg.watch.paths] }
    : { mode: 'allow_all', paths: [] };
}

export async function watchListCommand(): Promise<number> {
  const cfg = await readOrExit();
  const w = ensureWatch(cfg);
  process.stdout.write(`Mode: ${modeLabel(w.mode)}\n`);
  if (w.paths.length === 0) {
    process.stdout.write('Paths: (none)\n');
  } else {
    process.stdout.write('Paths:\n');
    for (const p of w.paths) process.stdout.write(`  ${p}\n`);
  }
  process.stdout.write('\nEnv override: set RUNTAPE_DISABLE=1 to skip capture for a single session.\n');
  return 0;
}

export async function watchIgnoreCommand(path: string): Promise<number> {
  const cfg = await readOrExit();
  const w = ensureWatch(cfg);
  if (w.mode === 'allow_list') {
    process.stderr.write(
      "Current mode is allow_list (only listed paths are captured). `ignore` only makes sense in allow_all/deny_list mode.\nRun `runtape watch reset` to start over, or use `runtape watch only <path>` to add to the allow list.\n",
    );
    return 1;
  }
  const normalized = normalizePath(path);
  if (w.paths.includes(normalized)) {
    process.stdout.write(`Already ignored: ${normalized}\n`);
    return 0;
  }
  w.paths.push(normalized);
  // Auto-switch: first ignore on a fresh allow_all config flips us into deny_list.
  const next: WatchMode = w.mode === 'allow_all' ? 'deny_list' : w.mode;
  await writeConfig({ ...cfg, watch: { mode: next, paths: w.paths } });
  if (next !== w.mode) process.stdout.write(`Mode switched to deny_list.\n`);
  process.stdout.write(`Ignoring ${normalized}\n`);
  return 0;
}

export async function watchOnlyCommand(path: string): Promise<number> {
  const cfg = await readOrExit();
  const w = ensureWatch(cfg);
  if (w.mode === 'deny_list') {
    process.stderr.write(
      "Current mode is deny_list (all except listed paths). `only` would conflict.\nRun `runtape watch reset` to start over, then `runtape watch only <path>` to switch to allow_list.\n",
    );
    return 1;
  }
  const normalized = normalizePath(path);
  if (w.paths.includes(normalized)) {
    process.stdout.write(`Already in allow list: ${normalized}\n`);
    return 0;
  }
  w.paths.push(normalized);
  const next: WatchMode = w.mode === 'allow_all' ? 'allow_list' : w.mode;
  await writeConfig({ ...cfg, watch: { mode: next, paths: w.paths } });
  if (next !== w.mode) process.stdout.write(`Mode switched to allow_list.\n`);
  process.stdout.write(`Capturing only: ${normalized}\n`);
  return 0;
}

export async function watchUnignoreCommand(path: string): Promise<number> {
  const cfg = await readOrExit();
  const w = ensureWatch(cfg);
  const normalized = normalizePath(path);
  const filtered = w.paths.filter((p) => p !== normalized);
  if (filtered.length === w.paths.length) {
    process.stdout.write(`Not in the list: ${normalized}\n`);
    return 0;
  }
  await writeConfig({ ...cfg, watch: { mode: w.mode, paths: filtered } });
  process.stdout.write(`Removed: ${normalized}\n`);
  return 0;
}

export async function watchResetCommand(): Promise<number> {
  const cfg = await readOrExit();
  // We strip the watch key entirely rather than persist `{mode: allow_all, paths: []}`
  // so the config file goes back to its 0.5.x shape — useful for users who
  // downgrade or who inspect the file by hand.
  const { watch: _unused, ...rest } = cfg;
  await writeConfig(rest as Config);
  process.stdout.write('Reset to allow_all. All sessions will be captured.\n');
  return 0;
}
