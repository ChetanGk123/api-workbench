export const mockBody = JSON.stringify({ source: 'workbench', message: 'Mock response — café ✓' });

export type RequestKind = 'fetch' | 'xhr';

export type BodyAnalysis = Readonly<{
  kind: 'text' | 'omitted';
  preview: string;
  truncated: boolean;
  length: number;
}>;

export type RequestContext = Readonly<{
  kind: RequestKind;
  method: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal?: AbortSignal;
}>;

export type RuleCondition = {
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: string;
};

export type PipelineRule = {
  id: string;
  enabled: boolean;
  priority: number;
  created: number;
  method: string;
  url: string;
  delay?: number;
  condition?: RuleCondition;
};

export type PipelineDecision = {
  provider: 'mock';
  ruleId: string;
  delay: number;
  why: string;
};

export type TraceEvent = {
  id: string;
  kind: 'request' | 'response' | 'abort' | 'error';
  transport: string;
  context: RequestContext;
  decision: PipelineDecision | null;
  at: number;
  detail?: string;
};

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index] ?? '';
    const next = pattern[index + 1] ?? '';
    if (char === '*') {
      if (next === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`, 'i');
}

function getPathname(url: string): string {
  if (/^[a-z]+:\/\//i.test(url)) return new URL(url).pathname;
  const withoutHash = url.split('#')[0] ?? '';
  const queryIndex = withoutHash.indexOf('?');
  return queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
}

function getSearch(url: string): string {
  if (/^[a-z]+:\/\//i.test(url)) return new URL(url).search;
  const withoutHash = url.split('#')[0] ?? '';
  const queryIndex = withoutHash.indexOf('?');
  return queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';
}

function matchUrl(pattern: string, url: string): boolean {
  const target = /^[a-z]+:\/\//i.test(url) ? new URL(url).href : url;
  if (/^[a-z]+:\/\//i.test(pattern)) {
    return globToRegExp(pattern).test(target);
  }
  const pathname = getPathname(url);
  return globToRegExp(pattern).test(pathname) || globToRegExp(pattern).test(target);
}

function normalizeHeaders(all: Headers | Record<string, string> | { headers?: Record<string, string> } | undefined): Record<string, string> {
  if (!all) return {};
  if (all instanceof Headers) return Object.fromEntries(all.entries());
  if ('headers' in all && all.headers && typeof all.headers === 'object') {
    return normalizeHeaders(all.headers as Record<string, string>);
  }
  return Object.fromEntries(Object.entries(all).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function matchHeaders(headers: Record<string, string> | undefined, all: HeaderBag): boolean {
  if (!headers) return true;
  const source = normalizeHeaders(all);
  for (const [name, expected] of Object.entries(headers)) {
    const value = source[name.toLowerCase()] ?? source[name] ?? source[name.toUpperCase()];
    if (value == null || String(value).toLowerCase() !== String(expected).toLowerCase()) {
      return false;
    }
  }
  return true;
}

export function createRequestContext(input: {
  kind: RequestKind;
  method: string;
  url: string;
  headers?: HeaderBag;
  body?: string | Blob | FormData | URLSearchParams | ArrayBuffer | null;
  signal?: AbortSignal;
}): RequestContext {
  const normalizedHeaders = normalizeHeaders(input.headers ?? {});
  const bodyValue = typeof input.body === 'string' ? input.body : undefined;
  return Object.freeze({
    kind: input.kind,
    method: input.method.toUpperCase(),
    url: input.url,
    headers: Object.freeze(normalizedHeaders),
    body: bodyValue,
    signal: input.signal,
  });
}

function matchQuery(query: Record<string, string | string[]> | undefined, url: string): boolean {
  if (!query) return true;
  const params = /^[a-z]+:\/\//i.test(url) ? new URL(url).searchParams : new URLSearchParams(getSearch(url));
  for (const [key, expected] of Object.entries(query)) {
    const values = params.getAll(key);
    const list = Array.isArray(expected) ? expected : [expected];
    if (values.length === 0) return false;
    if (!values.some(value => list.some(candidate => value === candidate))) return false;
  }
  return true;
}

type HeaderBag = Headers | Record<string, string> | { headers?: Record<string, string> } | undefined;

function matchCondition(rule: PipelineRule, url: string, requestHeaders?: HeaderBag): boolean {
  const condition = rule.condition;
  if (!condition) return true;
  if (!matchUrl(rule.url, url)) return false;
  if (!matchHeaders(condition.headers, requestHeaders)) return false;
  if (!matchQuery(condition.query, url)) return false;
  if (condition.body) {
    const body = requestHeaders instanceof Headers ? requestHeaders.get('x-body') ?? '' : '';
    if (!body.includes(condition.body)) return false;
  }
  return true;
}

export function createPipeline(report: (message: string) => void) {
  let active = true;
  const settings = { enabled: false, delay: 0 };
  const pending = new Set<() => void>();
  const rules: PipelineRule[] = [];
  const trace: TraceEvent[] = [];
  let nextId = 1;
  let traceIndex = 0;

  const addRule = (rule: Partial<PipelineRule> & Pick<PipelineRule, 'url'>): PipelineRule => {
    const normalized: PipelineRule = {
      id: rule.id ?? `rule-${nextId++}`,
      enabled: rule.enabled ?? true,
      priority: rule.priority ?? 0,
      created: rule.created ?? Date.now() + nextId,
      method: (rule.method ?? '*').toUpperCase(),
      url: rule.url,
      delay: rule.delay ?? settings.delay,
      condition: rule.condition,
    };
    rules.push(normalized);
    return normalized;
  };

  const addTrace = (kind: TraceEvent['kind'], context: RequestContext, transport: string, decision: PipelineDecision | null, detail?: string) => {
    const entry: TraceEvent = {
      id: `trace-${++traceIndex}`,
      kind,
      transport,
      context,
      decision,
      at: Date.now(),
      detail,
    };
    trace.push(entry);
    if (trace.length > 64) trace.shift();
    report(`${transport} ${context.method} · ${kind}${detail ? ` · ${detail}` : ''}`);
    return entry;
  };

  const resolveRule = (context: RequestContext, transport: string): PipelineDecision | null => {
    const { method, url, headers } = context;
    const candidates = [...rules].filter(rule => rule.enabled).sort((left, right) => {
      if (right.priority !== left.priority) return (right.priority ?? 0) - (left.priority ?? 0);
      if (left.created !== right.created) return left.created - right.created;
      return left.id.localeCompare(right.id);
    });

    for (const rule of candidates) {
      const methodName = rule.method === '*' ? method.toUpperCase() : rule.method;
      if (methodName !== method) continue;
      if (!matchCondition(rule, url, headers)) continue;
      const delay = rule.delay ?? settings.delay;
      const reason = `${transport} ${method} · matched ${rule.id} · ${url.slice(0, 180)}`;
      return { provider: 'mock', ruleId: rule.id, delay, why: `matched ${rule.id} (${rule.priority})` };
    }

    if (!active) return null;
    const legacy = settings.enabled && method === 'GET' && getPathname(url) === '/api/mock-target' && getSearch(url) === '';
    const message = `${transport} ${method} · ${legacy ? 'mock / no network' : 'network'} · ${url.slice(0, 180)}`;
    return legacy ? { provider: 'mock', ruleId: 'legacy-m0', delay: settings.delay, why: 'legacy M0 matcher' } : null;
  };

  const analyzeBody = (body: unknown, contentType?: string | null): BodyAnalysis => {
    if (body == null) return { kind: 'omitted', preview: '', truncated: false, length: 0 };
    if (typeof body === 'string') {
      const preview = body.length > 128 ? body.slice(0, 128) : body;
      return { kind: 'text', preview, truncated: body.length > 128, length: body.length };
    }
    if (typeof body === 'object' && 'size' in body && typeof (body as { size?: number }).size === 'number') {
      const size = (body as { size: number }).size;
      return { kind: 'omitted', preview: '', truncated: size > 16384, length: size };
    }
    if (contentType && /(json|text|xml|javascript|x-www-form-urlencoded)/i.test(contentType) && typeof body === 'string') {
      const preview = body.slice(0, 128);
      return { kind: 'text', preview, truncated: body.length > 128, length: body.length };
    }
    return { kind: 'omitted', preview: '', truncated: false, length: 0 };
  };

  return {
    settings,
    rules,
    trace,
    addRule,
    clearRules() { rules.length = 0; },
    analyzeBody,
    beginRequest(context: RequestContext, transport: string) {
      const decision = resolveRule(context, transport);
      const aborted = context.signal?.aborted ?? false;
      const lifecycleTrace: TraceEvent[] = [];
      const entry = addTrace('request', context, transport, decision);
      lifecycleTrace.push(entry);
      if (aborted) {
        const abortEntry = addTrace('abort', context, transport, decision, 'cancelled');
        lifecycleTrace.push(abortEntry);
      }
      const settle = (kind: TraceEvent['kind'], detail?: string) => {
        const grown = addTrace(kind, context, transport, decision, detail);
        lifecycleTrace.push(grown);
        return grown;
      };
      return {
        decision,
        cancelled: aborted,
        trace: lifecycleTrace,
        settle,
        entry,
      };
    },
    get active() { return active; },
    decide(method: string | RequestContext, url?: string, transport?: string, requestHeaders?: HeaderBag) {
      if (!active) return null;
      if (typeof method === 'string') {
        const effectiveTransport = transport ?? 'network';
        const headerBag = typeof transport === 'string' ? requestHeaders : undefined;
        const context = createRequestContext({
          kind: effectiveTransport.toLowerCase() === 'xhr' ? 'xhr' : 'fetch',
          method,
          url: url ?? '',
          headers: headerBag,
        });
        return resolveRule(context, effectiveTransport);
      }
      const effectiveTransport = typeof transport === 'string' ? transport : (method.kind === 'xhr' ? 'XHR' : 'fetch');
      return resolveRule(method, effectiveTransport);
    },
    own(finish: () => void) {
      pending.add(finish);
      return () => pending.delete(finish);
    },
    close() {
      active = false;
      settings.enabled = false;
      for (const finish of [...pending]) finish();
      pending.clear();
    },
  };
}
export type Pipeline = ReturnType<typeof createPipeline>;
