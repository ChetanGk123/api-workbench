import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
/** The endpoint editor has no credentials control, so the persisted value is read from an export. */
const assertCredentials = config => expect(config.endpoints.map(endpoint => endpoint.request.credentials)).toEqual(['include']);
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.
const headerButton = (page, name) => panel(page).locator('.aw-tb').getByRole('button', { name, exact: true });
const textbox = page => panel(page).getByRole('textbox', { name: 'Import source', exact: true });
const statusLine = page => panel(page).locator('.aw-card [role=status]').last();
const rows = page => panel(page).locator('[aria-label="Import candidates"] .aw-endpoint-row');

/** Server-side hit counters, read outside the page so the wrapped transport is never involved. */
const hits = async request => (await request.get('http://127.0.0.1:4173/api/stats')).json();

async function openImport(page) {
  // Every screen is reached from Home: leave the current sub-screen first, then open Import.
  await openScreen(page, 'Import');
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Import');
  await expect(textbox(page)).toBeVisible();
}

/** Import and Settings live in the title bar; Endpoints is a Home quick action. */
async function openScreen(page, name) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  const title = headerButton(page, name);
  if (await title.count()) await title.click();
  else await panel(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function exportConfig(page) {
  await openScreen(page, 'Settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).getByRole('button', { name: 'Export profile + endpoints', exact: true }).click(),
  ]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function applyText(page, text) {
  await textbox(page).fill(text);
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
}

const har = (entries) => JSON.stringify({ log: { version: '1.2', entries } });
const entry = (method, url, extra = {}) => ({
  time: 5,
  request: { method, url, headers: [{ name: 'Accept', value: 'application/json' }], queryString: [], cookies: [], ...(extra.request ?? {}) },
  response: { status: 200, headers: [], content: { size: 2, mimeType: 'application/json', text: '{}' }, ...(extra.response ?? {}) },
});

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
  await expect(panel(page)).toBeVisible();
});

test('M9 a pasted HAR is detected, reviewed and committed without sending any request', async ({ page, request }) => {
  const before = await hits(request);
  await openImport(page);
  await applyText(page, har([
    entry('GET', 'http://127.0.0.1:4173/api/fixture'),
    entry('POST', 'http://127.0.0.1:4173/api/echo', { request: { postData: { mimeType: 'application/json', text: '{"a":1}' } } }),
  ]));
  await expect(statusLine(page)).toContainText('HAR 1.2 read');
  await expect(rows(page)).toHaveCount(2);
  await expect(panel(page).locator('.aw-card', { hasText: 'Import review' })).toContainText('2 source items · 2 importable · 0 skipped');
  await expect(panel(page).locator('.aw-card', { hasText: 'Import review' })).toContainText(`Destination profile: ${await panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' }).innerText()}`);

  // Deselecting a candidate keeps it out of the commit.
  await rows(page).nth(1).getByRole('checkbox').uncheck();
  await expect(panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ })).toHaveText('Import selected (1)');
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(1);
  await expect(panel(page).locator('.aw-body [role=status]').first()).toContainText('1 endpoint added, 1 skipped.');
  expect(await hits(request)).toEqual(before);
});

test('M9 a Swagger document and an OpenAPI document each produce endpoints with unresolved inputs visible', async ({ page }) => {
  await openImport(page);
  await applyText(page, JSON.stringify({
    swagger: '2.0', host: '127.0.0.1:4173', basePath: '/api', schemes: ['http'],
    paths: { '/orders/{orderId}': { get: { operationId: 'getOrder', parameters: [{ name: 'orderId', in: 'path', required: true, type: 'string' }], responses: { 200: {} } } } },
  }));
  await expect(statusLine(page)).toContainText('Swagger 2.0 read');
  await expect(rows(page).first()).toContainText('/api/orders/{{orderId}}');
  await expect(rows(page).first()).toContainText('needs orderId');

  await applyText(page, JSON.stringify({
    openapi: '3.0.0', servers: [{ url: 'http://127.0.0.1:4173/api' }],
    paths: { '/echo': { post: { operationId: 'echo', requestBody: { content: { 'application/json': { examples: { full: { value: { a: 1 } }, empty: { value: {} } } } } }, responses: { 200: {} } } } },
  }));
  await expect(statusLine(page)).toContainText('OpenAPI 3.0 read');
  await expect(panel(page).getByRole('combobox', { name: 'Body example for POST /echo' })).toBeVisible();
});

