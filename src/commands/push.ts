import { spawn } from 'node:child_process';
import { mapHookPayload } from '../lib/hook-mapping.js';
import { nextSequence } from '../lib/sequence.js';
import { appendEvent } from '../lib/buffer.js';
import { readConfig } from '../lib/config.js';
import { resolveCliBinPath } from '../lib/cli-bin.js';
import { readNewAssistantTurns, persistCursor } from '../lib/transcript.js';
import { readNewSubagentEvents, persistSubagentCursor } from '../lib/subagent-transcript.js';
import { isCaptureAllowed } from '../lib/watch.js';
import type { RuntapeEvent } from '../types.js';

function isDisabledByEnv(): boolean {
  // Surgical opt-out for individual sessions:
  //   `RUNTAPE_DISABLE=1 claude` skips capture entirely.
  // Accept `1`, `true`, `yes` (case-insensitive) so any reasonable truthy
  // value works. Empty / "0" / "false" → not disabled.
  const v = (process.env.RUNTAPE_DISABLE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function spawnFlusher(cliBinPath: string): void {
  // Detached so it survives this process exit. stdio:'ignore' so the daemon
  // doesn't inherit the hook's stdin/stdout (Claude Code reads hook stdout!).
  const child = spawn(cliBinPath, ['--internal-flusher'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

export async function pushCommand(opts: { event: string }): Promise<number> {
  // The contract is: never block the hook. If we can't parse/auth/whatever, exit 0 quietly
  // (printing to stderr is fine; printing to stdout could be parsed by Claude Code).
  try {
    // Earliest opt-out: env var fully bypasses the CLI. Cheap, no I/O.
    if (isDisabledByEnv()) return 0;

    const cfg = await readConfig();
    if (!cfg) {
      process.stderr.write('runtape: not logged in — skipping event\n');
      return 0;
    }

    const raw = await readStdin();
    if (!raw.trim()) {
      // SessionStart in some Claude Code versions may invoke hooks with no stdin; ignore.
      return 0;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      process.stderr.write(`runtape: invalid JSON on stdin: ${err instanceof Error ? err.message : String(err)}\n`);
      return 0;
    }

    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
    if (!sessionId) {
      process.stderr.write('runtape: missing session_id on hook payload\n');
      return 0;
    }

    // Watch list gate: if the user has configured allow_list / deny_list and
    // this cwd doesn't pass, silently no-op the hook. Nothing hits the buffer,
    // nothing flushes — the server never sees a byte from this session.
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
    if (cwd && !isCaptureAllowed(cfg.watch, cwd)) {
      return 0;
    }

    const sequence = await nextSequence(sessionId);
    const result = mapHookPayload(opts.event, payload, {
      wall_ts: new Date().toISOString(),
      sequence,
    });

    if (result.kind === 'drop') {
      // Notification, unknown hook, or validation failure. Quiet log + exit clean.
      process.stderr.write(`runtape: dropped ${opts.event}: ${result.reason}\n`);
      return 0;
    }

    await appendEvent(sessionId, result.event);

    // After the primary event lands in the buffer, scan the transcript for any
    // new assistant turns and emit one assistant_turn event per uuid we haven't
    // seen. PostToolUse and Stop are the hooks that follow assistant output;
    // scanning on other hooks is cheap (no new turns) and harmless.
    if (opts.event === 'PostToolUse' || opts.event === 'Stop' || opts.event === 'SubagentStop') {
      const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
      if (transcriptPath !== '') {
        try {
          const { turns, seen } = await readNewAssistantTurns(sessionId, transcriptPath);
          const newlyEmitted: string[] = [];
          for (const t of turns) {
            const seq = await nextSequence(sessionId);
            const ev: RuntapeEvent = {
              type: 'assistant_turn',
              session_id: sessionId,
              transcript_path: transcriptPath,
              cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
              hook_event_name: opts.event,
              permission_mode: typeof payload.permission_mode === 'string' ? payload.permission_mode : undefined,
              wall_ts: new Date().toISOString(),
              sequence: seq,
              message_uuid: t.message_uuid,
              model: t.model,
              input_tokens: t.input_tokens,
              output_tokens: t.output_tokens,
              cache_read_tokens: t.cache_read_tokens,
              cache_creation_tokens: t.cache_creation_tokens,
              text: t.text,
            };
            await appendEvent(sessionId, ev);
            newlyEmitted.push(t.message_uuid);
          }
          if (newlyEmitted.length > 0) {
            await persistCursor(sessionId, seen, newlyEmitted);
          }
        } catch (err) {
          // Transcript scan failures must never fail the hook.
          process.stderr.write(`runtape: transcript scan failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    }

    // On SubagentStop, ALSO scan the subagent's own transcript and synthesize
    // the full event stream of its internal session — user prompt, assistant
    // turns with model+usage, plus tool_attempt/tool_call pairs. Tag every
    // synthesized event with agent_tool_use_id so the server can resolve the
    // parent Agent step and stamp parent_step_id deterministically.
    if (opts.event === 'SubagentStop') {
      const subTranscript = typeof payload.agent_transcript_path === 'string' ? payload.agent_transcript_path : '';
      const agentToolUseId = typeof payload.agent_id === 'string' ? payload.agent_id : '';
      if (subTranscript !== '' && agentToolUseId !== '') {
        try {
          const { emits, seen } = await readNewSubagentEvents(sessionId, agentToolUseId, subTranscript);
          const newlyEmitted: string[] = [];
          const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
          for (const e of emits) {
            const seq = await nextSequence(sessionId);
            const baseEnvelope = {
              session_id: sessionId,
              transcript_path: subTranscript,
              cwd,
              hook_event_name: opts.event,
              permission_mode: typeof payload.permission_mode === 'string' ? payload.permission_mode : undefined,
              wall_ts: new Date().toISOString(),
              sequence: seq,
              agent_tool_use_id: agentToolUseId,
            };
            let ev: RuntapeEvent | null = null;
            if (e.kind === 'user_prompt') {
              ev = { ...baseEnvelope, type: 'user_prompt', prompt: e.prompt };
            } else if (e.kind === 'assistant_turn') {
              ev = {
                ...baseEnvelope,
                type: 'assistant_turn',
                message_uuid: e.message_uuid,
                model: e.model,
                input_tokens: e.input_tokens,
                output_tokens: e.output_tokens,
                cache_read_tokens: e.cache_read_tokens,
                cache_creation_tokens: e.cache_creation_tokens,
                text: e.text,
              };
            } else if (e.kind === 'tool_attempt') {
              ev = {
                ...baseEnvelope,
                type: 'tool_attempt',
                tool_name: e.tool_name,
                tool_input: e.tool_input,
                tool_use_id: e.tool_use_id,
              };
            } else if (e.kind === 'tool_call') {
              ev = {
                ...baseEnvelope,
                type: 'tool_call',
                tool_name: e.tool_name,
                tool_input: null,
                tool_response: e.tool_response,
                tool_use_id: e.tool_use_id,
                duration_ms: 0,
                is_error: e.is_error,
                error_message: e.error_message,
              };
            }
            if (ev) {
              await appendEvent(sessionId, ev);
              newlyEmitted.push(e.uuid);
            }
          }
          if (newlyEmitted.length > 0) {
            await persistSubagentCursor(sessionId, agentToolUseId, seen, newlyEmitted);
          }
        } catch (err) {
          process.stderr.write(`runtape: subagent transcript scan failed: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    }

    spawnFlusher(resolveCliBinPath());
    return 0;
  } catch (err) {
    process.stderr.write(`runtape: push error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 0; // Never fail the hook.
  }
}
