import type { Pipeline, TrafficEvent } from '../network/pipeline';
import type { ContextSource } from '../tester/expressions';

/**
 * Where a redacted header's value was found on the page, so the request can be rebuilt later from
 * the live value. The value itself is never part of this: only its address and the scheme word in
 * front of it, such as `Bearer `.
 */
export type CredentialSource = Readonly<{ source: ContextSource; key: string; prefix: string }>;

export type Recording = Readonly<{
  id: string;
  method: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  /** Redacted header name -> where its value came from, for the headers that could be traced. */
  credentials?: Readonly<Record<string, CredentialSource>>;
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
/** The bounds Settings reports, so the panel quotes the numbers this file actually applies. */
export const BODY_LIMIT = 16 * 1024;
export const RECOVERY_LIMIT = 1024 * 1024;
export const DEFAULT_RECORD_LIMIT = 100;
const RECOVERY_KEY = 'api-workbench-recorder-draft-v1';

function redactHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE_HEADER.test(name) ? '[REDACTED]' : value])));
}

/** A scheme word and one space, or nothing: anything else in front of the value is not a label. */
const SCHEME = /^[A-Za-z]* ?$/;
const MIN_SECRET = 8;

/** Every page value a binding could read back, as [source, key, value]. Getters are never called. */
function pageValues(): Array<[ContextSource, string, string]> {
  const found: Array<[ContextSource, string, string]> = [];
  for (const [store, source] of [[localStorage, 'local'], [sessionStorage, 'session']] as const) {
    try {
      for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        const value = key == null ? null : store.getItem(key);
        if (key != null && value) found.push([source, key, value]);
      }
    } catch { /* Storage can be blocked; the other sources still resolve. */ }
  }
  try {
    for (const part of document.cookie.split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key && value) found.push(['cookie', key, value]);
    }
  } catch { /* Cookie access can throw in a sandboxed frame. */ }
  return found;
}

/**
 * Finds a redacted header's value on the page so it can be read again at send time. The header must
 * END with a stored value — `Bearer <token>` — so whatever precedes it is a scheme word, not a
 * second secret. Nothing here is stored but the source, the key and that word.
 */
function locateCredential(value: string): CredentialSource | undefined {
  for (const [source, key, stored] of pageValues()) {
    if (stored.length < MIN_SECRET || !value.endsWith(stored)) continue;
    const prefix = value.slice(0, value.length - stored.length);
    if (SCHEME.test(prefix)) return Object.freeze({ source, key, prefix });
  }
  return undefined;
}

function credentialSources(headers: Readonly<Record<string, string>>): Record<string, CredentialSource> | undefined {
  const sources: Record<string, CredentialSource> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADER.test(name) || !value) continue;
    // A cookie header is not replayed from a binding: the browser attaches cookies itself.
    if (/^(cookie|set-cookie)$/i.test(name)) continue;
    const located = locateCredential(value);
    if (located) sources[name.toLowerCase()] = located;
  }
  return Object.keys(sources).length ? Object.freeze(sources) : undefined;
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
    credentials: credentialSources(event.request.headers),
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
  let limit = DEFAULT_RECORD_LIMIT;
  const records: Recording[] = [];
  try {
    const recovered = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? 'null') as unknown;
    if (Array.isArray(recovered)) {
      for (const item of recovered.filter(value => value && typeof value === 'object').slice(-limit) as Recording[]) {
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
    if (!active || (!includeTester && event.request.fromTester)) return;
    const record = toRecording(event);
    const size = JSON.stringify(record).length;
    if (size > RECOVERY_LIMIT || bytes + size > RECOVERY_LIMIT) return;
    records.push(record);
    bytes += size;
    trim();
    persist();
    onChange?.(records.slice());
  };

  const trim = () => {
    while (records.length > limit) {
      const removed = records.shift();
      bytes -= removed ? JSON.stringify(removed).length : 0;
    }
  };

  return {
    get active() { return active; },
    get includeTester() { return includeTester; },
    get records() { return records.slice(); },
    /** Resume-storage bytes the draft occupies, against RECOVERY_LIMIT. */
    get bytes() { return bytes; },
    get limit() { return limit; },
    /** The profile's cap on kept requests; lowering it drops the oldest immediately. */
    setLimit(next: number) {
      limit = Math.max(1, Math.round(next) || DEFAULT_RECORD_LIMIT);
      if (records.length > limit) { trim(); persist(); onChange?.(records.slice()); }
    },
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