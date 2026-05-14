import { clearConfig } from '../lib/config.js';

export async function logoutCommand(): Promise<number> {
  await clearConfig();
  process.stdout.write('Logged out. Config removed.\n');
  return 0;
}
