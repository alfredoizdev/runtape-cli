import { chmod, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { paths } from './paths.js';

export const Config = z.object({
  api_key: z.string().regex(/^rtk_[a-f0-9]{64}$/, 'api_key must be rtk_ followed by 64 hex chars'),
  server_url: z.string().url(),
});

export type Config = z.infer<typeof Config>;

const DEFAULT_SERVER_URL = process.env.RUNTAPE_API_URL ?? 'https://runtape.dev';

export async function readConfig(): Promise<Config | null> {
  let raw: string;
  try {
    raw = await readFile(paths.config, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = Config.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid config at ${paths.config}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function writeConfig(c: Config): Promise<void> {
  await mkdir(dirname(paths.config), { recursive: true });
  await writeFile(paths.config, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  // writeFile's `mode` is only applied on create. Re-chmod explicitly so a re-login
  // tightens permissions if the file was previously loosened (e.g. `chmod 644`).
  await chmod(paths.config, 0o600);
}

export async function clearConfig(): Promise<void> {
  try {
    await unlink(paths.config);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

export function defaultServerUrl(): string {
  return DEFAULT_SERVER_URL;
}
