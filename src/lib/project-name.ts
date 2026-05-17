import { stat, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

// Best-effort label for the project the user is working on. Resolution order:
//   1. Outermost git repo root (basename of the dir containing `.git`).
//      Matches the user mental model "I'm working in <repo>" even when
//      Claude Code is launched from a sub-package of a monorepo.
//   2. Nearest ancestor with a `package.json` that has a non-empty `name`.
//      Catches Node projects that aren't in a git repo yet.
//   3. basename(cwd) — final fallback, never null.
//
// Returns the raw string with no transformation (scoped names like
// `@runtape/web` come through as-is).
export async function detectProjectName(cwd: string): Promise<string> {
  const repoRoot = await findOutermostGitRoot(cwd);
  if (repoRoot) return basename(repoRoot);

  const pkgName = await findNearestPackageName(cwd);
  if (pkgName) return pkgName;

  return basename(cwd) || cwd;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Walk from cwd to filesystem root, return the OUTERMOST directory that
// contains a `.git` entry. That gives the actual repo root in a nested-repo
// layout (rare but valid: submodules, .git directories in subfolders).
async function findOutermostGitRoot(cwd: string): Promise<string | null> {
  let dir = cwd;
  let lastFound: string | null = null;
  // Hard ceiling so a broken filesystem can't loop us forever.
  for (let i = 0; i < 100; i++) {
    if (await pathExists(join(dir, '.git'))) {
      lastFound = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return lastFound;
}

// Walk from cwd to filesystem root, return the FIRST package.json whose
// `name` field is a non-empty string.
async function findNearestPackageName(cwd: string): Promise<string | null> {
  let dir = cwd;
  for (let i = 0; i < 100; i++) {
    try {
      const raw = await readFile(join(dir, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name.trim() !== '') {
        return parsed.name.trim();
      }
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
