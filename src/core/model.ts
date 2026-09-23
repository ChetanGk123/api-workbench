export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyKind = 'none' | 'text' | 'json' | 'urlencoded';
export type Check =
  | { kind: 'status'; value: number | { min: number; max: number } }
  | { kind: 'header'; name: string; value?: string }
  | { kind: 'body-contains'; value: string }
  | { kind: 'json'; path: string; mode: 'equals' | 'exists' | 'type'; value?: string | number | boolean | null }
  | { kind: 'duration'; maxMs: number };

export type HeaderValue = { name: string; value: string; removed?: boolean };

export type RequestTemplate = {
  method: HttpMethod;
  path: string;
  headers: HeaderValue[];
  bodyKind: BodyKind;
  body: string;
  credentials: RequestCredentials;
};

export type Endpoint = {
  id: string;
  profileId: string;
  alias: string;
  name: string;
  hostKey: string;
  request: RequestTemplate;
  checks: Check[];
  sampleResponse?: { status: number; headers: HeaderValue[]; body: string };
  createdAt: number;
  updatedAt: number;
};

export type Profile = {
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  environments: Record<string, Record<string, string>>;
  activeEnvironment: string;
  globalHeaders: HeaderValue[];
  settings: { bodyLimitKb: number; enabledModules: Record<string, boolean> };
};

export type ProfileSnapshot = { profile: Profile; endpoints: Endpoint[]; rules?: Rule[] };
export type WorkbenchConfig = { profile: Profile; endpoints: Endpoint[]; rules?: Rule[]; savedProfiles?: ProfileSnapshot[] };

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeHeaderName(name: string): string { return name.trim().toLowerCase(); }

export function mergeHeaders(globalHeaders: HeaderValue[], localHeaders: HeaderValue[]): HeaderValue[] {
  const merged = new Map<string, HeaderValue>();
  for (const header of globalHeaders) if (!header.removed && normalizeHeaderName(header.name)) merged.set(normalizeHeaderName(header.name), { ...header });
  for (const header of localHeaders) {
    const key = normalizeHeaderName(header.name);
    if (!key) continue;
    if (header.removed) merged.delete(key); else merged.set(key, { ...header, name: header.name.trim() });
  }
  return [...merged.values()];
}

export function defaultProfile(): Profile {
  const now = Date.now();
  return {
    id: 'default', name: 'Default', revision: 1, createdAt: now, updatedAt: now,
    environments: { default: { default: '' } }, activeEnvironment: 'default',
    globalHeaders: [],
    settings: { bodyLimitKb: 1024, enabledModules: { test: true, mock: true, intercept: true, route: true, chaos: true } },
  };
}

export function defaultEndpoint(profileId: string): Endpoint {
  const now = Date.now();
  return {
    id: createId('endpoint'), profileId, alias: 'new_endpoint', name: 'New endpoint', hostKey: 'default',
    request: { method: 'GET', path: '/', headers: [], bodyKind: 'none', body: '', credentials: 'same-origin' },
    checks: [{ kind: 'status', value: { min: 200, max: 299 } }], createdAt: now, updatedAt: now,
  };
}

/* ── M5: mock and chaos rules ──────────────────────────────────────────────── */

export type RuleMatcher = {
  method: string;
  url: string;
  /** `k=v&k2=v2`; a named key with a value matches any occurrence of that value. */
  query: string;
  /** `k=v&k2=v2`; header names match case-insensitively. */
  headers: string;
  /** Literal substring on a bounded, available text body. */
  bodyContains: string;
};

export type RuleBase = {
  id: string;
  profileId: string;
  label: string;
  endpointId?: string;
  enabled: boolean;
  priority: number;
  /** Creation sequence; ties on priority resolve by this, then by id. */
  seq: number;
  /** Bumped on every save. Sequence cursors are keyed by it, so an edit restarts the sequence. */
  revision: number;
  matcher: RuleMatcher;
};

export type MockSlot = {
  status: number;
  /** `Name: Value`, one per line. */
  headers: string;
  body: string;
  delayMs: number;
  fault: 'none' | 'network-error' | 'timeout';
};

export type MockRule = RuleBase & {
  kind: 'mock';
  mode: 'static' | 'sequence';
  slots: MockSlot[];
  exhaustion: 'repeat-last' | 'loop' | 'network-error';
};

export type ChaosFault =
  | { kind: 'status'; status: number; body: string }
  | { kind: 'latency'; delayMs: number }
  | { kind: 'random-latency'; minMs: number; maxMs: number }
  | { kind: 'network-error' }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'malformed-json' }
  | { kind: 'replay'; copies: number; gapMs: number };

export type ChaosRule = RuleBase & {
  kind: 'chaos';
  mode: 'synthetic' | 'real';
  fault: ChaosFault;
  /** 0–100. Sampled once per request for the selected rule. */
  probability: number;
  /** Empty means an unseeded sample. */
  seed: string;
  /** 0 means no budget. */
  budget: number;
  /** Real traffic only: a delay before the request is dispatched. */
  preDelayMs: number;
};

export const CHAOS_FAULTS = [
  'status',
  'latency',
  'random-latency',
  'network-error',
  'timeout',
  'malformed-json',
  'replay',
] as const;

/** v1 bound from the plan: a replay rule dispatches the primary request plus at most 2 copies. */
export const MAX_REPLAY_COPIES = 2;

export function emptyMatcher(): RuleMatcher {
  return { method: 'GET', url: '/api/', query: '', headers: '', bodyContains: '' };
}

function ruleBase(profileId: string, seq: number, label: string): RuleBase {
  return { id: createId('rule'), profileId, label, enabled: false, priority: 0, seq, revision: 1, matcher: emptyMatcher() };
}