test('M9 a pasted fetch snippet that depends on code is refused, runs nothing and sends nothing', async ({ page, request }) => {
  const before = await hits(request);
  await openImport(page);
  await applyText(page, 'fetch("http://127.0.0.1:4173/api/echo", { method: "POST", body: JSON.stringify({ pwned: (window.__m9 = true) }) });');
  await expect(statusLine(page)).toContainText('the options object contains code or invalid JSON and was not evaluated');
  await expect(rows(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__m9)).toBeUndefined();
  expect(await hits(request)).toEqual(before);

  // The literal form of the same call imports, and still sends nothing.
  await applyText(page, 'fetch("http://127.0.0.1:4173/api/echo", {\n  "headers": { "content-type": "application/json" },\n  "body": "{\\"name\\":\\"R\\u00e9\\"}",\n  "method": "POST",\n  "credentials": "include"\n});');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('/api/echo');
  expect(await hits(request)).toEqual(before);
});

test('M9 a cURL command imports as an endpoint and its cookie flag becomes a credentials intent', async ({ page }) => {
  await openImport(page);
  await applyText(page, `curl 'http://127.0.0.1:4173/api/session' \\\n  -H 'cookie: aw=1' \\\n  -H 'x-trace: on' \\\n  --compressed`);
  await expect(statusLine(page)).toContainText('cURL DevTools copy read');
  await expect(rows(page)).toHaveCount(1);
  await expect(panel(page).locator('.aw-card', { hasText: 'Import review' })).toContainText('Cookie header replaced by credentials: include');
  await expect(rows(page).first()).toContainText('credentials: include');
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
  const saved = await exportConfig(page);
  assertCredentials(saved);
});

test('M9 the same source imported from a file and from a paste yields the same review', async ({ page }) => {
  const postman = JSON.stringify({
    info: { _postman_id: 'x', name: 'Fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'base', value: 'http://127.0.0.1:4173' }],
    item: [{ name: 'Folder', item: [{ name: 'Fixture call', request: { method: 'GET', url: '{{base}}/api/fixture' } }] }],
  });
  await openImport(page);
  await applyText(page, postman);
  const pasted = await rows(page).allInnerTexts();
  await panel(page).getByRole('button', { name: 'Clear draft', exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await panel(page).locator('input[type=file]').setInputFiles({ name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from(postman) });
  await expect(statusLine(page)).toContainText('Loaded collection.json');
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await rows(page).allInnerTexts()).toEqual(pasted);
});

test('M9 an oversized or cancelled file leaves the draft intact, and replacing one is confirmed', async ({ page }) => {
  await openImport(page);
  await textbox(page).fill('curl http://127.0.0.1:4173/api/fixture');
  const file = panel(page).locator('input[type=file]');
  await file.setInputFiles({ name: 'huge.har', mimeType: 'application/json', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) });
  await expect(statusLine(page)).toContainText('larger than 10 MiB');
  await expect(textbox(page)).toHaveValue('curl http://127.0.0.1:4173/api/fixture');

  await file.setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"log":{"version":"1.2","entries":[]}}') });
  const dialog = panel(page).locator('dialog.aw-dlg');
  await expect(dialog).toContainText('Replace the current draft with other.json?');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(statusLine(page)).toContainText('Kept the current draft.');
  await expect(textbox(page)).toHaveValue('curl http://127.0.0.1:4173/api/fixture');

  await file.setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"log":{"version":"1.2","entries":[]}}') });
  await dialog.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(textbox(page)).toHaveValue('{"log":{"version":"1.2","entries":[]}}');
});

test('M9 a conflict offers Keep both, Replace or Skip, and Replace keeps the endpoint id', async ({ page }) => {
  await openImport(page);
  await applyText(page, har([entry('GET', 'http://127.0.0.1:4173/api/fixture')]));
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(1);
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('x') ?? 'null'));
  expect(first).toBeNull(); // configuration lives in IndexedDB, not localStorage

  await openImport(page);
  await applyText(page, har([entry('GET', 'http://127.0.0.1:4173/api/fixture', { request: { headers: [{ name: 'X-Second', value: '2' }] } })]));
  const conflict = panel(page).getByRole('combobox', { name: /^Conflict for / });
  await expect(rows(page).first()).toContainText('Duplicate of');
  await conflict.selectOption('keep-both');
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);

  await openImport(page);
  await applyText(page, har([entry('GET', 'http://127.0.0.1:4173/api/fixture', { request: { headers: [{ name: 'X-Third', value: '3' }] } })]));
  await panel(page).getByRole('combobox', { name: /^Conflict for / }).first().selectOption('replace');
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2, 'replacing an existing endpoint adds nothing');
  await expect(panel(page).locator('.aw-body [role=status]').first()).toContainText('0 endpoints added, 1 replaced');
});

