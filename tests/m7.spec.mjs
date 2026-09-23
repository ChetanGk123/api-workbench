import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launcher = page => page.locator('#api-workbench .aw-min');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.
const headerButton = (page, name) => panel(page).locator('.aw-tb').getByRole('button', { name, exact: true });
const queue = page => panel(page).locator('.aw-paused');

let seq = 0;
const transform = (overrides = {}) => ({
  setHeaders: '', removeHeaders: '', patch: [], body: { find: '', replace: '', scope: 'first' }, status: 0, ...overrides,
});
const interceptRule = (label, url, breakpoints, overrides = {}) => ({
  id: `rule-${++seq}`, profileId: sample.profile.id, label, enabled: true, priority: 0, seq, revision: 1,
  matcher: { method: '*', url, query: '', headers: '', bodyContains: '' },
  kind: 'intercept', request: transform(), response: transform(), breakpoints, ...overrides,
});
const mockRule = (label, url, body) => ({
  id: `rule-${++seq}`, profileId: sample.profile.id, label, enabled: true, priority: 0, seq, revision: 1,
  matcher: { method: '*', url, query: '', headers: '', bodyContains: '' },
  kind: 'mock', mode: 'static', exhaustion: 'repeat-last',
  slots: [{ status: 200, headers: 'Content-Type: application/json', body, delayMs: 0, fault: 'none' }],
});

async function install(page, rules) {
  await headerButton(page, 'Import').click();
  await panel(page).getByRole('textbox', { name: 'Import JSON', exact: true }).fill(JSON.stringify({ ...sample, rules }));
  await panel(page).getByRole('button', { name: 'Import JSON', exact: true }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Settings');
}

async function goHome(page) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
}

/** Activates Intercept and leaves the panel on the Intercept screen, where the queue lives. */
async function activateIntercept(page) {
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
}

/** Server-side hit counters, read outside the page so the wrapped transport is never involved. */
async function hits(request, path) {
  const stats = await (await request.get('http://127.0.0.1:4173/api/stats')).json();
  return stats[path] ?? 0;
}

/** Starts a fetch without awaiting it: the request has to be in flight while we drive the queue. */
const startFetch = (page, url, init) =>
  page.evaluate(([target, options]) => {
    window.__pending = fetch(target, options).then(
      async response => ({
        status: response.status,
        statusText: response.statusText,
        body: await response.text(),
        edited: response.headers.get('x-edited'),
      }),
      error => ({ error: error.name, message: error.message }),
    );
  }, [url, init ?? {}]);

const startXHR = (page, url, method = 'GET', body = null) =>
  page.evaluate(([target, verb, payload]) => {
    const request = new XMLHttpRequest();
    window.__states = [];
    window.__events = [];
    request.addEventListener('readystatechange', () => window.__states.push(request.readyState));
    for (const type of ['loadstart', 'progress', 'load', 'error', 'abort', 'loadend'])
      request.addEventListener(type, () => window.__events.push(`${type}:${request.readyState}`));
    window.__pending = new Promise(resolve => {
      request.addEventListener('load', () =>
        resolve({ status: request.status, body: request.responseText, states: window.__states, events: window.__events }));
      request.addEventListener('error', () => resolve({ error: 'error', events: window.__events }));
      request.addEventListener('abort', () => resolve({ error: 'abort', events: window.__events }));
    });
    request.open(verb, target);
    if (payload) request.setRequestHeader('Content-Type', 'application/json');
    request.send(payload);
  }, [url, method, body]);

const settle = page => page.evaluate(() => window.__pending);

test.beforeEach(async ({ page }) => {
  seq = 0;
  await page.goto('http://127.0.0.1:4173/fixture');
  await launch(page);
});

