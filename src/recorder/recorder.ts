import type { Pipeline, TrafficEvent } from '../network/pipeline';

export type Recording = Readonly<{
  id: string;
  method: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  bodyStatus: 'captured' | 'omitted' | 'truncated' | 'unreadable';
  response?: { status: number; headers: Readonly<Record<string, string>>; body?: string; bodyStatus: 'captured' | 'omitted' | 'truncated' | 'unreadable' };
  durationMs: number;
  source: TrafficEvent['source'];
  error?: string;
  ruleIds: readonly string[];
  at: number;
}>;

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token)$/i;
const BODY_LIMIT = 16 * 1024;
const RECOVERY_LIMIT = 1024 * 1024;
const RECOVERY_KEY = 'api-workbench-recorder-draft-v1';

function redactHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE_HEADER.test(name) ? '[REDACTED]' : value])));
}

function boundedBody(body: string | undefined, hintedStatus?: Recording['bodyStatus']): { body?: string; status: Recording['bodyStatus'] } {
  if (body == null) return { status: 'omitted' };
  if (hintedStatus === 'unreadable') return { status: 'unreadable' };
  if (hintedStatus === 'truncated') return { body: body.slice(0, BODY_LIMIT), status: 'truncated' };
  if (body.length > BODY_LIMIT) return { body: body.slice(0, BODY_LIMIT), status: 'truncated' };
  return { body, status: 'captured' };
}

function toRecording(event: TrafficEvent): Recording {
  const requestBody = boundedBody(event.request.body);
  const responseBody = event.response?.body == null ? { status: event.response?.bodyStatus ?? 'omitted' as const } : boundedBody(event.response.body, event.response.bodyStatus);
  return Object.freeze({
    id: `recording-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    method: event.request.method,
    url: event.request.url,
    headers: redactHeaders(event.request.headers),
    body: requestBody.body,
    bodyStatus: requestBody.status,
    response: event.response ? Object.freeze({ status: event.response.status, headers: redactHeaders(event.response.headers), body: responseBody.body, bodyStatus: responseBody.status }) : undefined,
    durationMs: event.durationMs,
    source: event.source,
    error: event.error,
    ruleIds: Object.freeze([...event.ruleIds]),
    at: Date.now(),
  });
}

export function createRecorder(pipeline: Pipeline, onChange?: (records: readonly Recording[]) => void) {
  let active = false;
  let includeTester = false;
  let bytes = 0;
  const records: Recording[] = [];
  try {
    const recovered = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? 'null') as unknown;
    if (Array.isArray(recovered)) {
      for (const item of recovered.filter(value => value && typeof value === 'object').slice(-100) as Recording[]) {
        const size = JSON.stringify(item).length;
        if (bytes + size > RECOVERY_LIMIT) break;
        records.push(item);
        bytes += size;
      }
    }
  } catch { /* Recovery is best effort and must not block the workbench. */ }
  let stopObserving = () => {};

  const persist = () => {
    try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(records)); } catch { /* Quota or unavailable storage leaves the live draft usable. */ }
  };

  const add = (event: TrafficEvent) => {
    if (!active || (!includeTester && event.request.url.startsWith('workbench://tester'))) return;
    const record = toRecording(event);
    const size = JSON.stringify(record).length;
    if (size > RECOVERY_LIMIT || bytes + size > RECOVERY_LIMIT) return;
    records.push(record);
    bytes += size;
    while (records.length > 100) {
      const removed = records.shift();
      bytes -= removed ? JSON.stringify(removed).length : 0;
    }
    persist();
    onChange?.(records.slice());
  };

  return {
    get active() { return active; },
    get includeTester() { return includeTester; },
    get records() { return records.slice(); },
    start(options: { includeTester?: boolean } = {}) {
      if (active) return false;
      includeTester = options.includeTester ?? false;
      active = true;
      stopObserving = pipeline.observe(add);
      return true;
    },
    stop() {
      if (!active) return records.slice();
      active = false;
      stopObserving();
      stopObserving = () => {};
      persist();
      onChange?.(records.slice());
      return records.slice();
    },
    reset() {
      records.length = 0;
      bytes = 0;
      persist();
      onChange?.(records.slice());
    },
    dispose() {
      active = false;
      stopObserving();
      stopObserving = () => {};
      records.length = 0;
      bytes = 0;
      onChange?.(records.slice());
    },
  };
}