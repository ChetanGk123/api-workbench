import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.
const headerButton = (page, name) => panel(page).locator('.aw-tb').getByRole('button', { name, exact: true });

const OTHER = 'http://127.0.0.1:4174';

let seq = 0;
const matcher = (url, overrides = {}) => ({ method: '*', url, query: '', headers: '', bodyContains: '', ...overrides });
const base = (label, url, match) => ({
  id: `rule-${++seq}`, profileId: sample.profile.id, label, enabled: true, priority: 0, seq, revision: 1,
  matcher: matcher(url, match),
});
const transform = (overrides = {}) => ({
  setHeaders: '', removeHeaders: '', patch: [], body: { find: '', replace: '', scope: 'first' }, status: 0, ...overrides,
});
const interceptRule = (label, url, { matcher: match, ...rest } = {}) => ({
  ...base(label, url, match), kind: 'intercept', request: transform(), response: transform(), ...rest,
});
const routeRule = (label, url, { matcher: match, ...rest } = {}) => ({
  ...base(label, url, match), kind: 'route', matchOrigin: '', destinationOrigin: 'http://127.0.0.1:4173',
  pathRewrite: '', preservePath: true, credentials: 'same-origin', keepAuthorization: false, ...rest,
});
const mockRule = (label, url, body) => ({
  ...base(label, url), kind: 'mock', mode: 'static', exhaustion: 'repeat-last',
  slots: [{ status: 200, headers: 'Content-Type: application/json', body, delayMs: 0, fault: 'none' }],
});
const chaosRule = (label, url, overrides = {}) => ({
  ...base(label, url), kind: 'chaos', mode: 'real', fault: { kind: 'status', status: 500, body: '' },
  probability: 100, seed: '', budget: 0, preDelayMs: 0, ...overrides,
});

async function install(page, rules) {
  await headerButton(page, 'Import').click();
  await panel(page).getByRole('textbox', { name: 'Import source', exact: true }).fill(JSON.stringify({ ...sample, rules }));
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await panel(page).getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('replace');
  await panel(page).getByRole('button', { name: 'Import profile', exact: true }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
}

async function goHome(page) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
}

async function activate(page, ...modules) {
  for (const module of modules) {
    await goHome(page);
    await panel(page).getByRole('button', { name: module, exact: true }).click();
    await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
  }
  await goHome(page);
}

/** Server-side hit counters, read outside the page so the wrapped transport is never involved. */
async function hits(request, path, origin = 'http://127.0.0.1:4173') {
  const stats = await (await request.get(`${origin}/api/stats`)).json();
  return stats[path] ?? 0;
}

const getJSON = (page, url, init) =>
  page.evaluate(async ([target, options]) => {
    try {
      const response = await fetch(target, options);
      return { status: response.status, statusText: response.statusText, edited: response.headers.get('x-edited'), body: await response.text() };
    } catch (error) {
      return { error: error.name, message: error.message };
    }
  }, [url, init ?? {}]);

const getXHR = (page, url, method = 'GET', body = null) =>
  page.evaluate(
    ([target, verb, payload]) =>
      new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open(verb, target);
        if (payload) request.setRequestHeader('Content-Type', 'application/json');
        request.addEventListener('load', () =>
          resolve({ status: request.status, statusText: request.statusText, body: request.responseText, edited: request.getResponseHeader('x-edited'), url: request.responseURL }));
        request.addEventListener('error', () => resolve({ error: 'error' }));
        request.send(payload);
      }),
    [url, method, body],
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
});

