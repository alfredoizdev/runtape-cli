import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './paths.js';

// The subagent transcript is a separate JSONL Claude Code keeps for each
// subagent it spawns via the Task tool. Format mirrors the main transcript:
//
//   { uuid, type: 'user',      message: { content: [...] } }
//   { uuid, type: 'assistant', message: { model, content: [...], usage: {...} } }
//
// We unpack it into a richer stream than the main transcript reader because
// the subagent's internal life is what we're trying to expose:
//   - user entries with text content     -> user_prompt
//   - user entries with tool_result blks -> tool_call (one per result)
//   - assistant entries                  -> assistant_turn (model + usage)
//   - tool_use blocks inside assistant   -> tool_attempt (one per block)
//
// Cursor lives at ~/.runtape/transcript/subagent-<parent_session>-<agent_tool_use_id>
// and tracks per-uuid emission idempotency.

export type SubagentEmit =
  | {
      kind: 'user_prompt';
      uuid: string;
      prompt: string;
    }
  | {
      kind: 'assistant_turn';
      uuid: string;
      message_uuid: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      text?: string;
    }
  | {
      kind: 'tool_attempt';
      uuid: string;
      tool_use_id: string;
      tool_name: string;
      tool_input: unknown;
    }
  | {
      kind: 'tool_call';
      uuid: string;
      tool_use_id: string;
      tool_name: string;
      tool_response: unknown;
      is_error: boolean;
      error_message?: string;
    };

type TranscriptLine = {
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

function textFromBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : undefined;
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

function summarizeToolResult(content: unknown): { is_error: boolean; error_message?: string } {
  if (!Array.isArray(content)) {
    if (typeof content === 'string') return { is_error: false };
    return { is_error: false };
  }
  // Anthropic tool_result blocks can carry their own is_error flag.
  let isError = false;
  const texts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; text?: unknown; is_error?: unknown };
      if (b.is_error === true) isError = true;
      if (typeof b.text === 'string') texts.push(b.text);
    }
  }
  if (isError && texts.length > 0) return { is_error: true, error_message: texts.join('\n').slice(0, 500) };
  if (isError) return { is_error: true };
  return { is_error: false };
}

export async function readNewSubagentEvents(
  parentSessionId: string,
  agentToolUseId: string,
  transcriptPath: string,
): Promise<{ emits: SubagentEmit[]; seen: Set<string> }> {
  const seen = await readCursor(parentSessionId, agentToolUseId);

  let raw: string;
  try {
    raw = await readFile(transcriptPath, 'utf8');
  } catch {
    return { emits: [], seen };
  }

  const emits: SubagentEmit[] = [];
  // Map tool_use_id -> tool_name learned from assistant tool_use blocks so we
  // can echo it back on the corresponding tool_call (the tool_result echo
  // doesn't carry the tool name itself).
  const toolNameByUseId = new Map<string, string>();

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(trimmed) as TranscriptLine;
    } catch {
      continue;
    }
    const uuid = typeof parsed.uuid === 'string' ? parsed.uuid : '';
    if (uuid === '' || seen.has(uuid)) continue;

    const msg = parsed.message ?? {};

    if (parsed.type === 'user') {
      // Two flavors of user entries: real user prompts vs. tool_result echoes.
      const content = msg.content;
      const hasToolResults =
        Array.isArray(content) &&
        content.some(
          (b) => b && typeof b === 'object' && (b as { type?: unknown }).type === 'tool_result',
        );
      if (hasToolResults) {
        for (const block of content as unknown[]) {
          if (!block || typeof block !== 'object') continue;
          const b = block as { type?: unknown; tool_use_id?: unknown; content?: unknown };
          if (b.type !== 'tool_result') continue;
          const tuid = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
          if (tuid === '') continue;
          const { is_error, error_message } = summarizeToolResult(b.content);
          emits.push({
            kind: 'tool_call',
            uuid: `${uuid}:${tuid}`,
            tool_use_id: tuid,
            tool_name: toolNameByUseId.get(tuid) ?? 'unknown',
            tool_response: b.content,
            is_error,
            error_message,
          });
        }
      } else {
        const text = textFromBlocks(content);
        if (text !== undefined) {
          emits.push({ kind: 'user_prompt', uuid, prompt: text });
        }
      }
      continue;
    }

    if (parsed.type === 'assistant') {
      const model = typeof msg.model === 'string' ? msg.model : '';
      // Synthetic placeholders carry no useful information.
      if (model === '' || model === '<synthetic>') continue;
      const usage = msg.usage ?? {};
      emits.push({
        kind: 'assistant_turn',
        uuid,
        message_uuid: uuid,
        model,
        input_tokens: asInt(usage.input_tokens),
        output_tokens: asInt(usage.output_tokens),
        cache_read_tokens: asInt(usage.cache_read_input_tokens),
        cache_creation_tokens: asInt(usage.cache_creation_input_tokens),
        text: textFromBlocks(msg.content),
      });
      // Emit one tool_attempt per tool_use block embedded in this assistant
      // message. The matching tool_result will land in the next user entry.
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
          if (b.type !== 'tool_use') continue;
          const tuid = typeof b.id === 'string' ? b.id : '';
          const tname = typeof b.name === 'string' ? b.name : '';
          if (tuid === '' || tname === '') continue;
          toolNameByUseId.set(tuid, tname);
          emits.push({
            kind: 'tool_attempt',
            uuid: `${uuid}:${tuid}`,
            tool_use_id: tuid,
            tool_name: tname,
            tool_input: b.input,
          });
        }
      }
      continue;
    }
  }

  return { emits, seen };
}

const CURSOR_KEEP = 500;

async function readCursor(parentSessionId: string, agentToolUseId: string): Promise<Set<string>> {
  try {
    const raw = await readFile(cursorFile(parentSessionId, agentToolUseId), 'utf8');
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

function cursorFile(parentSessionId: string, agentToolUseId: string): string {
  // Two-level encoding so different parents and different agent invocations
  // keep independent cursors even if their uuids overlap by accident.
  return `${paths.transcriptDir}/subagent-${parentSessionId}-${agentToolUseId}`;
}

export async function persistSubagentCursor(
  parentSessionId: string,
  agentToolUseId: string,
  seen: Set<string>,
  newlyEmitted: string[],
): Promise<void> {
  for (const u of newlyEmitted) seen.add(u);
  const file = cursorFile(parentSessionId, agentToolUseId);
  await mkdir(dirname(file), { recursive: true });
  const arr = [...seen];
  const trimmed = arr.length > CURSOR_KEEP ? arr.slice(arr.length - CURSOR_KEEP) : arr;
  await writeFile(file, trimmed.join('\n') + '\n');
}
