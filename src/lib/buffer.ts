import { appendFile, mkdir, readFile, readdir, writeFile, unlink, stat } from 'node:fs/promises';
import type { RuntapeEvent } from '../types.js';
import { paths } from './paths.js';

// Atomic append-as-line. POSIX guarantees a single write() of <PIPE_BUF bytes (≥512) is
// atomic, and we further constrain ourselves to one line per call. Two concurrent
// appenders (e.g. two Claude Code instances writing to the same session — impossible
// today, but cheap defense) cannot interleave a single line.
export async function appendEvent(sessionId: string, event: RuntapeEvent): Promise<void> {
  await mkdir(paths.bufferDir, { recursive: true });
  const line = JSON.stringify(event) + '\n';
  await appendFile(paths.bufferFile(sessionId), line, { encoding: 'utf8' });
}

export type BufferedSession = {
  sessionId: string;
  events: RuntapeEvent[];
  raw: string[]; // Raw lines, so we can rewrite exactly what we read on partial-flush.
};

export async function listBufferedSessions(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(paths.bufferDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.endsWith('.ndjson')).map((e) => e.slice(0, -'.ndjson'.length));
}

export async function readBufferedSession(sessionId: string): Promise<BufferedSession | null> {
  let raw: string;
  try {
    raw = await readFile(paths.bufferFile(sessionId), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const events: RuntapeEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as RuntapeEvent);
    } catch {
      // Skip malformed lines — they could only get there via a half-written disk; drop them.
    }
  }
  return { sessionId, events, raw: lines };
}

// Atomic truncate-after-flush: write a temp file with the unflushed remainder, then rename.
// If `unflushedLines` is empty, delete the buffer file entirely.
export async function rewriteBufferedSession(sessionId: string, unflushedLines: string[]): Promise<void> {
  const file = paths.bufferFile(sessionId);
  if (unflushedLines.length === 0) {
    try {
      await unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return;
  }
  const tmp = file + '.tmp';
  await writeFile(tmp, unflushedLines.map((l) => l + '\n').join(''));
  // rename is atomic within the same filesystem; both paths are in ~/.runtape/buffer.
  const { rename } = await import('node:fs/promises');
  await rename(tmp, file);
}

export async function bufferSize(sessionId: string): Promise<number> {
  try {
    const s = await stat(paths.bufferFile(sessionId));
    return s.size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
}

export function bufferDirPath(): string {
  return paths.bufferDir;
}

// Used by tests + future GC: stat-mtime in ms for the buffer file.
export async function bufferMtimeMs(sessionId: string): Promise<number | null> {
  try {
    const s = await stat(paths.bufferFile(sessionId));
    return s.mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// Re-export for callers that want to know where the file lives without importing paths twice.
export function bufferFilePath(sessionId: string): string {
  return paths.bufferFile(sessionId);
}
