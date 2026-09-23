import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.
const headerButton = (page, name) => panel(page).locator('.aw-tb').getByRole('button', { name, exact: true });

let seq = 0;
const matcher = (url, overrides = {}) => ({ method: 'GET', url, query: '', headers: '', bodyContains: '', ...overrides });
const base = (label, url, match) => ({
  id: `rule-${++seq}`, profileId: sample.profile.id, label, enabled: true, priority: 0, seq, revision: 1,
  matcher: matcher(url, match),
});
const slot = (overrides = {}) => ({ status: 200, headers: 'Content-Type: application/json', body: '{"mocked":true}', delayMs: 0, fault: 'none', ...overrides });
const mockRule = (label, url, { matcher: match, ...rest } = {}) => ({
  ...base(label, url, match), kind: 'mock', mode: 'static', slots: [slot()], exhaustion: 'repeat-last', ...rest,
});
const chaosRule = (label, url, { matcher: match, ...rest } = {}) => ({
  ...base(label, url, match), kind: 'chaos', mode: 'synthetic',
  fault: { kind: 'status', status: 500, body: '' }, probability: 100, seed: '', budget: 0, preDelayMs: 0, ...rest,
});

async function install(page, rules) {
  await headerButton(page, 'Import').click();
  await panel(page).getByRole('textbox', { name: 'Import source', exact: true }).fill(JSON.stringify({ ...sample, rules }));
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await panel(page).getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('replace');
  await panel(page).getByRole('button', { name: 'Import profile', exact: true }).click();
  // A committed import lands on the endpoint list with its summary.
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
}

async function goHome(page) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
}

async function activate(page, module) {
  await goHome(page);
  await panel(page).getByRole('button', { name: module, exact: true }).click();
  await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
}

/** Server-side hit counters, read outside the page so the wrapped transport is never involved. */
async function hits(request, path) {
  const stats = await (await request.get('http://127.0.0.1:4173/api/stats')).json();
  return stats[path] ?? 0;
}

const getJSON = (page, url) =>
  page.evaluate(async target => {
    const response = await fetch(target);
    return { status: response.status, statusText: response.statusText, type: response.headers.get('content-type'), body: await response.text() };
  }, url);

const getXHR = (page, url) =>
  page.evaluate(
    target =>
      new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open('GET', target);
        request.addEventListener('load', () =>
          resolve({ status: request.status, statusText: request.statusText, body: request.responseText, type: request.getResponseHeader('content-type') }));
        request.addEventListener('error', () => resolve({ error: 'error', status: request.status }));
        request.addEventListener('timeout', () => resolve({ error: 'timeout' }));
        request.send();
      }),
    url,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
});

test('M5 a selected mock answers fetch and XHR and makes zero network calls', async ({ page, request }) => {
  const path = '/api/m5-mock-zero';
  const before = await hits(request, path);
  await install(page, [mockRule('Zero traffic', path, { slots: [slot({ status: 201, headers: 'Content-Type: application/json\nX-Mock: yes' })] })]);
  await activate(page, 'Mock');

  const fetched = await getJSON(page, path);
  expect(fetched.status).toBe(201);
  expect(fetched.statusText).toBe('Created');
  expect(JSON.parse(fetched.body)).toEqual({ mocked: true });

  const header = await page.evaluate(async target => (await fetch(target)).headers.get('x-mock'), path);
  expect(header).toBe('yes');

  const xhr = await getXHR(page, path);
  expect(xhr.status).toBe(201);
  expect(xhr.type).toBe('application/json');
  expect(JSON.parse(xhr.body)).toEqual({ mocked: true });

  expect(await hits(request, path)).toBe(before);
});

test('M5 a mock applies only while its module is active and its rule is enabled', async ({ page, request }) => {
  const path = '/api/m5-gating';
  const before = await hits(request, path);
  await install(page, [mockRule('Disabled rule', path, { enabled: false })]);
  await activate(page, 'Mock');
  expect((await getJSON(page, path)).status).toBe(200);
  expect(JSON.parse((await getJSON(page, path)).body).source).toBe('network');
  expect(await hits(request, path)).toBe(before + 2);

  // Enabling the rule through the list makes the same request synthetic.
  await panel(page).getByRole('checkbox', { name: 'Enable Disabled rule' }).click();
  expect(JSON.parse((await getJSON(page, path)).body)).toEqual({ mocked: true });
  expect(await hits(request, path)).toBe(before + 2);

  // Deactivating the module returns the frame to captured transport.
  await panel(page).getByRole('button', { name: 'Deactivate', exact: true }).click();
  expect(JSON.parse((await getJSON(page, path)).body).source).toBe('network');
  expect(await hits(request, path)).toBe(before + 3);
});

