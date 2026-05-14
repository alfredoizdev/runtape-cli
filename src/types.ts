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
const CliAugment = z.object({
  wall_ts: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
});

export const SessionStartEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('session_start'),
  source: z.string(),
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
});

export const SubagentEndEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('subagent_end'),
  agent_id: z.string().min(1),
  agent_type: z.string().min(1),
  agent_transcript_path: z.string().min(1),
  last_assistant_message: z.string(),
  stop_hook_active: z.boolean().optional(),
});

export const SessionEndEvent = ClaudeHookBase.extend(CliAugment.shape).extend({
  type: z.literal('session_end'),
  last_assistant_message: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

export const HindsightEvent = z.discriminatedUnion('type', [
  SessionStartEvent,
  UserPromptEvent,
  ToolAttemptEvent,
  ToolCallEvent,
  SubagentEndEvent,
  SessionEndEvent,
]);

export type HindsightEvent = z.infer<typeof HindsightEvent>;

// POST /v1/events body — a batch of up to 100 events.
export const IngestionRequest = z.object({
  events: z.array(HindsightEvent).min(1).max(100),
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
