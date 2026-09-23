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

export async function saveConfig(config: WorkbenchConfig): Promise<void> {
  if (!validateConfig(config)) throw new Error('Invalid Workbench configuration');
  const copy = normalizeConfig(structuredClone(config));
  memory.set(originKey(), copy);
  try { await writeToIndexedDb(copy); } catch { /* Export remains available when durable storage fails. */ }
}

export async function replaceProfile(config: WorkbenchConfig, profile: Profile, endpoints: Endpoint[]): Promise<WorkbenchConfig> {
  const next = { profile: structuredClone(profile), endpoints: structuredClone(endpoints) };
  await saveConfig(next);
  return next;
}

export function exportConfig(config: WorkbenchConfig): string {
  const { profile, endpoints, rules } = config;
  return JSON.stringify({ schemaVersion: 1, profile, endpoints, rules }, null, 2);
}

export function importConfig(serialized: string): WorkbenchConfig {
  const parsed: unknown = JSON.parse(serialized);
  if (!validateConfig(parsed)) throw new Error('Unsupported or invalid Workbench JSON');
  return structuredClone(parsed);
}