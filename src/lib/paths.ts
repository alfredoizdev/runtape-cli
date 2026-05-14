import { homedir } from 'node:os';
import { join } from 'node:path';

const HINDSIGHT_HOME = process.env.HINDSIGHT_HOME ?? join(homedir(), '.hindsight');

export const paths = {
  home: HINDSIGHT_HOME,
  config: join(HINDSIGHT_HOME, 'config.json'),
  bufferDir: join(HINDSIGHT_HOME, 'buffer'),
  seqDir: join(HINDSIGHT_HOME, 'seq'),
  flusherPid: join(HINDSIGHT_HOME, 'flusher.pid'),
  flusherLog: join(HINDSIGHT_HOME, 'flusher.log'),
  bufferFile: (sessionId: string) => join(HINDSIGHT_HOME, 'buffer', `${sessionId}.ndjson`),
  seqFile: (sessionId: string) => join(HINDSIGHT_HOME, 'seq', sessionId),
  claudeSettings: (scope: 'user' | 'project') =>
    scope === 'user' ? join(homedir(), '.claude', 'settings.json') : join(process.cwd(), '.claude', 'settings.json'),
  claudeSettingsBackup: (scope: 'user' | 'project') =>
    scope === 'user'
      ? join(homedir(), '.claude', 'settings.json.hindsight-backup')
      : join(process.cwd(), '.claude', 'settings.json.hindsight-backup'),
};
