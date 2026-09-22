import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const launch = page => page.evaluate(source); // Transport tests only; NOT saved-bookmark proof.
const mock = async (page, delay = 0) => {
  await page.getByRole('checkbox').check();
  await page.getByLabel('Mock delay').fill(String(delay));
  await page.getByLabel('Mock delay').dispatchEvent('change');
};
const stats = async request => (await request.get('/api/stats')).json();
const hit = (values, path = '/api/mock-target') => values[path] || 0;
async function xhrCall(page, options = {}) {
  return page.evaluate(options => new Promise(resolve => {
    const xhr = new XMLHttpRequest(), events = [];
    let properties = 0;
    xhr.onload = () => properties++;
    for (const type of ['readystatechange', 'loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend'])
      xhr.addEventListener(type, event => {
        events.push(`${type}:${xhr.readyState}`);
        if (type === 'loadend') resolve({ events, status: xhr.status, body: xhr.response,
          url: xhr.responseURL, header: xhr.getResponseHeader('Content-Type'), properties,
          targetCorrect: event.target === xhr, instance: xhr instanceof XMLHttpRequest });
      });
    xhr.open('GET', options.path || '/api/mock-target');
    xhr.responseType = options.responseType || 'text';
    xhr.timeout = options.timeout || 0;
    xhr.send();
    if (options.abort) setTimeout(() => xhr.abort(), 15);
  }), options);
}

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });
test('build installer, encoded payload and no runtime downloads', async ({ page, browser }, info) => {
  console.log('Browser:', browser.version(), 'channel:', process.env.AW_BROWSER || 'chrome');
  await info.attach('browser-version', { body: browser.version() });
  const requests = []; page.on('request', r => requests.push(r.url()));
  expect(await launch(page)).toBeUndefined();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.waitForTimeout(100);
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'test-results/m0-panel.png' });
  await page.goto('/install.html');
  expect(await page.getByRole('link', { name: 'API Workbench M0', exact: true }).getAttribute('href')).toBe(bookmark);
});
test('duplicate launch, minimize, close and exact hook restoration', async ({ page }) => {
  await page.evaluate(() => { window.original = { fetch, xhr: XMLHttpRequest }; });
  await launch(page);
  await page.evaluate(() => { window.hooks = { fetch, xhr: XMLHttpRequest }; });
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await launch(page);
  await expect(page.getByRole('checkbox')).toBeVisible();
  expect(await page.locator('#api-workbench-m0').count()).toBe(1);
  expect(await page.evaluate(() => fetch === hooks.fetch && XMLHttpRequest === hooks.xhr)).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => fetch === original.fetch && XMLHttpRequest === original.xhr)).toBe(true);
  await launch(page); await expect(page.getByRole('checkbox')).not.toBeChecked();
});
test('session and fetch pass-through preserve options, HTTP errors and bodies', async ({ page, request }) => {
  await launch(page); await page.evaluate(() => fetch('/login'));
  expect(await page.evaluate(() => document.cookie)).not.toContain('aw_fixture_session');
  expect(await page.evaluate(async () => (await (await fetch('/api/session')).json()).authenticated)).toBe(true);
  expect(await page.evaluate(async () => (await (await fetch('/api/session', { credentials: 'omit' })).json()).authenticated)).toBe(false);
  const before = await stats(request);
  expect(await page.evaluate(async () => (await (await fetch('/api/mock-target')).json()).source)).toBe('network');
  expect(hit(await stats(request)) - hit(before)).toBe(1);
  expect(await page.evaluate(async () => (await fetch('/api/error')).status)).toBe(503);
  expect(await page.evaluate(async () => {
    const req = new Request(location.origin + '/api/echo', { method: 'POST', body: 'original' });
    return (await fetch(req, { body: 'override', headers: { 'X-Fixture': 'kept' } })).json();
  })).toEqual({ method: 'POST', body: 'override', header: 'kept' });
});
test('fetch mock is a Response, Unicode survives, zero upstream requests, exact matcher', async ({ page, request }) => {
  await launch(page); await mock(page);
  const before = await stats(request);
  const result = await page.evaluate(async () => {
    const response = await fetch(new Request(location.origin + '/api/mock-target'));
    return { isResponse: response instanceof Response, status: response.status, body: await response.json() };
  });
  expect(result).toEqual({ isResponse: true, status: 200, body: { source: 'workbench', message: 'Mock response — café ✓' } });
  expect(hit(await stats(request))).toBe(hit(before));
  expect(await page.evaluate(async () => (await (await fetch('/api/mock-target?unmatched=1')).json()).source)).toBe('network');
});
test('XHR network/mock states, native objects, properties, responseType and session', async ({ page, request }) => {
  await launch(page); await page.evaluate(() => fetch('/login'));
  expect(JSON.parse((await xhrCall(page, { path: '/api/session' })).body).authenticated).toBe(true);
  let before = await stats(request);
  const real = await xhrCall(page);
  expect(JSON.parse(real.body).source).toBe('network');
  expect(hit(await stats(request)) - hit(before)).toBe(1);
  await mock(page); before = await stats(request);
  const synthetic = await xhrCall(page);
  expect(synthetic.events).toEqual(real.events);
  expect(synthetic.events).toEqual(['readystatechange:1', 'loadstart:1', 'readystatechange:2', 'readystatechange:3', 'progress:3', 'readystatechange:4', 'load:4', 'loadend:4']);
  expect(synthetic).toMatchObject({ status: 200, properties: 1, instance: true, targetCorrect: true, header: 'application/json' });
  expect(JSON.parse(synthetic.body).source).toBe('workbench');
  expect((await xhrCall(page, { responseType: 'json' })).body.source).toBe('workbench');
  expect(hit(await stats(request))).toBe(hit(before));
});
test('fetch abort before/during delay and native slow request abort', async ({ page, request }) => {
  await launch(page); await mock(page, 1000); const before = await stats(request);
  for (const immediate of [true, false]) {
    expect(await page.evaluate(async immediate => {
      const controller = new AbortController();
      if (immediate) controller.abort('cancelled'); else setTimeout(() => controller.abort('cancelled'), 10);
      try { await fetch('/api/mock-target', { signal: controller.signal }); return 'unexpected'; } catch (e) { return e; }
    }, immediate)).toBe('cancelled');
  }
  expect(hit(await stats(request))).toBe(hit(before));
  expect(await page.evaluate(async () => {
    const controller = new AbortController(); setTimeout(() => controller.abort(), 10);
    try { await fetch('/api/slow', { signal: controller.signal }); } catch (e) { return e.name; }
  })).toBe('AbortError');
});
test('XHR abort and timeout event sequence matches native slow transport', async ({ page, request }) => {
  await launch(page);
  const nativeAbort = await xhrCall(page, { path: '/api/slow', abort: true });
  const nativeTimeout = await xhrCall(page, { path: '/api/slow', timeout: 20 });
  await mock(page, 1000); const before = await stats(request);
  const aborted = await xhrCall(page, { abort: true });
  const timeout = await xhrCall(page, { timeout: 20 });
  expect(aborted.events).toEqual(nativeAbort.events);
  expect(timeout.events).toEqual(nativeTimeout.events);
  expect(aborted.status).toBe(0); expect(timeout.status).toBe(0);
  expect(hit(await stats(request))).toBe(hit(before));
});
test('XHR reuse and synchronous pass-through', async ({ page, request }) => {
  await launch(page); await mock(page);
  const before = await stats(request);
  const result = await page.evaluate(async () => {
    const xhr = new XMLHttpRequest();
    let opened = 0;
    xhr.onreadystatechange = () => { if (xhr.readyState === 1) opened++; };
    const run = path => new Promise(resolve => { xhr.onload = () => resolve(JSON.parse(xhr.responseText).source); xhr.open('GET', path); xhr.send(); });
    const first = await run('/api/mock-target'), second = await run('/api/echo');
    xhr.open('GET', '/api/mock-target', false); xhr.send();
    return { first, second, opened, sync: JSON.parse(xhr.responseText).source };
  });
  expect(result.first).toBe('workbench'); expect(result.sync).toBe('network');
  expect(result.opened).toBe(3);
  expect(hit(await stats(request)) - hit(before)).toBe(1);
});
test('wrappers installed before Workbench remain captured and restored', async ({ page }) => {
  await page.evaluate(() => {
    const f = fetch, X = XMLHttpRequest;
    window.before = { fetch: (...args) => f(...args), xhr: class extends X {} };
    window.fetch = before.fetch; window.XMLHttpRequest = before.xhr;
  });
  await launch(page); await mock(page);
  expect(JSON.parse((await xhrCall(page)).body).source).toBe('workbench');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => fetch === before.fetch && XMLHttpRequest === before.xhr)).toBe(true);
});
test('close settles owned delays and leaves page requests and later wrappers intact', async ({ page, request }) => {
  await launch(page); await mock(page, 10000);
  const before = await stats(request);
  await page.evaluate(() => {
    const f = fetch, X = XMLHttpRequest;
    window.later = { fetch: (...args) => f(...args), xhr: class extends X {} };
    window.fetch = later.fetch; window.XMLHttpRequest = later.xhr;
    window.pending = Promise.all([fetch('/api/mock-target').then(r => r.json()), new Promise(resolve => {
      const x = new XMLHttpRequest(); x.onload = () => resolve(JSON.parse(x.responseText)); x.open('GET', '/api/mock-target'); x.send();
    }), fetch('/api/slow').then(r => r.json())]);
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const result = await page.evaluate(() => pending);
  expect(result.map(r => r.source)).toEqual(['workbench', 'workbench', 'network']);
  expect(hit(await stats(request))).toBe(hit(before));
  expect(await page.evaluate(() => fetch === later.fetch && XMLHttpRequest === later.xhr)).toBe(true);
  expect(await page.evaluate(async () => (await (await fetch('/api/mock-target')).json()).source)).toBe('network');
  expect(JSON.parse((await xhrCall(page)).body).source).toBe('network');
});
test('CORS allows one origin and denies response access for the other route', async ({ page }) => {
  await launch(page);
  expect(await page.evaluate(async () => (await (await fetch('http://127.0.0.1:4174/api/cors-allowed')).json()).source)).toBe('network');
  expect(await page.evaluate(async () => {
    try { await fetch('http://127.0.0.1:4174/api/cors-denied'); } catch (e) { return e.name; }
  })).toBe('TypeError');
  expect((await xhrCall(page, { path: 'http://127.0.0.1:4174/api/cors-allowed' })).status).toBe(200);
  expect((await xhrCall(page, { path: 'http://127.0.0.1:4174/api/cors-denied' })).events).toContain('error:4');
});
test('policy operation checks under injected launch (not bookmark CSP proof)', async ({ page }) => {
  await page.goto('/policy/strict'); await launch(page);
  expect(await page.locator('#api-workbench-m0 .aw-root').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(9, 9, 11)');
  expect(await page.evaluate(async () => (await fetch('/api/session')).status)).toBe(200);
  await page.goto('/policy/blocked'); await launch(page);
  expect(await page.evaluate(async () => { try { await fetch('/api/session'); } catch (e) { return e.name; } })).toBe('TypeError');
  await mock(page); expect(await page.evaluate(async () => (await (await fetch('/api/mock-target')).json()).source)).toBe('workbench');
});