test('M5 synthetic chaos supersedes a mock and still dispatches nothing', async ({ page, request }) => {
  const path = '/api/m5-synthetic';
  const before = await hits(request, path);
  await install(page, [
    mockRule('Mocked', path),
    chaosRule('Unavailable', path, { fault: { kind: 'status', status: 503, body: '{"chaos":true}' } }),
  ]);
  await activate(page, 'Mock');
  await activate(page, 'Chaos');
  const fetched = await getJSON(page, path);
  expect(fetched.status).toBe(503);
  expect(JSON.parse(fetched.body)).toEqual({ chaos: true });
  expect(await hits(request, path)).toBe(before);
});

test('M5 a synthetic network failure and timeout reject without dispatching', async ({ page, request }) => {
  const failPath = '/api/m5-fail';
  const timeoutPath = '/api/m5-timeout';
  const before = [await hits(request, failPath), await hits(request, timeoutPath)];
  await install(page, [
    chaosRule('Failure', failPath, { fault: { kind: 'network-error' } }),
    chaosRule('Timeout', timeoutPath, { fault: { kind: 'timeout', timeoutMs: 120 } }),
  ]);
  await activate(page, 'Chaos');

  const failed = await page.evaluate(target => fetch(target).then(() => 'resolved', error => error.name), failPath);
  expect(failed).toBe('TypeError');

  const timedOut = await page.evaluate(async target => {
    const started = performance.now();
    const name = await fetch(target).then(() => 'resolved', error => error.name);
    return { name, elapsed: performance.now() - started };
  }, timeoutPath);
  expect(timedOut.name).toBe('TimeoutError');
  expect(timedOut.elapsed).toBeGreaterThanOrEqual(100);

  const xhr = await getXHR(page, failPath);
  expect(xhr.error).toBe('error');
  expect(xhr.status).toBe(0);

  expect(await hits(request, failPath)).toBe(before[0]);
  expect(await hits(request, timeoutPath)).toBe(before[1]);
});

test('M5 real-traffic chaos dispatches exactly once and rewrites the delivered result', async ({ page, request }) => {
  const statusPath = '/api/m5-real-status';
  const jsonPath = '/api/m5-real-json';
  const before = [await hits(request, statusPath), await hits(request, jsonPath)];
  await install(page, [
    chaosRule('Real 502', statusPath, { mode: 'real', fault: { kind: 'status', status: 502, body: '' } }),
    chaosRule('Corrupt', jsonPath, { mode: 'real', fault: { kind: 'malformed-json' } }),
  ]);
  await activate(page, 'Chaos');

  const replaced = await getJSON(page, statusPath);
  expect(replaced.status).toBe(502);
  // The upstream body is preserved when the fault configures no replacement body.
  expect(JSON.parse(replaced.body).source).toBe('network');

  const corrupted = await getJSON(page, jsonPath);
  expect(corrupted.status).toBe(200);
  expect(() => JSON.parse(corrupted.body)).toThrow();

  expect(await hits(request, statusPath)).toBe(before[0] + 1);
  expect(await hits(request, jsonPath)).toBe(before[1] + 1);
});

test('M5 real-traffic latency delays delivery of one XHR dispatch', async ({ page, request }) => {
  const path = '/api/m5-real-xhr';
  const before = await hits(request, path);
  await install(page, [chaosRule('Slow', path, { mode: 'real', matcher: { method: '*' }, fault: { kind: 'latency', delayMs: 400 } })]);
  await activate(page, 'Chaos');

  const result = await page.evaluate(
    target =>
      new Promise(resolve => {
        const started = performance.now();
        const request = new XMLHttpRequest();
        request.open('GET', target);
        request.addEventListener('load', () =>
          resolve({ status: request.status, body: request.responseText, elapsed: performance.now() - started }));
        request.send();
      }),
    path,
  );
  expect(result.status).toBe(200);
  expect(JSON.parse(result.body).source).toBe('network');
  expect(result.elapsed).toBeGreaterThanOrEqual(380);
  expect(await hits(request, path)).toBe(before + 1);
});

