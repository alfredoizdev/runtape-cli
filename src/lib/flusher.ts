import { appendFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readConfig } from './config.js';
import { listBufferedSessions, readBufferedSession, rewriteBufferedSession } from './buffer.js';
import { postEvents } from './api.js';
import { paths } from './paths.js';

// Tuned in 0.5.0 to cut PostgREST/Vercel invocation pressure under heavy
// sessions. A power Claude Code user generates 5-10 events/sec; 500-event
// batches at a 5s cadence still feel real-time in the dashboard while
// reducing request count ~5x vs the prior 100-event/1.5s defaults.
const POLL_INTERVAL_MS = 5_000;
const IDLE_EXIT_MS = 30_000;
const BATCH_MAX = 500;
const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000];

async function log(line: string): Promise<void> {
  try {
    await mkdir(dirname(paths.flusherLog), { recursive: true });
    await appendFile(paths.flusherLog, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* never throw out of logging */
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0); // Signal 0 = existence check, doesn't actually signal.
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true; // Exists, owned by someone else.
    return false;
  }
}

// Acquire-or-detect-running. Returns true if we became the flusher; false if one is already running.
export async function acquirePidLock(): Promise<boolean> {
  await mkdir(dirname(paths.flusherPid), { recursive: true });
  try {
    const existing = await readFile(paths.flusherPid, 'utf8');
    const pid = Number.parseInt(existing.trim(), 10);
    if (Number.isFinite(pid) && (await isProcessAlive(pid))) {
      return false; // Another flusher is alive.
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await writeFile(paths.flusherPid, String(process.pid));
  return true;
}

async function releasePidLock(): Promise<void> {
  try {
    await unlink(paths.flusherPid);
  } catch {
    /* ignore */
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Drain a single session's buffer in batches of up to BATCH_MAX. Returns true if any
// events were successfully flushed.
async function drainSession(sessionId: string, serverUrl: string, apiKey: string): Promise<boolean> {
  const snapshot = await readBufferedSession(sessionId);
  if (!snapshot || snapshot.events.length === 0) {
    await rewriteBufferedSession(sessionId, []);
    return false;
  }

  let cursor = 0;
  let anyFlushed = false;
  while (cursor < snapshot.events.length) {
    const slice = snapshot.events.slice(cursor, cursor + BATCH_MAX);
    const result = await postEvents(serverUrl, apiKey, slice);

    if (result.ok) {
      cursor += slice.length;
      anyFlushed = true;
      continue;
    }

    if (!result.retryable) {
      // Poison batch — log + drop the slice to prevent stuck buffer. 4xx is on us (or stale CLI vs server).
      await log(`drop_poison session=${sessionId} status=${result.status} error=${result.error.slice(0, 200)}`);
      cursor += slice.length;
      anyFlushed = true; // We've made forward progress (toward emptying the buffer), so don't backoff.
      continue;
    }

    // Retryable — stop draining this session, leave the rest for next poll cycle.
    await log(`retryable session=${sessionId} status=${result.status} cursor=${cursor} error=${result.error.slice(0, 200)}`);
    break;
  }

  const remaining = snapshot.raw.slice(cursor);
  await rewriteBufferedSession(sessionId, remaining);
  return anyFlushed;
}

export async function runFlusher(): Promise<void> {
  const acquired = await acquirePidLock();
  if (!acquired) {
    await log('exit_already_running');
    return;
  }

  await log(`start pid=${process.pid}`);

  let lastActivityMs = Date.now();
  let backoffIdx = 0;

  try {
    while (true) {
      const cfg = await readConfig();
      if (!cfg) {
        // No config yet — we shouldn't have been spawned. Exit cleanly.
        await log('exit_no_config');
        return;
      }

      const sessions = await listBufferedSessions();
      let flushedThisCycle = false;
      for (const sessionId of sessions) {
        const flushed = await drainSession(sessionId, cfg.server_url, cfg.api_key);
        flushedThisCycle = flushedThisCycle || flushed;
      }

      if (flushedThisCycle) {
        lastActivityMs = Date.now();
        backoffIdx = 0;
      }

      // Idle exit.
      const remaining = await listBufferedSessions();
      const idleMs = Date.now() - lastActivityMs;
      if (remaining.length === 0 && idleMs >= IDLE_EXIT_MS) {
        await log(`exit_idle idle_ms=${idleMs}`);
        return;
      }

      // Backoff when buffer is non-empty but we couldn't drain anything (server down).
      // Reset backoff when we made progress.
      const wait =
        remaining.length > 0 && !flushedThisCycle
          ? BACKOFF_STEPS_MS[Math.min(backoffIdx++, BACKOFF_STEPS_MS.length - 1)]
          : POLL_INTERVAL_MS;
      await delay(wait);
    }
  } catch (err) {
    await log(`crash error=${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    await releasePidLock();
  }
}
