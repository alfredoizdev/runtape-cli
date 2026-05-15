import { spawn } from 'node:child_process';
import { platform } from 'node:process';
import { readConfig } from '../lib/config.js';

function openCommand(): { cmd: string; args: string[] } {
  // Cross-platform "open this URL in the default browser".
  // macOS: `open <url>`. Linux: `xdg-open <url>`. Windows: `cmd /c start "" <url>`.
  if (platform === 'darwin') return { cmd: 'open', args: [] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', ''] };
  return { cmd: 'xdg-open', args: [] };
}

export async function runsCommand(): Promise<number> {
  const cfg = await readConfig();
  if (!cfg) {
    process.stderr.write('Not logged in. Run `hindsight login` first.\n');
    return 1;
  }

  const url = `${cfg.server_url.replace(/\/$/, '')}/dashboard/runs`;
  const { cmd, args } = openCommand();

  const child = spawn(cmd, [...args, url], { stdio: 'ignore', detached: true });
  child.on('error', (err) => {
    process.stderr.write(`Could not launch browser (${err.message}). Open this manually:\n${url}\n`);
  });
  child.unref();

  process.stdout.write(`Opening ${url}\n`);
  return 0;
}
