import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { pushCommand } from './commands/push.js';
import { statusCommand } from './commands/status.js';
import { runsCommand } from './commands/runs.js';
import { setupCommand } from './commands/setup.js';
import {
  watchListCommand,
  watchIgnoreCommand,
  watchOnlyCommand,
  watchUnignoreCommand,
  watchResetCommand,
} from './commands/watch.js';
import { runFlusher } from './lib/flusher.js';

// Read package.json at runtime so --version can never desync from the publish.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const PKG_VERSION = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

// Internal flag for the detached flusher daemon — not a user-facing subcommand.
// Goes before commander.parse so we can short-circuit before commander sees argv.
if (process.argv.includes('--internal-flusher')) {
  void runFlusher().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
} else {
  const program = new Command();

  program
    .name('runtape')
    .description('Flight recorder for AI coding agents.')
    .version(PKG_VERSION);

  program
    .command('setup')
    .description('Guided onboarding: login + install hooks + verify in one flow.')
    .option('--no-browser', 'Do not open the dashboard URL in a browser')
    .action(async (opts) => process.exit(await setupCommand(opts)));

  program
    .command('login')
    .description('Paste your API key from runtape.dev/dashboard and save it locally.')
    .option('-k, --key <key>', 'API key (skip the prompt)')
    .option('-s, --server-url <url>', 'Override server URL')
    .action(async (opts) => process.exit(await loginCommand(opts)));

  program
    .command('logout')
    .description('Remove saved credentials.')
    .action(async () => process.exit(await logoutCommand()));

  program
    .command('install')
    .description('Add Runtape hooks to ~/.claude/settings.json (or project-local with --project).')
    .option('--project', 'Install into ./.claude/settings.json instead of user-level')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (opts) => process.exit(await installCommand(opts)));

  program
    .command('uninstall')
    .description('Remove Runtape hooks from Claude settings.')
    .option('--project', 'Operate on ./.claude/settings.json instead of user-level')
    .action(async (opts) => process.exit(await uninstallCommand(opts)));

  program
    .command('push')
    .description('Internal: invoked by Claude Code hooks. Reads stdin and buffers an event.')
    .requiredOption('--event <name>', 'Claude hook event name (SessionStart, PostToolUse, …)')
    .action(async (opts) => process.exit(await pushCommand(opts)));

  program
    .command('status')
    .description('Show current login, buffer state, and server reachability.')
    .action(async () => process.exit(await statusCommand()));

  program
    .command('runs')
    .description('Open your Runtape dashboard in the default browser.')
    .action(async () => process.exit(await runsCommand()));

  const watch = program
    .command('watch')
    .description('Control which directories the hooks capture (allow / deny lists).');
  watch
    .command('list')
    .description('Show the current watch mode and paths.')
    .action(async () => process.exit(await watchListCommand()));
  watch
    .command('ignore <path>')
    .description('Stop capturing sessions whose cwd is under <path>. Switches mode to deny_list.')
    .action(async (path: string) => process.exit(await watchIgnoreCommand(path)));
  watch
    .command('only <path>')
    .description('Capture ONLY sessions whose cwd is under <path>. Switches mode to allow_list.')
    .action(async (path: string) => process.exit(await watchOnlyCommand(path)));
  watch
    .command('unignore <path>')
    .description('Remove <path> from the current watch list.')
    .action(async (path: string) => process.exit(await watchUnignoreCommand(path)));
  watch
    .command('reset')
    .description('Capture every session (clear all watch settings).')
    .action(async () => process.exit(await watchResetCommand()));

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
