import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readConfig } from '../lib/config.js';
import { installHooks } from '../lib/hooks-installer.js';
import { resolveCliBinPath } from '../lib/cli-bin.js';

export async function installCommand(opts: { project?: boolean; yes?: boolean }): Promise<number> {
  const cfg = await readConfig();
  if (!cfg) {
    process.stderr.write('Not logged in. Run `hindsight login` first.\n');
    return 1;
  }

  const scope: 'user' | 'project' = opts.project ? 'project' : 'user';
  const cliBinPath = resolveCliBinPath();

  if (!opts.yes) {
    const rl = createInterface({ input, output });
    const answer = (await rl.question(`Install Hindsight hooks into ${scope} settings (yes/no)? `)).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      process.stdout.write('Aborted.\n');
      return 0;
    }
  }

  const result = await installHooks(scope, cliBinPath);
  process.stdout.write(`Updated ${result.settingsPath}\n`);
  process.stdout.write(`Backup: ${result.backupPath}\n`);
  if (result.addedHooks.length === 0) {
    process.stdout.write('Hooks already installed — nothing changed.\n');
  } else {
    process.stdout.write(`Added: ${result.addedHooks.join(', ')}\n`);
  }
  return 0;
}
