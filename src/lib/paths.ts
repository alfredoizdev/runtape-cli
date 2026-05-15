import { homedir } from 'node:os';
import { join } from 'node:path';

const RUNTAPE_HOME = process.env.RUNTAPE_HOME ?? join(homedir(), '.runtape');

export const paths = {
  home: RUNTAPE_HOME,
  config: join(RUNTAPE_HOME, 'config.json'),
  bufferDir: join(RUNTAPE_HOME, 'buffer'),
  seqDir: join(RUNTAPE_HOME, 'seq'),
  flusherPid: join(RUNTAPE_HOME, 'flusher.pid'),
  flusherLog: join(RUNTAPE_HOME, 'flusher.log'),
  bufferFile: (sessionId: string) => join(RUNTAPE_HOME, 'buffer', `${sessionId}.ndjson`),
  seqFile: (sessionId: string) => join(RUNTAPE_HOME, 'seq', sessionId),
  // Per-session marker recording the last assistant message uuid we've
  // emitted from the transcript. Lets transcript scans be idempotent across
  // hook invocations without re-reading + re-emitting everything.
  transcriptCursorFile: (sessionId: string) => join(RUNTAPE_HOME, 'transcript', sessionId),
  transcriptDir: join(RUNTAPE_HOME, 'transcript'),
  claudeSettings: (scope: 'user' | 'project') =>
    scope === 'user' ? join(homedir(), '.claude', 'settings.json') : join(process.cwd(), '.claude', 'settings.json'),
  claudeSettingsBackup: (scope: 'user' | 'project') =>
    scope === 'user'
      ? join(homedir(), '.claude', 'settings.json.runtape-backup')
      : join(process.cwd(), '.claude', 'settings.json.runtape-backup'),
};
