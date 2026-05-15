import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './paths.js';

// Claude Code maintains a JSONL transcript at `transcript_path`. Every line is
// a single message object with at minimum `uuid`, `type` (user|assistant|...)
// and a `message` payload. Assistant messages additionally carry the model
// identifier and Anthropic API usage block — the *only* place either datum
// appears in the hook emit chain.
//
// We scan the transcript on every PostToolUse/Stop hook and emit one
// AssistantTurn event per assistant message whose uuid is not in our seen
// set. The cursor file persists the seen set across hook invocations.
//
// The transcript is append-only within a session so the scan is cheap; we
// only ever read the file once per hook fire.

export type TranscriptUsage = {
  message_uuid: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  text?: string;
};

type AssistantLine = {
  uuid?: unknown;
  type?: unknown;
  message?: {
    role?: unknown;
    model?: unknown;
    content?: unknown;
    usage?: {
      input_tokens?: unknown;
      output_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    };
  };
};

function asInt(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x) && x >= 0) return Math.trunc(x);
  return 0;
}

function extractAssistantText(content: unknown): string | undefined {
  // Anthropic content blocks: [{ type: 'text', text: '...' }, { type: 'tool_use', ... }]
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && 'type' in block) {
      const b = block as { type: unknown; text?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
  }
  const joined = parts.join('\n').trim();
  return joined === '' ? undefined : joined;
}

// Parses the transcript and returns assistant turns whose uuid is not in
// `seenUuids`. The seen set is read from the cursor file; the caller is
// responsible for persisting it after the events have been buffered.
export async function readNewAssistantTurns(
  sessionId: string,
  transcriptPath: string,
): Promise<{ turns: TranscriptUsage[]; seen: Set<string> }> {
  const seen = await readCursor(sessionId);

  let raw: string;
  try {
    raw = await readFile(transcriptPath, 'utf8');
  } catch {
    return { turns: [], seen };
  }

  const turns: TranscriptUsage[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: AssistantLine;
    try {
      parsed = JSON.parse(trimmed) as AssistantLine;
    } catch {
      // Truncated or partial line at the tail — skip silently. The next hook
      // fire will see the full line once Claude Code has finished writing it.
      continue;
    }
    if (parsed.type !== 'assistant') continue;
    const uuid = typeof parsed.uuid === 'string' ? parsed.uuid : '';
    if (uuid === '' || seen.has(uuid)) continue;
    const msg = parsed.message ?? {};
    const model = typeof msg.model === 'string' ? msg.model : '';
    if (model === '') continue;
    const usage = msg.usage ?? {};
    turns.push({
      message_uuid: uuid,
      model,
      input_tokens: asInt(usage.input_tokens),
      output_tokens: asInt(usage.output_tokens),
      cache_read_tokens: asInt(usage.cache_read_input_tokens),
      cache_creation_tokens: asInt(usage.cache_creation_input_tokens),
      text: extractAssistantText(msg.content),
    });
  }

  return { turns, seen };
}

// Cursor file is a newline-separated list of uuids. Trim to the most recent
// 200 — the seen set only needs to cover the tail of the transcript that the
// next hook might re-scan, not the full history.
const CURSOR_KEEP = 200;

async function readCursor(sessionId: string): Promise<Set<string>> {
  try {
    const raw = await readFile(paths.transcriptCursorFile(sessionId), 'utf8');
    return new Set(
      raw
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    );
  } catch {
    return new Set();
  }
}

export async function persistCursor(
  sessionId: string,
  seen: Set<string>,
  newlyEmitted: string[],
): Promise<void> {
  for (const u of newlyEmitted) seen.add(u);
  const file = paths.transcriptCursorFile(sessionId);
  await mkdir(dirname(file), { recursive: true });
  // Keep only the tail so the file doesn't grow unbounded over long sessions.
  const arr = [...seen];
  const trimmed = arr.length > CURSOR_KEEP ? arr.slice(arr.length - CURSOR_KEEP) : arr;
  await writeFile(file, trimmed.join('\n') + '\n');
}
