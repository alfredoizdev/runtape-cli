import type { HindsightEvent } from '../types.js';

export type PostResult =
  | { ok: true; accepted: number; errors: Array<{ index: number; reason: string }> }
  | { ok: false; status: number; error: string; retryable: boolean };

function isRetryableStatus(status: number): boolean {
  // 408 timeout, 425 too-early, 429 rate-limited, 5xx — retry. 4xx — drop (poison).
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function postEvents(
  serverUrl: string,
  apiKey: string,
  events: HindsightEvent[],
): Promise<PostResult> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ events }),
    });
  } catch (err) {
    // Network failure (ENOTFOUND, ECONNREFUSED, fetch abort). Retryable.
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }

  if (response.ok) {
    const body = (await response.json()) as {
      accepted: number;
      errors: Array<{ index: number; reason: string }>;
    };
    return { ok: true, accepted: body.accepted, errors: body.errors };
  }

  let detail = '';
  try {
    detail = await response.text();
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    status: response.status,
    error: detail || response.statusText,
    retryable: isRetryableStatus(response.status),
  };
}

export async function pingProject(serverUrl: string, apiKey: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  // We don't have a dedicated /me endpoint yet (we may add one in Task 3b).
  // For now, "ping" = POST /api/v1/events with an empty events array and inspect the response.
  // Server returns 400 invalid_request_body (events must be ≥1) on success — that proves auth works.
  // 401 = bad key; 5xx = server problem.
  let response: Response;
  try {
    response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ events: [] }),
    });
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) };
  }

  if (response.status === 400) return { ok: true, status: 400 };
  if (response.status === 401) return { ok: false, status: 401, detail: 'invalid api key' };
  return { ok: false, status: response.status, detail: response.statusText };
}