test('M7 a request-stage pause holds the request before any dispatch, and the edit reaches the server', async ({ page, request }) => {
  await install(page, [interceptRule('Pause requests', '/api/echo-headers', { request: true, response: false })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/echo-headers');

  await startFetch(page, '/api/echo-headers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fixture': 'original' }, body: '{"n":1}' });
  await expect(queue(page)).toHaveCount(1);
  await expect(queue(page).locator('.aw-bd', { hasText: 'Request stage' })).toBeVisible();
  await expect(queue(page).getByText(/fetch · rule Pause requests/)).toBeVisible();
  // Nothing has been dispatched while the request waits.
  expect(await hits(request, '/api/echo-headers')).toBe(before);

  const headers = queue(page).getByRole('textbox', { name: /headers for/ });
  await headers.fill(await headers.inputValue() + '\nx-fixture: edited-at-breakpoint');
  await queue(page).getByRole('textbox', { name: /body for/ }).fill('{"n":2}');
  await queue(page).getByRole('button', { name: 'Continue', exact: true }).click();

  const result = await settle(page);
  expect(result.status).toBe(200);
  const echoed = JSON.parse(result.body);
  expect(echoed.headers['x-fixture']).toBe('edited-at-breakpoint');
  expect(echoed.body).toBe('{"n":2}');
  // Exactly one upstream request, and the queue is empty again.
  expect(await hits(request, '/api/echo-headers')).toBe(before + 1);
  await expect(queue(page)).toHaveCount(0);
});

test('M7 a response-stage pause is the final override, after the upstream request completed', async ({ page, request }) => {
  await install(page, [
    interceptRule('Pause responses', '/api/m7-res', { request: false, response: true }, {
      response: transform({ setHeaders: 'X-Edited: transform' }),
    }),
  ]);
  await activateIntercept(page);
  const before = await hits(request, '/api/m7-res');

  await startFetch(page, '/api/m7-res');
  await expect(queue(page)).toHaveCount(1);
  await expect(queue(page).locator('.aw-bd', { hasText: 'Response stage' })).toBeVisible();
  // The response stage is reached only after the single dispatch has already happened.
  expect(await hits(request, '/api/m7-res')).toBe(before + 1);

  const headers = queue(page).getByRole('textbox', { name: /headers for/ });
  expect(await headers.inputValue()).toContain('x-edited: transform');
  await headers.fill(await headers.inputValue() + '\nx-edited: breakpoint');
  await queue(page).getByRole('spinbutton', { name: /^Status for/ }).fill('418');
  await queue(page).getByRole('textbox', { name: /body for/ }).fill('{"from":"breakpoint"}');
  await queue(page).getByRole('button', { name: 'Continue', exact: true }).click();

  const result = await settle(page);
  expect(result.status).toBe(418);
  expect(result.statusText).toBe("I'm a Teapot");
  expect(result.edited).toBe('breakpoint');
  expect(JSON.parse(result.body)).toEqual({ from: 'breakpoint' });
  expect(await hits(request, '/api/m7-res')).toBe(before + 1);
});