test('M5 replay dispatches exactly its configured budget and returns only the primary result', async ({ page, request }) => {
  const path = '/api/m5-replay';
  const before = await hits(request, path);
  await install(page, [chaosRule('Replay', path, { mode: 'real', fault: { kind: 'replay', copies: 2, gapMs: 20 } })]);
  await activate(page, 'Chaos');

  const primary = await getJSON(page, path);
  expect(primary.status).toBe(200);
  expect(JSON.parse(primary.body).hit).toBe(before + 1);
  await expect.poll(() => hits(request, path), { timeout: 4000 }).toBe(before + 3);
  // The budget is exact: no further dispatch arrives after the configured copies.
  await page.waitForTimeout(300);
  expect(await hits(request, path)).toBe(before + 3);
});

test('M5 sequence slots are reserved in arrival order and exhaustion sends no real traffic', async ({ page, request }) => {
  const path = '/api/m5-sequence';
  const before = await hits(request, path);
  await install(page, [
    mockRule('Retry sequence', path, {
      mode: 'sequence',
      slots: [slot({ status: 503, body: '{"n":1}' }), slot({ status: 503, body: '{"n":2}' }), slot({ status: 200, body: '{"n":3}' })],
    }),
  ]);
  await activate(page, 'Mock');

  const sequential = [];
  for (let index = 0; index < 4; index++) sequential.push((await getJSON(page, path)).status);
  expect(sequential).toEqual([503, 503, 200, 200]);

  // Concurrent requests cannot share a reserved position: every slot is handed out once.
  await panel(page).locator('.aw-endpoint-name').first().click();
  await panel(page).getByRole('button', { name: 'Reset position', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Back', exact: true }).click();
  const concurrent = await page.evaluate(
    target => Promise.all([0, 1, 2].map(() => fetch(target).then(response => response.json()))),
    path,
  );
  expect(concurrent.map(item => item.n).sort()).toEqual([1, 2, 3]);

  expect(await hits(request, path)).toBe(before);
});

test('M5 a caller abort wins during a mock delay and the reserved slot stays consumed', async ({ page, request }) => {
  const path = '/api/m5-abort';
  const before = await hits(request, path);
  await install(page, [
    mockRule('Delayed sequence', path, {
      mode: 'sequence',
      slots: [slot({ status: 201, body: '{"n":1}', delayMs: 3000 }), slot({ status: 202, body: '{"n":2}' })],
    }),
  ]);
  await activate(page, 'Mock');

  const aborted = await page.evaluate(async target => {
    const controller = new AbortController();
    const started = performance.now();
    const pending = fetch(target, { signal: controller.signal }).then(() => 'resolved', error => error.name);
    setTimeout(() => controller.abort(), 60);
    return { name: await pending, elapsed: performance.now() - started };
  }, path);
  expect(aborted.name).toBe('AbortError');
  // The wait was cut short rather than running out its configured delay.
  expect(aborted.elapsed).toBeLessThan(2000);

  // The aborted request still consumed slot 1, so the next request receives slot 2.
  const next = await getJSON(page, path);
  expect(next.status).toBe(202);
  expect(await hits(request, path)).toBe(before);
});

test('M5 a mock rule created through the UI applies to live traffic and survives a relaunch', async ({ page, request }) => {
  const path = '/api/m5-ui-rule';
  const before = await hits(request, path);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Add ad-hoc rule', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Label', exact: true }).fill('UI authored');
  await panel(page).getByRole('textbox', { name: 'URL', exact: true }).fill(path);
  await panel(page).getByRole('spinbutton', { name: 'Status 1', exact: true }).fill('418');
  await panel(page).getByRole('textbox', { name: 'Body 1', exact: true }).fill('{"from":"ui"}');
  await panel(page).getByRole('checkbox', { name: 'Rule enabled', exact: true }).check();
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Save', exact: true }).click();

  await expect(panel(page).getByText('UI authored')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();

  const fetched = await getJSON(page, path);
  expect(fetched.status).toBe(418);
  expect(JSON.parse(fetched.body)).toEqual({ from: 'ui' });
  expect(await hits(request, path)).toBe(before);
  await expect(panel(page).getByText('1 hit')).toBeVisible();

  // Rules persist; activation does not, so a fresh launch never silently intercepts traffic.
  await panel(page).locator('.aw-tb').getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  await expect(panel(page).getByText('UI authored')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  expect(JSON.parse((await getJSON(page, path)).body).source).toBe('network');
  expect(await hits(request, path)).toBe(before + 1);
});

test('M5 the chaos editor switches mode and fault type, and refuses a synthetic replay', async ({ page }) => {
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Chaos', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Slow API', exact: true }).click();

  // The "Slow API" preset defaults to real-traffic delivery latency.
  await expect(panel(page).getByRole('radio', { name: /Real traffic/ })).toHaveAttribute('aria-checked', 'true');
  await expect(panel(page).getByRole('spinbutton', { name: 'Delay (ms)', exact: true })).toHaveValue('1000');
  // Dispatch delay and delivery latency are separate settings, and only real traffic has a dispatch.
  await expect(panel(page).getByRole('spinbutton', { name: 'Dispatch delay (ms)', exact: true })).toBeVisible();
  await panel(page).getByRole('radio', { name: /Synthetic/ }).click();
  await expect(panel(page).getByRole('spinbutton', { name: 'Dispatch delay (ms)', exact: true })).toHaveCount(0);

  // Fault-specific fields follow the selected fault type.
  await panel(page).getByRole('combobox', { name: 'Fault type', exact: true }).selectOption('status');
  await expect(panel(page).getByRole('spinbutton', { name: 'Fault status', exact: true })).toHaveValue('500');
  await panel(page).getByRole('combobox', { name: 'Fault type', exact: true }).selectOption('random-latency');
  await expect(panel(page).getByRole('spinbutton', { name: 'Minimum delay (ms)', exact: true })).toBeVisible();

  // Replay has no synthetic form, and the editor says so instead of saving a rule that does nothing.
  await panel(page).getByRole('combobox', { name: 'Fault type', exact: true }).selectOption('replay');
  await expect(panel(page).getByText(/2 total dispatches per matching request/)).toBeVisible();
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page).getByText(/Replay dispatches real requests/)).toBeVisible();
  await panel(page).getByRole('radio', { name: /Real traffic/ }).click();
  await panel(page).getByRole('combobox', { name: 'Fault type', exact: true }).selectOption('replay');
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  await expect(panel(page).locator('.aw-endpoint-name')).toHaveCount(1);
  await expect(panel(page).locator('.aw-endpoint-meta')).toContainText('real · Request replay · 100%');
});

