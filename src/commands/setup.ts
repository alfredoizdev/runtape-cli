import { spawn } from 'node:child_process';
import { platform } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Config, defaultServerUrl, readConfig, writeConfig } from '../lib/config.js';
import { pingProject } from '../lib/api.js';
import { installHooks } from '../lib/hooks-installer.js';
import { resolveCliBinPath } from '../lib/cli-bin.js';

function openCommand(): { cmd: string; args: string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: [] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', ''] };
  return { cmd: 'xdg-open', args: [] };
}

function openInBrowser(url: string): void {
  const { cmd, args } = openCommand();
  const child = spawn(cmd, [...args, url], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    /* swallow — caller already printed the URL to fall back on */
  });
  child.unref();
}

async function promptYesNo(rl: Awaited<ReturnType<typeof createInterface>>, question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export async function setupCommand(opts: { noBrowser?: boolean }): Promise<number> {
  const rl = createInterface({ input, output });

  try {
    process.stdout.write('\nRuntape setup\n');
    process.stdout.write('Let\'s get your Claude Code runs captured.\n\n');

    // Step 1 — short-circuit if already configured
    const existing = await readConfig();
    if (existing) {
      process.stdout.write(`Already logged in to ${existing.server_url}\n`);
      process.stdout.write(`API key:  ${existing.api_key.slice(0, 8)}…${existing.api_key.slice(-4)}\n`);
      const reconfigure = await promptYesNo(rl, 'Reconfigure?', false);
      if (!reconfigure) {
        process.stdout.write('\nKeeping existing credentials. Moving on to hook install.\n');
        return await installAndFinish(rl, existing.server_url);
      }
    }

    // Step 2 — server URL
    const suggestedUrl = defaultServerUrl();
    process.stdout.write(`Step 1/3 — Backend\n`);
    const urlInput = (await rl.question(`Server URL [${suggestedUrl}]: `)).trim();
    const serverUrl = urlInput === '' ? suggestedUrl : urlInput;

    // Step 3 — open dashboard for the user to grab their key
    const dashboardUrl = `${serverUrl.replace(/\/$/, '')}/dashboard`;
    process.stdout.write(`\nStep 2/3 — API key\n`);
    process.stdout.write(`Your API key lives in the dashboard:\n  ${dashboardUrl}\n`);
    if (!opts.noBrowser) {
      openInBrowser(dashboardUrl);
      process.stdout.write('(opened in your browser)\n');
    }

    // Step 4 — paste + validate
    const apiKey = (await rl.question('\nPaste your API key (rtk_…): ')).trim();
    const validation = Config.shape.api_key.safeParse(apiKey);
    if (!validation.success) {
      process.stderr.write(`\nInvalid API key format. Expected rtk_<64 hex chars>.\n`);
      return 2;
    }

    process.stdout.write(`Validating against ${serverUrl}…\n`);
    const ping = await pingProject(serverUrl, apiKey);
    if (!ping.ok) {
      process.stderr.write(
        `\nLogin failed: ${ping.status === 401 ? 'unknown API key' : ping.detail ?? 'server unreachable'}\n`,
      );
      return 1;
    }

    await writeConfig({ api_key: apiKey, server_url: serverUrl });
    process.stdout.write('Credentials saved.\n');

    // Step 5 — install hooks
    return await installAndFinish(rl, serverUrl);
  } finally {
    rl.close();
  }
}

async function installAndFinish(
  rl: Awaited<ReturnType<typeof createInterface>>,
  serverUrl: string,
): Promise<number> {
  process.stdout.write(`\nStep 3/3 — Claude Code hooks\n`);
  const install = await promptYesNo(
    rl,
    'Install Runtape hooks into ~/.claude/settings.json now?',
    true,
  );

  if (!install) {
    process.stdout.write('\nSkipped hook install. Run `runtape install` when ready.\n');
    return 0;
  }

  const cliBinPath = resolveCliBinPath();
  const result = await installHooks('user', cliBinPath);
  process.stdout.write(`Updated ${result.settingsPath}\n`);
  if (result.addedHooks.length === 0) {
    process.stdout.write('Hooks already installed — nothing changed.\n');
  } else {
    process.stdout.write(`Added: ${result.addedHooks.join(', ')}\n`);
  }

  process.stdout.write('\nSetup complete.\n');
  process.stdout.write('Now run `claude -p "any prompt"` from any directory and watch the run land at:\n');
  process.stdout.write(`  ${serverUrl.replace(/\/$/, '')}/dashboard\n\n`);
  return 0;
}
