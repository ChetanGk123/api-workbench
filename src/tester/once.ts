import { mergeHeaders, type Check, type Endpoint, type HeaderValue, type Profile } from '../core/model.ts';

export type OnceResult = {
  endpointId: string;
  outcome: 'passed' | 'failed-check' | 'blocked' | 'network-error';
  status?: number;
  durationMs: number;
  body: string;
  truncated: boolean;
  checks: Array<{ check: Check; state: 'passed' | 'failed' | 'not-evaluated'; detail: string }>;
  error?: string;
};

export type OnceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function resolveValue(value: string, variables: Record<string, string>): { value?: string; missing?: string } {
  let missing: string | undefined;
  const resolved = value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name: string) => {
    if (!(name in variables)) { missing = name; return ''; }
    return variables[name] ?? '';
  });
  return missing ? { missing } : { value: resolved };
}

function resolveUrl(endpoint: Endpoint, profile: Profile, variables: Record<string, string>): { url?: string; missing?: string } {
  const value = resolveValue(endpoint.request.path, variables);
  if (value.missing) return value;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value.value ?? '')) return { url: value.value };
  const configuredOrigin = profile.environments[profile.activeEnvironment]?.[endpoint.hostKey] ?? '';
  const origin = configuredOrigin || (typeof location !== 'undefined' ? location.origin : '');
  if (!origin) return { missing: `host:${endpoint.hostKey}` };
  return { url: new URL(value.value ?? '/', origin).href };
}

function getJsonPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.replace(/^\$\.?/, '').split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCheck(check: Check, status: number, headers: Headers, body: string, durationMs: number): { state: 'passed' | 'failed' | 'not-evaluated'; detail: string } {
  if (check.kind === 'status') {
    const passed = typeof check.value === 'number' ? status === check.value : status >= check.value.min && status <= check.value.max;
    return { state: passed ? 'passed' : 'failed', detail: `status ${status}` };
  }
  if (check.kind === 'header') {
    const actual = headers.get(check.name);
    const passed = actual !== null && (check.value === undefined || actual === check.value);
    return { state: passed ? 'passed' : 'failed', detail: actual === null ? `missing ${check.name}` : `${check.name}: ${actual}` };
  }
  if (check.kind === 'duration') return { state: durationMs <= check.maxMs ? 'passed' : 'failed', detail: `${durationMs} ms` };
  if (!body) return { state: 'not-evaluated', detail: 'response body omitted' };
  if (check.kind === 'body-contains') return { state: body.includes(check.value) ? 'passed' : 'failed', detail: `contains ${check.value}` };
  try {
    const json: unknown = JSON.parse(body);
    const actual = getJsonPath(json, check.path);
    if (check.mode === 'exists') return { state: actual === undefined ? 'failed' : 'passed', detail: check.path };
    if (check.mode === 'type') return { state: typeof actual === check.value ? 'passed' : 'failed', detail: `${check.path}: ${typeof actual}` };
    return { state: Object.is(actual, check.value) ? 'passed' : 'failed', detail: `${check.path}: ${String(actual)}` };
  } catch { return { state: 'not-evaluated', detail: 'response is not valid JSON' }; }
}

export async function executeOnce(endpoint: Endpoint, profile: Profile, fetcher: OnceFetch, variables: Record<string, string> = {}): Promise<OnceResult> {
  const started = performance.now();
  const target = resolveUrl(endpoint, profile, variables);
  if (target.missing) return { endpointId: endpoint.id, outcome: 'blocked', durationMs: 0, body: '', truncated: false, checks: [], error: `Unresolved variable or host: ${target.missing}` };
  const headerValues: HeaderValue[] = mergeHeaders(profile.globalHeaders, endpoint.request.headers);
  const headers = new Headers();
  for (const header of headerValues) {
    const resolved = resolveValue(header.value, variables);
    if (resolved.missing) return { endpointId: endpoint.id, outcome: 'blocked', durationMs: 0, body: '', truncated: false, checks: [], error: `Unresolved variable: ${resolved.missing}` };
    headers.set(header.name, resolved.value ?? '');
  }
  const requestBody = endpoint.request.bodyKind === 'none' ? undefined : resolveValue(endpoint.request.body, variables);
  if (requestBody?.missing) return { endpointId: endpoint.id, outcome: 'blocked', durationMs: 0, body: '', truncated: false, checks: [], error: `Unresolved variable: ${requestBody.missing}` };
  try {
    const response = await fetcher(target.url!, { method: endpoint.request.method, headers, body: requestBody?.value, credentials: endpoint.request.credentials });
    const raw = await response.text();
    const limit = Math.max(1, profile.settings.bodyLimitKb) * 1024;
    const body = raw.slice(0, limit);
    const durationMs = Math.round(performance.now() - started);
    const checks = endpoint.checks.map(check => ({ check, ...evaluateCheck(check, response.status, response.headers, body, durationMs) }));
    const outcome = checks.some(check => check.state === 'failed') ? 'failed-check' : 'passed';
    return { endpointId: endpoint.id, outcome, status: response.status, durationMs, body, truncated: raw.length > body.length, checks };
  } catch (error) {
    return { endpointId: endpoint.id, outcome: 'network-error', durationMs: Math.round(performance.now() - started), body: '', truncated: false, checks: [], error: error instanceof Error ? error.message : String(error) };
  }
}