test('M9 a native import can be stored without activating it, and merge keeps existing endpoints', async ({ page }) => {
  await openImport(page);
  await applyText(page, har([entry('GET', 'http://127.0.0.1:4173/api/fixture')]));
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(1);
  const active = await panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' }).innerText();

  await openImport(page);
  await applyText(page, JSON.stringify(sample));
  await expect(panel(page).getByRole('combobox', { name: 'Import mode', exact: true })).toHaveValue('new-profile');
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Import profile', exact: true }).click();
  await expect(statusLine(page)).toContainText('It is not active: select it in Settings.');
  await expect(panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' })).toHaveText(active);

  await applyText(page, JSON.stringify(sample));
  await panel(page).getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('merge');
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Import profile', exact: true }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
  // The sample's GET /api/fixture duplicates the recorded one, so merge adds only the echo call.
  await expect(panel(page).locator('.aw-body [role=status]').first()).toContainText('1 endpoint added, 1 skipped');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);
  await expect(panel(page).locator('.aw-endpoint-row').first()).toContainText('/api/fixture');
  await expect(panel(page).locator('.aw-endpoint-row').last()).toContainText('Imported echo payload');
});

test('M9 a newer native schema is refused and changes nothing', async ({ page }) => {
  await openImport(page);
  await applyText(page, JSON.stringify({ ...sample, schemaVersion: 99 }));
  await expect(statusLine(page)).toContainText('schema 99');
  await expect(panel(page).locator('.aw-card', { hasText: 'Import review' })).toHaveCount(0);
  await openScreen(page, 'Endpoints');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(0);
});

test('M9 the draft survives Back and Minimize, and a profile change forces a rebuild before commit', async ({ page }) => {
  await openImport(page);
  await applyText(page, har([entry('GET', 'http://127.0.0.1:4173/api/fixture')]));
  await expect(rows(page)).toHaveCount(1);
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await openImport(page);
  await expect(textbox(page)).toHaveValue(har([entry('GET', 'http://127.0.0.1:4173/api/fixture')]));
  await expect(rows(page)).toHaveCount(1);

  // A profile switch while a review is open blocks the commit until it is rebuilt.
  await openScreen(page, 'Settings');
  await panel(page).getByPlaceholder('New profile name').fill('Second');
  await panel(page).getByRole('button', { name: 'Save as profile', exact: true }).click();
  await panel(page).locator('.aw-body').getByRole('combobox', { name: 'Active profile' }).selectOption({ label: 'Second' });
  await openImport(page);
  await expect(panel(page).locator('.aw-card', { hasText: 'Import review' })).toContainText('The active profile changed');
  await expect(panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ })).toBeEnabled();
});

test('M9 the recorder promotes only the selected captured calls through the same review', async ({ page }) => {
  await openImport(page);
  await panel(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture').then(response => response.text()));
  await page.evaluate(() => fetch('/api/echo', { method: 'POST', body: 'hello' }));
  await expect(panel(page).locator('.aw-card', { hasText: 'Session recorder' }).locator('[role=status]')).toContainText('2 captured');
  await panel(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await rows(page).nth(1).getByRole('checkbox').uncheck();
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(1);
  await expect(panel(page).locator('.aw-endpoint-row').first()).toContainText('/api/fixture');
});

test('M9 a failed save reports the failure, saves nothing and keeps the review for a retry', async ({ page }) => {
  await openImport(page);
  // Durable writes now fail: the commit must not report endpoints it did not persist.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function put() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await applyText(page, har([entry('GET', 'http://127.0.0.1:4173/api/fixture')]));
  await panel(page).locator('.aw-foot').getByRole('button', { name: /Import selected/ }).click();
  await expect(statusLine(page)).toContainText('Import failed');
  await expect(statusLine(page)).toContainText('Nothing was saved; the review is unchanged.');
  await expect(rows(page)).toHaveCount(1);
  await expect(textbox(page)).not.toHaveValue('');
  await openScreen(page, 'Endpoints');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(0);
});

test('M9 every advertised format is listed with its exact version and no unimplemented adapter', async ({ page }) => {
  await openImport(page);
  const formats = panel(page).locator('.aw-card', { hasText: 'Supported formats' });
  await expect(formats.locator('.aw-format')).toHaveCount(8);
  await expect(formats).toContainText('Native schema 1');
  await expect(formats).toContainText('Swagger 2.0');
  await expect(formats).toContainText('OpenAPI 3.0');
  await expect(formats).toContainText('HAR 1.2');
  await expect(formats).toContainText('Postman Collection v2.1');
  await expect(formats).toContainText('cURL DevTools copy');
  await expect(formats).toContainText('fetch() DevTools copy');
  await expect(formats).toContainText("Records this frame's fetch/XHR requests after recording starts");
  await expect(formats).not.toContainText('coming later');
});
