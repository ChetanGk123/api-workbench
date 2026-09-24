import type { ContextBinding } from '../tester/expressions';
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
  settings: {
    bodyLimitKb: number;
    /** Module visibility. A module switched off here loses its tab, its Home card and its rules. */
    enabledModules: Record<string, boolean>;
    /** Traffic-log entries kept per rule module. Absent means DEFAULT_LOG_LIMIT. */
    logLimits?: Partial<Record<RuleKind, number>>;
    /** Intercept only: keep the response body beside a traffic-log entry. Off by default: it makes
     * the panel observe traffic, which reads every response body. */
    storeResponseBodies?: boolean;
    /** Roots the page scanner walks for globals; Test's Scan page starts from these. */
    globalRoots?: string[];
    /** Requests the recorder keeps in its draft. Absent means the recorder's own default. */
    recorderLimit?: number;
    /** Whether the recorder captures the workbench tester's own requests. */
    recorderIncludeTester?: boolean;
  };
};

export const DEFAULT_LOG_LIMIT = 50;
/** A module is on unless it was explicitly switched off, so an older profile keeps every module. */
export function moduleEnabled(profile: Profile, id: string): boolean {
  // An imported profile need not carry settings at all, and a missing switch means "on".
  return profile.settings?.enabledModules?.[id] !== false;
}

export function logLimit(profile: Profile, kind: RuleKind): number {
  const value = profile.settings.logLimits?.[kind];
  return typeof value === 'number' && value > 0 ? value : DEFAULT_LOG_LIMIT;
}

export type ProfileSnapshot = { profile: Profile; endpoints: Endpoint[]; rules?: Rule[]; plan?: TestPlan };
/** `plan` is the live plan; `savedPlans` are stored copies, each owned by the profile it names. */
export type WorkbenchConfig = { profile: Profile; endpoints: Endpoint[]; rules?: Rule[]; plan?: TestPlan; savedPlans?: TestPlan[]; savedProfiles?: ProfileSnapshot[] };

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

/**
 * Page host to profile base name: drop the TLD and `www`, dash-join what is left, so
 * `krushna.cooksbook.in` reads as `krushna-cooksbook`.
 */
export function nameFromHost(host: string): string {
  const trimmed = host.trim().replace(/\.$/, '');
  // localhost and bare IPs have no TLD to drop, so they keep their own name.
  if (!trimmed.includes('.') || /^[\d.]+$/.test(trimmed)) return trimmed;
  const labels = trimmed.split('.').filter(label => label && label !== 'www');
  labels.pop();
  // ponytail: a fixed list of second-level suffixes, not a public-suffix lookup
  if (labels.length > 1 && /^(co|com|net|org|ac|gov|edu)$/.test(labels.at(-1) ?? '')) labels.pop();
  return labels.join('-');
}

/** The current page's base name, or `Default` where there is no page (core tests, workers). */
export function pageProfileName(): string {
  return (typeof location === 'undefined' ? '' : nameFromHost(location.hostname)) || 'Default';
}

/** Appends `-2`, `-3`, ... until the name is free, so the profile list stays readable. */
export function suggestProfileName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(name => name.trim()));
  const root = base.trim() || pageProfileName();
  let name = root;
  for (let suffix = 2; used.has(name); suffix++) name = `${root}-${suffix}`;
  return name;
}

