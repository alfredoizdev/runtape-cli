import { z } from 'zod';

// Every Claude Code hook event carries these envelope fields.
const ClaudeHookBase = z.object({
  session_id: z.string().min(1),
  transcript_path: z.string().min(1),
  cwd: z.string().min(1),
  hook_event_name: z.string().min(1),
  permission_mode: z.string().optional(),
});

// CLI-augmented envelope adds monotonic ordering + wall-clock timestamp.
// agent_tool_use_id is set when the CLI is synthesizing events from a
// subagent transcript — it carries the parent Agent step's tool_use_id so
// the server can resolve parent_step_id deterministically instead of
// relying on the temporal open-stack heuristic. Optional so the field is
// absent for normal top-level events.
const CliAugment = z.object({
  wall_ts: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
  agent_tool_use_id: z.string().min(1).optional(),
});

export const SessionStartEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('session_start'),
  source: z.string(),
  // Best-effort project label derived from the session's cwd. The CLI fills
  // this in on SessionStart (outermost git repo basename, falling back to
  // nearest package.json name, finally to basename(cwd)). Optional so older
  // CLIs that never emit it remain compatible.
  project_name: z.string().min(1).optional(),
});

export const UserPromptEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('user_prompt'),
  prompt: z.string(),
});

export const ToolAttemptEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('tool_attempt'),
  tool_name: z.string().min(1),
  tool_input: z.unknown(),
  tool_use_id: z.string().min(1),
});

export const ToolCallEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('tool_call'),
  tool_name: z.string().min(1),
  tool_input: z.unknown(),
  tool_response: z.unknown(),
  tool_use_id: z.string().min(1),
  duration_ms: z.number().nonnegative(),
  // Set by the CLI when the tool_response signals an error (Bash non-zero
  // exit, Edit/Write rejection, tool_response.is_error, etc.). Optional so
  // older CLI versions stay forward-compatible.
  is_error: z.boolean().optional(),
  error_message: z.string().optional(),
});

// Emitted by the CLI on Stop / PostToolUse after scanning the Claude Code
// transcript JSONL. One event per assistant message we haven't seen yet,
// keyed by message_uuid so re-deliveries dedupe at the server. Carries the
// model identifier and token usage for that turn — the only place either
// datum is available in Claude Code's emit chain.
export const AssistantTurnEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('assistant_turn'),
  message_uuid: z.string().min(1),
  model: z.string().min(1),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative().default(0),
  cache_creation_tokens: z.number().int().nonnegative().default(0),
  text: z.string().optional(),
});

export const SubagentEndEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('subagent_end'),
  agent_id: z.string().min(1),
  agent_type: z.string().min(1),
  agent_transcript_path: z.string().min(1),
  last_assistant_message: z.string(),
  stop_hook_active: z.boolean().optional(),
});

// Stop hook (fires every turn). Despite the literal name 'session_end', this
// is "turn end" semantically. Kept for backward compatibility with CLI <= 0.3.x.
// New CLIs still emit this; the server interprets it as "run is idle".
export const SessionEndEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('session_end'),
  last_assistant_message: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

// SessionEnd hook (fires once when Claude Code actually closes the session).
// Server uses this to promote the run from 'idle' to 'ended'.
export const SessionCloseEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('session_close'),
  reason: z.string().optional(),
});

export const RuntapeEvent = z.discriminatedUnion('type', [
  SessionStartEvent,
  UserPromptEvent,
  ToolAttemptEvent,
  ToolCallEvent,
  AssistantTurnEvent,
  SubagentEndEvent,
  SessionEndEvent,
  SessionCloseEvent,
]);

export type RuntapeEvent = z.infer<typeof RuntapeEvent>;

// POST /v1/events body — a batch of up to 100 events.
export const IngestionRequest = z.object({
  events: z.array(RuntapeEvent).min(1).max(100),
});

export type IngestionRequest = z.infer<typeof IngestionRequest>;

// Response shape (server returns 200 on accepted, 400 on Zod failure, 401 on bad auth).
export const IngestionResponse = z.object({
  accepted: z.number().int().nonnegative(),
  errors: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        reason: z.string(),
      }),
    )
    .default([]),
});

export type IngestionResponse = z.infer<typeof IngestionResponse>;