test('M6 an intercept rule edits a real response status, headers and JSON body after one dispatch', async ({ page, request }) => {
  const path = '/api/m6-response';
  const before = await hits(request, path);
  await install(page, [
    interceptRule('Edit response', path, {
      response: transform({
        status: 201,
        setHeaders: 'X-Edited: yes',
        removeHeaders: 'cache-control',
        patch: [{ op: 'replace', path: '/source', value: 'workbench' }, { op: 'add', path: '/added', value: true }],
      }),
    }),
  ]);
  await activate(page, 'Intercept');

  const result = await getJSON(page, path);
  expect(result.status).toBe(201);
  expect(result.statusText).toBe('Created');
  expect(result.edited).toBe('yes');
  expect(JSON.parse(result.body)).toMatchObject({ source: 'workbench', added: true });
  // Stage 6 edits the response the page sees; it never re-sends the request.
  expect(await hits(request, path)).toBe(before + 1);

  const xhr = await getXHR(page, path);
  expect(xhr.status).toBe(201);
  expect(xhr.edited).toBe('yes');
  expect(JSON.parse(xhr.body).source).toBe('workbench');
  expect(await hits(request, path)).toBe(before + 2);
});

test('M6 a request transform changes the headers and body that actually reach the server', async ({ page }) => {
  await install(page, [
    interceptRule('Edit request', '/api/echo**', {
      request: transform({
        setHeaders: 'X-Fixture: edited',
        patch: [{ op: 'replace', path: '/mode', value: 'patched' }],
        body: { find: 'keep-me', replace: 'replaced', scope: 'all' },
      }),
    }),
  ]);
  await activate(page, 'Intercept');

  const sent = JSON.stringify({ mode: 'original', note: 'keep-me keep-me' });
  const result = await getJSON(page, '/api/echo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: sent,
  });
  const echoed = JSON.parse(result.body);
  expect(echoed.header).toBe('edited');
  expect(JSON.parse(echoed.body)).toEqual({ mode: 'patched', note: 'replaced replaced' });

  // XHR takes the same transform through its own adapter.
  const xhr = await getXHR(page, '/api/echo-headers', 'POST', sent);
  const fromXHR = JSON.parse(xhr.body);
  expect(fromXHR.headers['x-fixture']).toBe('edited');
  expect(JSON.parse(fromXHR.body).mode).toBe('patched');
});

