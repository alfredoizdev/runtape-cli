import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { pushCommand } from './commands/push.js';
import { statusCommand } from './commands/status.js';
import { runsCommand } from './commands/runs.js';
import { runFlusher } from './lib/flusher.js';

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
    .name('hindsight')
    .description('Flight recorder for AI coding agents.')
    .version('0.1.1');

  program
    .command('login')
    .description('Paste your API key from hindsight.dev/dashboard and save it locally.')
    .option('-k, --key <key>', 'API key (skip the prompt)')
    .option('-s, --server-url <url>', 'Override server URL')
    .action(async (opts) => process.exit(await loginCommand(opts)));

  program
    .command('logout')
    .description('Remove saved credentials.')
    .action(async () => process.exit(await logoutCommand()));

  program
    .command('install')
    .description('Add Hindsight hooks to ~/.claude/settings.json (or project-local with --project).')
    .option('--project', 'Install into ./.claude/settings.json instead of user-level')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(async (opts) => process.exit(await installCommand(opts)));

  program
    .command('uninstall')
    .description('Remove Hindsight hooks from Claude settings.')
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
    .description('Open your Hindsight dashboard in the default browser.')
    .action(async () => process.exit(await runsCommand()));

  program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
