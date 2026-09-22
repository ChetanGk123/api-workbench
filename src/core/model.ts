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

export type ProfileSnapshot = { profile: Profile; endpoints: Endpoint[] };
export type WorkbenchConfig = { profile: Profile; endpoints: Endpoint[]; savedProfiles?: ProfileSnapshot[] };

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