test('M7 Abort at the request stage rejects the caller and never dispatches', async ({ page, request }) => {
  await install(page, [interceptRule('Pause requests', '/api/m7-abort', { request: true, response: false })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/m7-abort');

  await startFetch(page, '/api/m7-abort');
  await expect(queue(page)).toHaveCount(1);
  await queue(page).getByRole('button', { name: 'Abort', exact: true }).click();

  const result = await settle(page);
  expect(result.error).toBe('AbortError');
  expect(await hits(request, '/api/m7-abort')).toBe(before);
  await expect(queue(page)).toHaveCount(0);
});

test('M7 Continue all releases every waiting request, each dispatching exactly once', async ({ page, request }) => {
  await install(page, [interceptRule('Pause requests', '/api/m7-many', { request: true, response: false })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/m7-many');

  await page.evaluate(() => {
    window.__all = Promise.all([1, 2, 3].map(n => fetch(`/api/m7-many?n=${n}`).then(r => r.status)));
  });
  await expect(queue(page)).toHaveCount(3);
  expect(await hits(request, '/api/m7-many')).toBe(before);

  await panel(page).getByRole('button', { name: 'Continue all', exact: true }).click();
  expect(await page.evaluate(() => window.__all)).toEqual([200, 200, 200]);
  expect(await hits(request, '/api/m7-many')).toBe(before + 3);
  await expect(queue(page)).toHaveCount(0);
});

test('M7 a paused XHR emits nothing while it waits, then keeps the native event order', async ({ page, request }) => {
  await install(page, [interceptRule('Pause XHR', '/api/echo-headers', { request: true, response: true })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/echo-headers');

  await startXHR(page, '/api/echo-headers', 'POST', '{"n":1}');
  await expect(queue(page)).toHaveCount(1);
  // open() and loadstart have fired, but the page has seen no state past OPENED and nothing was sent.
  expect(await page.evaluate(() => window.__events)).toEqual(['loadstart:1']);
  expect(await page.evaluate(() => window.__states)).toEqual([1]);
  expect(await hits(request, '/api/echo-headers')).toBe(before);

  const headers = queue(page).getByRole('textbox', { name: /headers for/ });
  await headers.fill(await headers.inputValue() + '\nx-fixture: xhr-breakpoint');
  await queue(page).getByRole('button', { name: 'Continue', exact: true }).click();

  // The response stage of the same rule pauses the same request a second time.
  await expect(queue(page).locator('.aw-bd', { hasText: 'Response stage' })).toBeVisible();
  expect(await hits(request, '/api/echo-headers')).toBe(before + 1);
  expect(await page.evaluate(() => window.__events)).toEqual(['loadstart:1']);
  await queue(page).getByRole('spinbutton', { name: /^Status for/ }).fill('503');
  await queue(page).getByRole('button', { name: 'Continue', exact: true }).click();

  const result = await settle(page);
  expect(result.status).toBe(503);
  expect(JSON.parse(result.body).headers['x-fixture']).toBe('xhr-breakpoint');
  expect(result.states).toEqual([1, 2, 3, 4]);
  expect(result.events).toEqual(['loadstart:1', 'progress:3', 'load:4', 'loadend:4']);
  expect(await hits(request, '/api/echo-headers')).toBe(before + 1);
});

test('M7 a mocked request is never paused, and the trace says why', async ({ page, request }) => {
  await install(page, [
    interceptRule('Pause requests', '/api/m7-mock', { request: true, response: true }),
    mockRule('Mock it', '/api/m7-mock', '{"source":"mock"}'),
  ]);
  await activateIntercept(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();
  const before = await hits(request, '/api/m7-mock');

  await startFetch(page, '/api/m7-mock');
  const result = await settle(page);
  expect(JSON.parse(result.body)).toEqual({ source: 'mock' });
  expect(await hits(request, '/api/m7-mock')).toBe(before);
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await expect(queue(page)).toHaveCount(0);
  await expect(panel(page).getByText(/No paused requests/)).toBeVisible();
});

test('M7 the launcher reports a paused request while the panel is minimized', async ({ page }) => {
  await install(page, [interceptRule('Pause requests', '/api/m7-min', { request: true, response: false })]);
  await activateIntercept(page);

  await startFetch(page, '/api/m7-min');
  await expect(queue(page)).toHaveCount(1);
  await headerButton(page, 'Minimize').click();
  await expect(launcher(page)).toBeVisible();
  await expect(launcher(page).getByText('1 request paused')).toBeVisible();
  await expect(launcher(page).locator('.aw-dot.aw-a')).toBeVisible();

  await launcher(page).getByRole('button', { name: 'Restore' }).click();
  await panel(page).getByRole('button', { name: 'Continue all', exact: true }).click();
  expect((await settle(page)).status).toBe(200);
  await expect(panel(page).locator('.aw-foot')).not.toContainText('paused');
});

test('M7 closing the workbench continues a paused request instead of leaving it hanging', async ({ page, request }) => {
  await install(page, [interceptRule('Pause requests', '/api/m7-close', { request: true, response: false })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/m7-close');

  await startFetch(page, '/api/m7-close');
  await expect(queue(page)).toHaveCount(1);
  await headerButton(page, 'Close').click();
  await expect(page.locator('#api-workbench')).toHaveCount(0);

  // The page's own request completes on the captured transport, exactly once.
  const result = await settle(page);
  expect(result.status).toBe(200);
  expect(await hits(request, '/api/m7-close')).toBe(before + 1);
});

test('M7 closing the workbench also releases a paused XHR, with no duplicate dispatch', async ({ page, request }) => {
  await install(page, [interceptRule('Pause XHR', '/api/m7-close-xhr', { request: true, response: false })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/m7-close-xhr');

  await startXHR(page, '/api/m7-close-xhr');
  await expect(queue(page)).toHaveCount(1);
  await headerButton(page, 'Close').click();

  const result = await settle(page);
  expect(result.status).toBe(200);
  expect(result.events).toEqual(['loadstart:1', 'progress:3', 'load:4', 'loadend:4']);
  expect(await hits(request, '/api/m7-close-xhr')).toBe(before + 1);
});

test('M7 an edited rule marks a waiting pause as stale without mutating it', async ({ page }) => {
  await install(page, [interceptRule('Pause requests', '/api/m7-stale', { request: true, response: false })]);
  await activateIntercept(page);

  await startFetch(page, '/api/m7-stale', { headers: { 'X-Fixture': 'snapshot' } });
  await expect(queue(page)).toHaveCount(1);
  expect(await queue(page).getByRole('textbox', { name: /headers for/ }).inputValue()).toContain('x-fixture: snapshot');

  // Editing the rule bumps its revision; the waiting request keeps the rule it matched.
  await panel(page).getByRole('button', { name: /^Pause requests/ }).click();
  await panel(page).getByRole('textbox', { name: 'Label' }).fill('Pause requests v2');
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Save' }).click();
  await expect(queue(page).getByText(/has been edited since this request paused/)).toBeVisible();
  expect(await queue(page).getByRole('textbox', { name: /headers for/ }).inputValue()).toContain('x-fixture: snapshot');

  await queue(page).getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await settle(page)).status).toBe(200);
});

test('M7 a pause that nobody answers continues on its own after the deadline', async ({ page, request }) => {
  // The product deadline is 30 s and is not user-configurable, so this check waits it out.
  test.setTimeout(90_000);
  await install(page, [interceptRule('Pause requests', '/api/echo-headers', { request: true, response: false })]);
  await activateIntercept(page);
  const before = await hits(request, '/api/echo-headers');

  const started = Date.now();
  await startFetch(page, '/api/echo-headers', { headers: { 'X-Fixture': 'untouched' } });
  await expect(queue(page)).toHaveCount(1);
  await expect(queue(page).getByText(/of 30s/)).toBeVisible();

  const result = await page.evaluate(() => window.__pending, { timeout: 60_000 });
  const elapsed = Date.now() - started;
  expect(result.status).toBe(200);
  // The original, unedited request is what was dispatched — exactly once.
  expect(JSON.parse(result.body).headers['x-fixture']).toBe('untouched');
  expect(await hits(request, '/api/echo-headers')).toBe(before + 1);
  expect(elapsed).toBeGreaterThanOrEqual(29_000);
  await expect(queue(page)).toHaveCount(0);
  await expect(panel(page).locator('.aw-foot')).not.toContainText('paused');
});

test('M7 a breakpoint authored through the editor pauses live traffic', async ({ page, request }) => {
  await install(page, []);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Add rule', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Label' }).fill('Authored pause');
  await panel(page).getByRole('textbox', { name: 'URL' }).fill('/api/m7-authored');
  await panel(page).getByRole('checkbox', { name: 'Pause before dispatch (request stage)' }).check();
  await panel(page).getByRole('checkbox', { name: 'Rule enabled' }).check();
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Save' }).click();
  await expect(panel(page).getByText('0 request · 0 response · pause req')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();
  const before = await hits(request, '/api/m7-authored');
  await startFetch(page, '/api/m7-authored');
  await expect(queue(page)).toHaveCount(1);
  expect(await hits(request, '/api/m7-authored')).toBe(before);
  await queue(page).getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await settle(page)).status).toBe(200);
  expect(await hits(request, '/api/m7-authored')).toBe(before + 1);
});