test('M6 a forbidden request header is refused by the editor and never reaches the wire', async ({ page }) => {
  await install(page, [
    interceptRule('Forbidden header', '/api/echo-headers', { request: transform({ setHeaders: 'Host: elsewhere.test\nX-Fixture: allowed' }) }),
  ]);
  await activate(page, 'Intercept');
  const result = await getJSON(page, '/api/echo-headers', { method: 'POST', body: '{}' });
  const echoed = JSON.parse(result.body);
  expect(echoed.headers['x-fixture']).toBe('allowed');
  expect(echoed.headers.host).toBe('127.0.0.1:4173');

  // The editor states the rule, rather than showing an edit that appears to succeed.
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await panel(page).getByRole('button', { name: /^Forbidden header/ }).click();
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  // Warned inline while typing, and the save is refused with the reason.
  await expect(panel(page).getByText(/forbids setting host on a request; remove it to save/i)).toBeVisible();
  await expect(panel(page).getByText(/remove that line from the request transform/i)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});

test('M6 a failing JSON Patch is skipped whole; the original body is delivered unchanged', async ({ page }) => {
  await install(page, [
    interceptRule('Partial patch', '/api/m6-partial', {
      response: transform({
        setHeaders: 'X-Edited: yes',
        patch: [{ op: 'replace', path: '/source', value: 'changed' }, { op: 'replace', path: '/missing/deep', value: 1 }],
      }),
    }),
  ]);
  await activate(page, 'Intercept');
  const result = await getJSON(page, '/api/m6-partial');
  // The header edit still applies; the transactional patch commits nothing.
  expect(result.edited).toBe('yes');
  expect(JSON.parse(result.body).source).toBe('network');
});

test('M6 a response transform edits a mocked response and still makes zero network calls', async ({ page, request }) => {
  const path = '/api/m6-mocked';
  const before = await hits(request, path);
  await install(page, [
    mockRule('Mock it', path, JSON.stringify({ source: 'mock', keep: 1 })),
    interceptRule('Edit the mock', path, {
      response: transform({ status: 202, setHeaders: 'X-Edited: yes', patch: [{ op: 'replace', path: '/source', value: 'edited-mock' }] }),
    }),
  ]);
  await activate(page, 'Mock', 'Intercept');

  const result = await getJSON(page, path);
  expect(result.status).toBe(202);
  expect(result.edited).toBe('yes');
  expect(JSON.parse(result.body)).toEqual({ source: 'edited-mock', keep: 1 });
  expect(await hits(request, path)).toBe(before);
});

test('M6 a route rewrites the dispatched URL once and leaves the original path untouched', async ({ page, request }) => {
  const from = '/api/m6-from/items/42';
  const to = '/api/m6-to/items/42';
  const sourceBefore = await hits(request, from);
  const targetBefore = await hits(request, to);
  await install(page, [routeRule('Local API', '/api/m6-from/**', { pathRewrite: '/api/m6-to/**' })]);
  await activate(page, 'Route');

  const result = await getJSON(page, `${from}?active=1`);
  expect(result.status).toBe(200);
  // The rewritten path is what the server saw, and the query string survived.
  expect(JSON.parse(result.body).path).toBe(to);
  expect(await hits(request, from)).toBe(sourceBefore);
  expect(await hits(request, to)).toBe(targetBefore + 1);

  const xhr = await getXHR(page, `${from}?active=1`);
  expect(JSON.parse(xhr.body).path).toBe(to);
  expect(xhr.url).toContain(to);
  expect(await hits(request, from)).toBe(sourceBefore);
  expect(await hits(request, to)).toBe(targetBefore + 2);
});

test('M6 a cross-origin route reaches the other origin, and Authorization is dropped unless kept', async ({ page, request }) => {
  const before = await hits(request, '/api/cors-allowed', OTHER);
  await install(page, [
    routeRule('To the other origin', '/api/m6-cross', {
      destinationOrigin: OTHER, pathRewrite: '/api/cors-allowed', credentials: 'omit',
    }),
  ]);
  await activate(page, 'Route');

  // Authorization is stripped, so this stays a simple cross-origin GET the destination allows.
  const stripped = await getJSON(page, '/api/m6-cross', { headers: { Authorization: 'Bearer local-only' } });
  expect(stripped.status).toBe(200);
  expect(await hits(request, '/api/cors-allowed', OTHER)).toBe(before + 1);

  // Keeping it forces a preflight the destination does not answer: the failure is visible, not hidden.
  // Importing swaps the live rule set; module activation is session state and stays on.
  await install(page, [
    routeRule('Keep authorization', '/api/m6-cross', {
      destinationOrigin: OTHER, pathRewrite: '/api/cors-allowed', credentials: 'omit', keepAuthorization: true,
    }),
  ]);
  const kept = await getJSON(page, '/api/m6-cross', { headers: { Authorization: 'Bearer local-only' } });
  expect(kept.error).toBe('TypeError');
});

test('M6 a route that the browser refuses is reported as an opaque failure, never as solved CORS', async ({ page }) => {
  await install(page, [
    routeRule('Denied destination', '/api/m6-denied', { destinationOrigin: OTHER, pathRewrite: '/api/denied' }),
  ]);
  await activate(page, 'Route');
  const result = await getJSON(page, '/api/m6-denied');
  expect(result.error).toBe('TypeError');

  await goHome(page);
  const activity = panel(page).locator('.aw-code');
  await expect(activity).toContainText('opaque failure');
  await expect(activity).toContainText('may still have received the request');
  await expect(activity).not.toContainText(/CORS (solved|bypassed|fixed)/i);
});

test('M6 composition order: a response transform runs before real-traffic chaos', async ({ page, request }) => {
  const path = '/api/m6-order';
  const before = await hits(request, path);
  await install(page, [
    interceptRule('Edit first', path, { response: transform({ status: 201, setHeaders: 'X-Edited: yes' }) }),
    chaosRule('Fail last', path, { fault: { kind: 'status', status: 503, body: '{"chaos":true}' } }),
  ]);
  await activate(page, 'Intercept', 'Chaos');

  const result = await getJSON(page, path);
  // Chaos is stage 7, so its status wins; the stage 6 header edit is still on the delivered response.
  expect(result.status).toBe(503);
  expect(result.edited).toBe('yes');
  expect(JSON.parse(result.body)).toEqual({ chaos: true });
  expect(await hits(request, path)).toBe(before + 1);
});

test('M6 an inactive module changes nothing, and stop-all restores untouched traffic', async ({ page, request }) => {
  const path = '/api/m6-inactive';
  await install(page, [interceptRule('Idle', path, { response: transform({ status: 201 }) })]);
  // Rules are enabled but the module was never activated.
  const idle = await getJSON(page, path);
  expect(idle.status).toBe(200);

  await activate(page, 'Intercept');
  expect((await getJSON(page, path)).status).toBe(201);

  await goHome(page);
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Deactivate', exact: true }).click();
  const after = await getJSON(page, path);
  expect(after.status).toBe(200);
  expect(await hits(request, path)).toBeGreaterThan(0);
});

test('M6 the JSON Patch editor and its raw JSON stay in sync, and a bad pointer blocks the save', async ({ page }) => {
  await install(page, [interceptRule('Patch editor', '/api/m6-editor')]);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await panel(page).getByRole('button', { name: /^Patch editor/ }).click();

  // The raw view is a disclosure now, as InterceptRule.html draws it.
  await panel(page).locator('details:has(textarea[aria-label="Response JSON Patch raw JSON"]) > summary').click();
  const raw = panel(page).getByLabel('Response JSON Patch raw JSON');
  await expect(raw).toHaveValue('[]');

  // A row edit rewrites the raw JSON. The card now also carries one-click adds per operation
  // kind, so the dashed button is addressed by its exact name.
  await panel(page).getByRole('button', { name: 'Add operation', exact: true }).first().click();
  // The pointer field carries a suggestion list, so it is addressed by its label, not by role.
  await panel(page).getByLabel('Response JSON Pointer 1').fill('/items/0/name');
  await panel(page).getByLabel('Response JSON value 1').fill('"edited"');
  expect(JSON.parse(await raw.inputValue())).toEqual([{ op: 'replace', path: '/items/0/name', value: 'edited' }]);

  // A raw edit rebuilds the rows, including operations the row form does not default to.
  await raw.fill('[{"op":"move","from":"/a","path":"/b"}]');
  await raw.blur();
  await expect(panel(page).getByLabel('Response from pointer 1')).toHaveValue('/a');

  // InterceptRule.html's one-click adds append an operation of that kind, including the Nullify
  // convenience, which is a replace with a null value rather than a standard operation.
  await raw.fill('[]');
  await raw.blur();
  await panel(page).getByRole('button', { name: 'Add response nullify operation', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Add response remove operation', exact: true }).click();
  expect(JSON.parse(await raw.inputValue())).toEqual([
    { op: 'replace', path: '', value: null },
    { op: 'remove', path: '' },
  ]);
  await expect(panel(page).getByLabel('Response operation 1', { exact: true })).toHaveValue('nullify');
  await expect(panel(page).getByLabel('Response operation 2', { exact: true })).toHaveValue('remove');

  // A blocked pointer is refused with its reason instead of being saved.
  await raw.fill('[{"op":"replace","path":"/__proto__/owned","value":1}]');
  await raw.blur();
  await panel(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel(page).getByText(/blocked path segment/i).first()).toBeVisible();
});

test('M6 the route editor previews the rewrite and refuses an unsupported glob combination', async ({ page }) => {
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Route', exact: true }).click();
  await panel(page).getByRole('button', { name: 'New page rule' }).click();
  await panel(page).getByLabel('URL', { exact: true }).fill('/api/**');
  await panel(page).getByLabel('Path rewrite').fill('/sandbox/**');
  await expect(panel(page).getByText('/api/users/42?active=1 →')).toBeVisible();

  // A single-segment glob cannot feed a trailing capture, and the rule is not saved.
  await panel(page).getByLabel('URL', { exact: true }).fill('/api/*');
  await panel(page).getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(panel(page).getByText(/needs a matcher URL that also ends/i).first()).toBeVisible();
});
