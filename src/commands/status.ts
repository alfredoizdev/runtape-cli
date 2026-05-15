import { readFile } from 'node:fs/promises';
import { readConfig } from '../lib/config.js';
import { listBufferedSessions, bufferSize, bufferMtimeMs } from '../lib/buffer.js';
import { paths } from '../lib/paths.js';
import { pingProject } from '../lib/api.js';

async function readFlusherPid(): Promise<number | null> {
  try {
    const raw = await readFile(paths.flusherPid, 'utf8');
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function statusCommand(): Promise<number> {
  const cfg = await readConfig();
  if (!cfg) {
    process.stdout.write('Not logged in. Run `runtape login`.\n');
    return 0;
  }

  process.stdout.write(`Server: ${cfg.server_url}\n`);
  process.stdout.write(`API key: ${cfg.api_key.slice(0, 8)}…${cfg.api_key.slice(-4)}\n`);

  const ping = await pingProject(cfg.server_url, cfg.api_key);
  process.stdout.write(`Reachable: ${ping.ok ? 'yes' : `no (${ping.detail ?? ping.status})`}\n`);

  const sessions = await listBufferedSessions();
  if (sessions.length === 0) {
    process.stdout.write('Buffer: empty.\n');
  } else {
    process.stdout.write(`Buffer: ${sessions.length} session(s) pending.\n`);
    for (const s of sessions) {
      const size = await bufferSize(s);
      const mtime = await bufferMtimeMs(s);
      const ageSec = mtime ? Math.round((Date.now() - mtime) / 1000) : null;
      process.stdout.write(`  ${s}: ${size} bytes${ageSec !== null ? `, updated ${ageSec}s ago` : ''}\n`);
    }
  }

  const flusherPid = await readFlusherPid();
  if (flusherPid !== null) {
    process.stdout.write(`Flusher: PID ${flusherPid}\n`);
  } else {
    process.stdout.write('Flusher: not running.\n');
  }

  return 0;
}