test('M5 a rule added from an endpoint starts enabled and pastes the recorded body indented', async ({ page }) => {
  const path = '/api/m5-from-endpoint';
  await panel(page).getByRole('button', { name: 'Record', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(target => fetch(target).then(response => response.text()), path);
  await panel(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Create profile', exact: true }).click();
  await expect(panel(page).locator('.aw-h')).toHaveText('Endpoints');

  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Add rule from endpoint', exact: true }).click();
  await expect(panel(page).getByRole('checkbox', { name: 'Rule enabled', exact: true })).toBeChecked();
  await expect(panel(page).getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('m5-from-endpoint');

  await panel(page).getByRole('button', { name: 'Use recorded response', exact: true }).click();
  const body = await panel(page).getByRole('textbox', { name: 'Body 1', exact: true }).inputValue();
  expect(body).toContain('\n  "source": "network"');
  expect(JSON.parse(body).path).toBe(path);
});

test('M5 hovering a rule row underlines its label, not the method, URL and status line', async ({ page }) => {
  await install(page, [mockRule('Hover target', '/api/m5-hover')]);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  const open = panel(page).locator('.aw-endpoint-name').first();
  await open.hover();
  const decoration = await open.evaluate(node => [
    getComputedStyle(node).textDecorationLine,
    getComputedStyle(node.firstElementChild).textDecorationLine,
    getComputedStyle(node.querySelector('.aw-endpoint-meta')).textDecorationLine,
  ]);
  expect(decoration).toEqual(['none', 'underline', 'none']);
});
