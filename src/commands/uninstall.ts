import { uninstallHooks } from '../lib/hooks-installer.js';

export async function uninstallCommand(opts: { project?: boolean }): Promise<number> {
  const scope: 'user' | 'project' = opts.project ? 'project' : 'user';
  const result = await uninstallHooks(scope);
  if (result.removedHooks.length === 0) {
    process.stdout.write(`No Runtape hooks found in ${result.settingsPath}.\n`);
  } else {
    process.stdout.write(`Removed Runtape entries from: ${result.removedHooks.join(', ')}\n`);
  }
  return 0;
}
