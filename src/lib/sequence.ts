import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './paths.js';

// Per-session monotonic counter. Persisted as a single integer in seq/<session_id>.
// Hooks fire one-at-a-time per session (Claude Code waits for the hook to exit before
// firing the next), so we do NOT need cross-process locking — but we DO need the value
// to survive across hook invocations, since each `hindsight push` is a separate process.
export async function nextSequence(sessionId: string): Promise<number> {
  const file = paths.seqFile(sessionId);
  await mkdir(dirname(file), { recursive: true });

  let current = 0;
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) current = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const next = current + 1;
  await writeFile(file, String(next));
  return next - 1; // First call returns 0 (matching the Zod schema's nonnegative invariant).
}
