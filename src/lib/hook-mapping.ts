import { z } from 'zod';
import { RuntapeEvent } from '../types.js';

// The seven Claude Code hook names we register, plus a sentinel "drop" for unknown events.
// Validated 2026-05-14 against Claude Code 2.1.128 — see spike findings spec.
export type ClaudeHookName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'Notification';

export const SUPPORTED_HOOKS: ClaudeHookName[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
];

export type MappedEvent = z.infer<typeof RuntapeEvent>;

export type MapResult =
  | { kind: 'event'; event: MappedEvent }
  | { kind: 'drop'; reason: string };

// PostToolUse tool_response shapes vary by tool. We look at the canonical
// signals each tool emits and collapse them into a uniform (is_error, message)
// pair so the server doesn't need per-tool knowledge.
//   - Anthropic-tagged: { is_error: true, content: [{text}] } (the official
//     content-block error form used by some Claude Code tools).
//   - Bash: { interrupted, stdout, stderr, output, ... }. Non-zero exits also
//     surface in stderr and an explicit `exitCode` when available.
//   - Edit/Write/MultiEdit: success returns a structured payload; errors
//     return `{ error: '...' }`.
function inspectToolResponse(tool_response: unknown): { is_error: boolean; error_message?: string } {
  if (!tool_response || typeof tool_response !== 'object') return { is_error: false };
  const r = tool_response as Record<string, unknown>;
  if (r.is_error === true) {
    const content = r.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && 'text' in block) {
          const t = (block as { text?: unknown }).text;
          if (typeof t === 'string') return { is_error: true, error_message: t };
        }
      }
    }
    if (typeof r.message === 'string') return { is_error: true, error_message: r.message };
    return { is_error: true };
  }
  if (typeof r.error === 'string' && r.error.trim() !== '') {
    return { is_error: true, error_message: r.error };
  }
  if (r.interrupted === true) {
    return { is_error: true, error_message: 'Interrupted' };
  }
  return { is_error: false };
}

// Maps a Claude hook payload + the hook name we were invoked with into a RuntapeEvent.
// Returns { kind: 'drop' } for Notification or unknown events (we just exit cleanly).
export function mapHookPayload(
  hookName: string,
  payload: Record<string, unknown>,
  augment: { wall_ts: string; sequence: number },
): MapResult {
  // Shared envelope every Claude hook carries.
  const base = {
    session_id: payload.session_id,
    transcript_path: payload.transcript_path,
    cwd: payload.cwd,
    hook_event_name: payload.hook_event_name ?? hookName,
    permission_mode: payload.permission_mode,
    wall_ts: augment.wall_ts,
    sequence: augment.sequence,
  };

  let candidate: Record<string, unknown>;
  switch (hookName) {
    case 'SessionStart':
      candidate = { ...base, type: 'session_start', source: payload.source ?? 'startup' };
      break;
    case 'UserPromptSubmit':
      candidate = { ...base, type: 'user_prompt', prompt: payload.prompt };
      break;
    case 'PreToolUse':
      candidate = {
        ...base,
        type: 'tool_attempt',
        tool_name: payload.tool_name,
        tool_input: payload.tool_input,
        tool_use_id: payload.tool_use_id,
      };
      break;
    case 'PostToolUse': {
      const err = inspectToolResponse(payload.tool_response);
      candidate = {
        ...base,
        type: 'tool_call',
        tool_name: payload.tool_name,
        tool_input: payload.tool_input,
        tool_response: payload.tool_response,
        tool_use_id: payload.tool_use_id,
        duration_ms: payload.duration_ms,
        is_error: err.is_error,
        error_message: err.error_message,
      };
      break;
    }
    case 'Stop':
      candidate = {
        ...base,
        type: 'session_end',
        last_assistant_message: payload.last_assistant_message,
        stop_hook_active: payload.stop_hook_active,
      };
      break;
    case 'SubagentStop':
      candidate = {
        ...base,
        type: 'subagent_end',
        agent_id: payload.agent_id,
        agent_type: payload.agent_type,
        agent_transcript_path: payload.agent_transcript_path,
        last_assistant_message: payload.last_assistant_message,
        stop_hook_active: payload.stop_hook_active,
      };
      break;
    default:
      return { kind: 'drop', reason: `unsupported hook: ${hookName}` };
  }

  const parsed = RuntapeEvent.safeParse(candidate);
  if (!parsed.success) {
    return { kind: 'drop', reason: `validation failed: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}` };
  }
  return { kind: 'event', event: parsed.data };
}
