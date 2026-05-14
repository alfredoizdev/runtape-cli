import { z } from 'zod';
import { HindsightEvent } from '../types.js';

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

export type MappedEvent = z.infer<typeof HindsightEvent>;

export type MapResult =
  | { kind: 'event'; event: MappedEvent }
  | { kind: 'drop'; reason: string };

// Maps a Claude hook payload + the hook name we were invoked with into a HindsightEvent.
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
    case 'PostToolUse':
      candidate = {
        ...base,
        type: 'tool_call',
        tool_name: payload.tool_name,
        tool_input: payload.tool_input,
        tool_response: payload.tool_response,
        tool_use_id: payload.tool_use_id,
        duration_ms: payload.duration_ms,
      };
      break;
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

  const parsed = HindsightEvent.safeParse(candidate);
  if (!parsed.success) {
    return { kind: 'drop', reason: `validation failed: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}` };
  }
  return { kind: 'event', event: parsed.data };
}
