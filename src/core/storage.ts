import { defaultProfile, type WorkbenchConfig } from './model';

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
 * A value kept beside the config under its own key. Everything here belongs to the origin, not to a
 * profile, and must not travel through export, import or a profile switch.
 */
function versionKey(): string { return `version:${originKey()}`; }
function geometryKey(): string { return `geometry:${originKey()}`; }

/** Where the panel was left. Restored on the next launch, clamped to whatever viewport it meets. */
export type PanelGeometry = { x: number; y: number; width: number; height: number };

const isVersion = (value: unknown): value is string => typeof value === 'string';
/** Stored geometry is untrusted input: a corrupt record must not place the panel at NaN. */
const isGeometry = (value: unknown): value is PanelGeometry =>
  !!value && typeof value === 'object' &&
  (['x', 'y', 'width', 'height'] as const).every(key => Number.isFinite((value as Record<string, unknown>)[key]));

async function readKey<T>(key: string, accept: (value: unknown) => value is T): Promise<T | undefined> {
  try {
    const database = await openDatabase();
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction('configs', 'readonly').objectStore('configs').get(key);
      request.onsuccess = () => { database.close(); resolve(accept(request.result) ? request.result : undefined); };
      request.onerror = () => { database.close(); reject(request.error ?? new Error('IndexedDB read failed')); };
    });
  } catch { return undefined; }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('configs', 'readwrite');
      transaction.objectStore('configs').put(value, key);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('IndexedDB write failed')); };
    });
  } catch { /* A note that cannot be written costs only the next launch's convenience. */ }
}

export const readLaunchVersion = (): Promise<string | undefined> => readKey(versionKey(), isVersion);
export const recordLaunchVersion = (version: string): Promise<void> => writeKey(versionKey(), version);
export const readPanelGeometry = (): Promise<PanelGeometry | undefined> => readKey(geometryKey(), isGeometry);
export const recordPanelGeometry = (geometry: PanelGeometry): Promise<void> => writeKey(geometryKey(), geometry);

/** Removes everything this origin holds: the saved configuration, the launch-version note and the
 * remembered panel geometry. */
export async function clearStoredConfig(): Promise<void> {
  memory.delete(originKey());
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('configs', 'readwrite');
    const store = transaction.objectStore('configs');
    store.delete(originKey());
    store.delete(versionKey());
    store.delete(geometryKey());
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

export function exportConfig(config: WorkbenchConfig): string {
  const { profile, endpoints, rules, plan } = config;
  return JSON.stringify({ schemaVersion: 1, profile, endpoints, rules, plan }, null, 2);
}