export function defaultProfile(): Profile {
  const now = Date.now();
  return {
    id: 'default', name: pageProfileName(), revision: 1, createdAt: now, updatedAt: now,
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

/** A new mock rule starts enabled: the user adds one to serve it, not to leave it off. */
export function defaultMockRule(profileId: string, seq: number): MockRule {
  return { ...ruleBase(profileId, seq, 'New mock rule'), enabled: true, kind: 'mock', mode: 'static', slots: [defaultMockSlot()], exhaustion: 'repeat-last' };
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

/**
 * A rule's default label. A renamed endpoint lends its name as is; one still carrying the recorded
 * `METHOD /path` is shortened to its last path segment, since every rule row already prints the
 * method and full URL beneath the label.
 */
export function labelFromEndpoint(endpoint: Endpoint): string {
  const name = endpoint.name.trim();
  const path = endpoint.request.path.split(/[?#]/)[0] ?? '';
  if (name && name !== `${endpoint.request.method} ${path}`) return name;
  const segments = path.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (!last) return name || endpoint.request.method;
  // A trailing id reads as nothing on its own, so it keeps the collection it belongs to.
  return /^\d+$/.test(last) && segments.length > 1 ? `${segments.at(-2)}/${last}` : last;
}

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

/**
 * A pause is enabled per stage. A request pause happens before any upstream dispatch; a response
 * pause happens after the upstream request has already completed, so it cannot undo a server-side
 * action.
 */
export type Breakpoints = { request: boolean; response: boolean };

export type InterceptRule = RuleBase & {
  kind: 'intercept';
  request: Transform;
  response: Transform;
  /** Optional: rules saved before M7 have no field, and pause at neither stage. */
  breakpoints?: Breakpoints;
};

/** Plan §8.5 defaults. Neither is user-configurable in v1. */
export const MAX_PAUSED_REQUESTS = 20;
export const PAUSE_DEADLINE_MS = 30_000;

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
  return {
    ...ruleBase(profileId, seq, 'New intercept rule'), kind: 'intercept',
    request: defaultTransform(), response: defaultTransform(), breakpoints: { request: false, response: false },
  };
}

export function defaultRouteRule(profileId: string, seq: number): RouteRule {
  return {
    ...ruleBase(profileId, seq, 'New page rule'), kind: 'route',
    matcher: { ...emptyMatcher(), method: '*', url: '/api/**' },
    matchOrigin: '', destinationOrigin: typeof location === 'undefined' ? '' : location.origin, pathRewrite: '', preservePath: true,
    credentials: 'same-origin', keepAuthorization: false,
  };
}

/* ── M8: test plans ────────────────────────────────────────────────────────── */

export type ExecutionStrategy = 'flow' | 'independent';
/** Setup runs once for the run; load repeats; skip keeps the endpoint out of this plan. */
export type StepPhase = 'setup' | 'load' | 'skip';
/** Direct uses the captured transport; rules routes tester traffic through the page pipeline. */
export type TesterMode = 'direct' | 'rules';

export type TestPlan = {
  id: string;
  profileId: string;
  name: string;
  strategy: ExecutionStrategy;
  mode: TesterMode;
  /** Endpoint ID to phase placement. An endpoint with no entry is a load step. */
  phases: Record<string, 'setup' | 'load'>;
  /** Endpoint IDs the plan lists but does not run. */
  excluded: string[];
  iterations: number;
  concurrency: number;
  /** Wait after a worker finishes one iteration or job, before it takes the next. */
  delayMs: number;
  rampUp: boolean;
  onFailure: 'continue' | 'stop';
  notifyOnComplete: boolean;
  /** Page values chosen with Scan page; resolved again at every dispatch. */
  bindings: ContextBinding[];
};

/** Suggested bounds, not platform guarantees: a browser tab is not a load generator. */
export const MAX_ITERATIONS = 1000;
export const MAX_CONCURRENCY = 20;
/** Workers are admitted this far apart while ramp-up is on. */
export const RAMP_STEP_MS = 250;
/** Retained run summaries, per section 8.11. */
export const MAX_RUN_SUMMARIES = 20;
/** Latency samples kept per endpoint; P95 is exact within this bound and labelled by count. */
export const MAX_SAMPLES_PER_ENDPOINT = 1000;

export function defaultTestPlan(profileId: string): TestPlan {
  return {
    id: createId('plan'), profileId, name: 'Working Plan', strategy: 'flow', mode: 'direct',
    phases: {}, excluded: [], iterations: 1, concurrency: 1, delayMs: 0, rampUp: false,
    onFailure: 'continue', notifyOnComplete: false, bindings: [],
  };
}

export function stepPhase(plan: TestPlan, endpointId: string): StepPhase {
  if (plan.excluded.includes(endpointId)) return 'skip';
  return plan.phases[endpointId] ?? 'load';
}
