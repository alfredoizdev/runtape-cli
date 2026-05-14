import { Command } from 'commander';

const program = new Command();

program
  .name('hindsight')
  .description('Flight recorder for AI coding agents.')
  .version('0.0.0');

// Real commands (login, install, push, etc.) land in Plan 4.
program.parse(process.argv);
