import { defaultProfile, type Endpoint, type Profile, type WorkbenchConfig } from './model';

const DB_NAME = 'api-workbench';
const DB_VERSION = 1;
const memory = new Map<string, WorkbenchConfig>();

function originKey(): string { return location.origin; }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('configs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function readFromIndexedDb(): Promise<WorkbenchConfig | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction('configs', 'readonly').objectStore('configs').get(originKey());
    request.onsuccess = () => { database.close(); resolve(request.result as WorkbenchConfig | undefined); };
    request.onerror = () => { database.close(); reject(request.error ?? new Error('IndexedDB read failed')); };
  });
}

async function writeToIndexedDb(config: WorkbenchConfig): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('configs', 'readwrite');
    transaction.objectStore('configs').put(config, originKey());
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB write failed')); };
  });
}

/**
 * The build that last ran on this origin, under its own key beside the config. It is deliberately
 * not part of WorkbenchConfig: it belongs to the origin, not to a profile, and must not travel
 * through export, import or a profile switch.
 */
function versionKey(): string { return `version:${originKey()}`; }

export async function readLaunchVersion(): Promise<string | undefined> {
  try {
    const database = await openDatabase();
    return await new Promise<string | undefined>((resolve, reject) => {
      const request = database.transaction('configs', 'readonly').objectStore('configs').get(versionKey());
      request.onsuccess = () => { database.close(); resolve(typeof request.result === 'string' ? request.result : undefined); };
      request.onerror = () => { database.close(); reject(request.error ?? new Error('IndexedDB read failed')); };
    });
  } catch { return undefined; }
}

export async function recordLaunchVersion(version: string): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('configs', 'readwrite');
      transaction.objectStore('configs').put(version, versionKey());
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB write failed')); };
    });
  } catch { /* A version note that cannot be written only costs the next update check. */ }
}

/** Removes everything this origin holds: the saved configuration and the launch-version note. */
export async function clearStoredConfig(): Promise<void> {
  memory.delete(originKey());
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('configs', 'readwrite');
    const store = transaction.objectStore('configs');
    store.delete(originKey());
    store.delete(versionKey());
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB delete failed')); };
  });
}

export function validateConfig(value: unknown): value is WorkbenchConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<WorkbenchConfig>;
  return !!config.profile && typeof config.profile.id === 'string' && Array.isArray(config.endpoints);
}

function normalizeConfig(config: WorkbenchConfig): WorkbenchConfig {
  const profile = { ...config.profile, activeEnvironment: config.profile.activeEnvironment || 'default' };
  return { ...config, profile, rules: config.rules ?? [], savedProfiles: config.savedProfiles ?? [] };
}

export async function loadConfig(): Promise<WorkbenchConfig> {
  const cached = memory.get(originKey());
  if (cached) return structuredClone(cached);
  try {
    const stored = await readFromIndexedDb();
    if (stored && validateConfig(stored)) { const normalized = normalizeConfig(stored); memory.set(originKey(), normalized); return structuredClone(normalized); }
  } catch { /* Storage failure keeps the live session usable. */ }
  const config = { profile: defaultProfile(), endpoints: [], savedProfiles: [] };
  memory.set(originKey(), config);
  return structuredClone(config);
}

/**
 * `durable` is for commits that must not report success on a failed write: the error propagates and
 * the in-memory configuration is left untouched, so the caller can keep its draft and retry.
 */
export async function saveConfig(config: WorkbenchConfig, durable = false): Promise<void> {
  if (!validateConfig(config)) throw new Error('Invalid Workbench configuration');
  const copy = normalizeConfig(structuredClone(config));
  if (durable) { await writeToIndexedDb(copy); memory.set(originKey(), copy); return; }
  memory.set(originKey(), copy);
  try { await writeToIndexedDb(copy); } catch { /* Export remains available when durable storage fails. */ }
}

export async function replaceProfile(config: WorkbenchConfig, profile: Profile, endpoints: Endpoint[]): Promise<WorkbenchConfig> {
  const next = { profile: structuredClone(profile), endpoints: structuredClone(endpoints) };
  await saveConfig(next);
  return next;
}

export function exportConfig(config: WorkbenchConfig): string {
  const { profile, endpoints, rules, plan } = config;
  return JSON.stringify({ schemaVersion: 1, profile, endpoints, rules, plan }, null, 2);
}
