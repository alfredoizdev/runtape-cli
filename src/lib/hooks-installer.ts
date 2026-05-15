import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './paths.js';
import { SUPPORTED_HOOKS } from './hook-mapping.js';

const RUNTAPE_MARKER = 'runtape:managed';

type HookEntry = { type: 'command'; command: string; [k: string]: unknown };
type HookMatcher = { matcher: string; hooks: HookEntry[]; [k: string]: unknown };
type HooksBlock = Record<string, HookMatcher[]>;
type ClaudeSettings = { hooks?: HooksBlock; [k: string]: unknown };

function runtapeEntry(hookName: string, cliBinPath: string): HookEntry {
  return {
    type: 'command',
    command: `${cliBinPath} push --event ${hookName}`,
    [RUNTAPE_MARKER]: true,
  };
}

async function readSettings(file: string): Promise<ClaudeSettings> {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as ClaudeSettings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeSettings(file: string, data: ClaudeSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export type InstallResult = {
  settingsPath: string;
  backupPath: string;
  addedHooks: string[];
};

export async function installHooks(scope: 'user' | 'project', cliBinPath: string): Promise<InstallResult> {
  const settingsPath = paths.claudeSettings(scope);
  const backupPath = paths.claudeSettingsBackup(scope);

  // Backup (no-op if settings doesn't exist yet — we still create the dir).
  try {
    await copyFile(settingsPath, backupPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const settings = await readSettings(settingsPath);
  settings.hooks = settings.hooks ?? {};

  const added: string[] = [];
  for (const hookName of SUPPORTED_HOOKS) {
    const matchers = (settings.hooks[hookName] = settings.hooks[hookName] ?? []);
    // Find or create a matcher: "*". Append our entry there.
    let star = matchers.find((m) => m.matcher === '*');
    if (!star) {
      star = { matcher: '*', hooks: [] };
      matchers.push(star);
    }
    star.hooks = star.hooks ?? [];
    const already = star.hooks.some((h) => (h as HookEntry)[RUNTAPE_MARKER] === true);
    if (!already) {
      star.hooks.push(runtapeEntry(hookName, cliBinPath));
      added.push(hookName);
    }
  }

  await writeSettings(settingsPath, settings);
  return { settingsPath, backupPath, addedHooks: added };
}

export type UninstallResult = {
  settingsPath: string;
  removedHooks: string[];
};

export async function uninstallHooks(scope: 'user' | 'project'): Promise<UninstallResult> {
  const settingsPath = paths.claudeSettings(scope);
  const settings = await readSettings(settingsPath);
  const removed: string[] = [];

  if (settings.hooks) {
    for (const hookName of Object.keys(settings.hooks)) {
      const matchers = settings.hooks[hookName];
      for (const matcher of matchers) {
        if (!Array.isArray(matcher.hooks)) continue;
        const before = matcher.hooks.length;
        matcher.hooks = matcher.hooks.filter((h) => (h as HookEntry)[RUNTAPE_MARKER] !== true);
        if (matcher.hooks.length < before) removed.push(hookName);
      }
      // Clean up matchers that are now empty.
      settings.hooks[hookName] = matchers.filter((m) => Array.isArray(m.hooks) && m.hooks.length > 0);
      if (settings.hooks[hookName].length === 0) delete settings.hooks[hookName];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  await writeSettings(settingsPath, settings);
  return { settingsPath, removedHooks: Array.from(new Set(removed)) };
}
