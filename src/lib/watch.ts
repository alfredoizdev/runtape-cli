import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { WatchConfig } from './config.js';

// Pure decision: should this cwd be captured under the given watch config?
// Returns true when capture should proceed, false when the hook must silently
// no-op. Mirrors the semantics of allow_list / deny_list / allow_all.
//
// Matching is prefix-based on normalized absolute paths. `/Users/me/work`
// matches both `/Users/me/work` and `/Users/me/work/repo`, but NOT
// `/Users/me/work-other` (we anchor the prefix on a path separator boundary).
export function isCaptureAllowed(watch: WatchConfig | undefined, cwd: string): boolean {
  if (!watch || watch.mode === 'allow_all') return true;
  if (watch.paths.length === 0) {
    // deny_list with no paths => deny nothing (capture). allow_list with no
    // paths => allow nothing (skip). Either way the semantics are intuitive.
    return watch.mode === 'deny_list';
  }
  const cwdNorm = normalizePath(cwd);
  const matched = watch.paths.some((p) => isPrefixMatch(cwdNorm, normalizePath(p)));
  return watch.mode === 'allow_list' ? matched : !matched;
}

function isPrefixMatch(cwd: string, prefix: string): boolean {
  return cwd === prefix || cwd.startsWith(prefix + '/');
}

// Normalize a path to an absolute form so comparisons don't break on `~`
// expansion or trailing slashes. Tilde expansion is best-effort: the user's
// shell expands it before we ever see it in most flows, but `runtape watch
// ignore ~/foo` is a likely input from a terminal where the shell didn't.
export function normalizePath(input: string): string {
  let expanded = input;
  if (expanded === '~') expanded = homedir();
  else if (expanded.startsWith('~/')) expanded = `${homedir()}/${expanded.slice(2)}`;
  const abs = resolve(expanded);
  return abs.replace(/\/+$/, '') || '/';
}
