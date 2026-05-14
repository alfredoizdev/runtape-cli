import { spawn } from 'node:child_process';
import { mapHookPayload } from '../lib/hook-mapping.js';
import { nextSequence } from '../lib/sequence.js';
import { appendEvent } from '../lib/buffer.js';
import { readConfig } from '../lib/config.js';
import { resolveCliBinPath } from '../lib/cli-bin.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function spawnFlusher(cliBinPath: string): void {
  // Detached so it survives this process exit. stdio:'ignore' so the daemon
  // doesn't inherit the hook's stdin/stdout (Claude Code reads hook stdout!).
  const child = spawn(cliBinPath, ['--internal-flusher'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

export async function pushCommand(opts: { event: string }): Promise<number> {
  // The contract is: never block the hook. If we can't parse/auth/whatever, exit 0 quietly
  // (printing to stderr is fine; printing to stdout could be parsed by Claude Code).
  try {
    const cfg = await readConfig();
    if (!cfg) {
      process.stderr.write('hindsight: not logged in — skipping event\n');
      return 0;
    }

    const raw = await readStdin();
    if (!raw.trim()) {
      // SessionStart in some Claude Code versions may invoke hooks with no stdin; ignore.
      return 0;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      process.stderr.write(`hindsight: invalid JSON on stdin: ${err instanceof Error ? err.message : String(err)}\n`);
      return 0;
    }

    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
    if (!sessionId) {
      process.stderr.write('hindsight: missing session_id on hook payload\n');
      return 0;
    }

    const sequence = await nextSequence(sessionId);
    const result = mapHookPayload(opts.event, payload, {
      wall_ts: new Date().toISOString(),
      sequence,
    });

    if (result.kind === 'drop') {
      // Notification, unknown hook, or validation failure. Quiet log + exit clean.
      process.stderr.write(`hindsight: dropped ${opts.event}: ${result.reason}\n`);
      return 0;
    }

    await appendEvent(sessionId, result.event);
    spawnFlusher(resolveCliBinPath());
    return 0;
  } catch (err) {
    process.stderr.write(`hindsight: push error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 0; // Never fail the hook.
  }
}
