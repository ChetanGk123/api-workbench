export const mockBody = JSON.stringify({ source: 'workbench', message: 'Mock response — café ✓' });

// M0 deliberately has one GET matcher; general rules belong to M2.
export function createPipeline(report: (message: string) => void) {
  let active = true;
  const settings = { enabled: false, delay: 0 };
  const pending = new Set<() => void>();
  return {
    settings,
    get active() { return active; },
    decide(method: string, url: string, transport: string) {
      if (!active) return null;
      const mock = settings.enabled && method.toUpperCase() === 'GET' &&
        url === new URL('/api/mock-target', location.origin).href;
      report(`${transport} ${method} · ${mock ? 'mock / no network' : 'network'} · ${url.slice(0, 180)}`);
      return mock ? { delay: settings.delay } : null;
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
