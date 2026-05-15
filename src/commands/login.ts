import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Config, defaultServerUrl, writeConfig } from '../lib/config.js';
import { pingProject } from '../lib/api.js';

export async function loginCommand(opts: { key?: string; serverUrl?: string }): Promise<number> {
  const serverUrl = opts.serverUrl ?? defaultServerUrl();

  let apiKey = opts.key;
  if (!apiKey) {
    const rl = createInterface({ input, output });
    apiKey = (await rl.question('Paste your Runtape API key (rtk_…): ')).trim();
    rl.close();
  }

  const validation = Config.shape.api_key.safeParse(apiKey);
  if (!validation.success) {
    process.stderr.write(`Invalid API key format. Expected rtk_<64 hex chars>.\n`);
    return 2;
  }

  process.stdout.write(`Validating against ${serverUrl}…\n`);
  const ping = await pingProject(serverUrl, apiKey);
  if (!ping.ok) {
    process.stderr.write(`Login failed: ${ping.status === 401 ? 'unknown API key' : ping.detail ?? 'server unreachable'}\n`);
    return 1;
  }

  await writeConfig({ api_key: apiKey, server_url: serverUrl });
  process.stdout.write(`Saved. You can now run: runtape install\n`);
  return 0;
}