export function defaultMockSlot(): MockSlot {
  return { status: 200, headers: 'Content-Type: application/json', body: '{}', delayMs: 0, fault: 'none' };
}

export function defaultMockRule(profileId: string, seq: number): MockRule {
  return { ...ruleBase(profileId, seq, 'New mock rule'), kind: 'mock', mode: 'static', slots: [defaultMockSlot()], exhaustion: 'repeat-last' };
}

export function defaultChaosRule(profileId: string, seq: number): ChaosRule {
  return {
    ...ruleBase(profileId, seq, 'New chaos rule'), kind: 'chaos', mode: 'synthetic',
    fault: { kind: 'status', status: 500, body: '' }, probability: 100, seed: '', budget: 0, preDelayMs: 0,
  };
}

export const CHAOS_PRESETS: Record<string, (rule: ChaosRule) => ChaosRule> = {
  // "Slow API" defaults to real-traffic response-delivery latency, per the plan.
  'Slow API': rule => ({ ...rule, label: 'Slow API', mode: 'real', fault: { kind: 'latency', delayMs: 1000 } }),
  'Very slow API': rule => ({ ...rule, label: 'Very slow API', mode: 'real', fault: { kind: 'latency', delayMs: 5000 } }),
  'Random latency': rule => ({ ...rule, label: 'Random latency', mode: 'real', fault: { kind: 'random-latency', minMs: 250, maxMs: 2000 } }),
  'Server error 500': rule => ({ ...rule, label: 'Server error 500', mode: 'synthetic', fault: { kind: 'status', status: 500, body: '' } }),
  'Service unavailable 503': rule => ({ ...rule, label: 'Service unavailable 503', mode: 'synthetic', fault: { kind: 'status', status: 503, body: '' } }),
  'Bad gateway 502': rule => ({ ...rule, label: 'Bad gateway 502', mode: 'synthetic', fault: { kind: 'status', status: 502, body: '' } }),
  'Timeout': rule => ({ ...rule, label: 'Timeout', mode: 'synthetic', fault: { kind: 'timeout', timeoutMs: 3000 } }),
  'Network failure': rule => ({ ...rule, label: 'Network failure', mode: 'synthetic', fault: { kind: 'network-error' } }),
  'Malformed JSON': rule => ({ ...rule, label: 'Malformed JSON', mode: 'synthetic', fault: { kind: 'malformed-json' } }),
  'Request replay': rule => ({ ...rule, label: 'Request replay', mode: 'real', fault: { kind: 'replay', copies: 1, gapMs: 0 } }),
};

/** A rule derived from an endpoint copies its method and path; editing either detaches on save. */
export function matcherFromEndpoint(endpoint: Endpoint): RuleMatcher {
  return { ...emptyMatcher(), method: endpoint.request.method, url: endpoint.request.path };
}

/* ── M6: intercept and route rules ─────────────────────────────────────────── */

/** RFC 6902 operation. The UI's "Nullify" is a convenience that emits `replace` with `null`. */
export type PatchOp = { op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'; path: string; value?: unknown; from?: string };

export type BodyReplace = { find: string; replace: string; scope: 'first' | 'all' };

export type Transform = {
  /** `Name: Value`, one per line. */
  setHeaders: string;
  /** One header name per line. */
  removeHeaders: string;
  /** Applied in listed order on an isolated value; committed only if all succeed. */
  patch: PatchOp[];
  /** Literal find/replace on a supported text body. No regular expressions. */
  body: BodyReplace;
  /** Response stage only. 0 keeps the original status. */
  status: number;
};

export type InterceptRule = RuleBase & { kind: 'intercept'; request: Transform; response: Transform };

export type RouteRule = RuleBase & {
  kind: 'route';
  /** Blank matches this document's origin. */
  matchOrigin: string;
  destinationOrigin: string;
  /** Blank falls back to `preservePath`; a rewrite always takes precedence. */
  pathRewrite: string;
  preservePath: boolean;
  credentials: RequestCredentials;
  /** A cross-origin route drops Authorization unless this is set for that destination. */
  keepAuthorization: boolean;
};

export type Rule = MockRule | ChaosRule | InterceptRule | RouteRule;
export type RuleKind = Rule['kind'];
export const RULE_KINDS = ['mock', 'chaos', 'intercept', 'route'] as const;

/**
 * Forbidden request header names: the browser refuses them, so a rule that sets one is a
 * validation error rather than an edit that appears to succeed.
 */
export const FORBIDDEN_REQUEST_HEADERS = [
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
];

export function forbiddenRequestHeader(name: string): boolean {
  const key = name.trim().toLowerCase();
  return FORBIDDEN_REQUEST_HEADERS.includes(key) || key.startsWith('proxy-') || key.startsWith('sec-');
}

export function defaultTransform(): Transform {
  return { setHeaders: '', removeHeaders: '', patch: [], body: { find: '', replace: '', scope: 'first' }, status: 0 };
}

export function defaultInterceptRule(profileId: string, seq: number): InterceptRule {
  return { ...ruleBase(profileId, seq, 'New intercept rule'), kind: 'intercept', request: defaultTransform(), response: defaultTransform() };
}

export function defaultRouteRule(profileId: string, seq: number): RouteRule {
  return {
    ...ruleBase(profileId, seq, 'New page rule'), kind: 'route',
    matcher: { ...emptyMatcher(), method: '*', url: '/api/**' },
    matchOrigin: '', destinationOrigin: typeof location === 'undefined' ? '' : location.origin, pathRewrite: '', preservePath: true,
    credentials: 'same-origin', keepAuthorization: false,
  };
}
