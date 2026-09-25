import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const body = page => panel(page).locator('.aw-body');
const context = page => page.context();
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.
const headerButton = (page, name) => panel(page).locator('.aw-tb').getByRole('button', { name, exact: true });
// The update check reads the deployed site. Every test that presses the button decides what that
// site returns, so no test depends on what is really deployed or on being online.
const SITE = 'https://chetangk123.github.io/api-workbench/';
const publishes = (page, version, bookmarklet) => Promise.all([
  page.route(`${SITE}version.json`, route =>
    version === null ? route.abort('failed') : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version }) })),
  page.route(`${SITE}bookmarklet.txt`, route =>
    bookmarklet === undefined ? route.abort('failed') : route.fulfill({ contentType: 'text/plain', body: bookmarklet })),
]);
const buildVersion = JSON.parse(await readFile('package.json', 'utf8')).version;

let seq = 0;
const base = (label, url, kind) => ({
  id: `rule-${++seq}`, profileId: sample.profile.id, label, kind, enabled: true, priority: 0, seq, revision: 1,
  matcher: { method: '*', url, query: '', headers: '', bodyContains: '' },
});
const mockRule = (label, url) => ({
  ...base(label, url, 'mock'), mode: 'static', exhaustion: 'repeat-last',
  slots: [{ status: 200, headers: 'Content-Type: application/json', body: '{"mocked":true}', delayMs: 0, fault: 'none' }],
});
const transform = () => ({ setHeaders: '', removeHeaders: '', patch: [], body: { find: '', replace: '', scope: 'first' }, status: 0 });
// A rule that changes nothing is not applied, so the response carries a header for it to log.
const interceptRule = (label, url) => ({
  ...base(label, url, 'intercept'), request: transform(), response: { ...transform(), setHeaders: 'x-edited: yes' },
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

async function openSettings(page) {
  await headerButton(page, 'Settings').click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Settings');
}

async function activate(page, module) {
  await goHome(page);
  await panel(page).getByRole('button', { name: module, exact: true }).click();
  await panel(page).getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
}

const get = (page, url) => page.evaluate(target => fetch(target).then(response => response.text()), url);

const storedConfig = page => page.evaluate(async () => {
  const database = await new Promise(resolve => { const request = indexedDB.open('api-workbench', 1); request.onsuccess = () => resolve(request.result); });
  return new Promise(resolve => {
    const read = database.transaction('configs', 'readonly').objectStore('configs').get(location.origin);
    read.onsuccess = () => resolve(read.result ?? null);
  });
});

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });

test('a module switched off in Settings loses its tab and its Home card, and comes back', async ({ page }) => {
  await launch(page);
  await openSettings(page);
  await expect(body(page).getByRole('switch', { name: 'Chaos Engineering' })).toHaveAttribute('aria-checked', 'true');
  await body(page).getByRole('switch', { name: 'Chaos Engineering' }).click();
  await expect(body(page).getByRole('switch', { name: 'Chaos Engineering' })).toHaveAttribute('aria-checked', 'false');
  await goHome(page);
  await expect(panel(page).locator('.aw-tabs').getByRole('button', { name: 'Chaos', exact: true })).toBeHidden();
  await expect(panel(page).locator('.aw-tabs').getByRole('button', { name: 'Mock', exact: true })).toBeVisible();
  await expect(body(page).getByText('Chaos Engineering')).toHaveCount(0);

  // The switch is part of the profile, so a relaunch on this origin still hides it.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await expect(panel(page).locator('.aw-tabs').getByRole('button', { name: 'Chaos', exact: true })).toBeHidden();
  await openSettings(page);
  await body(page).getByRole('switch', { name: 'Chaos Engineering' }).click();
  await goHome(page);
  await expect(panel(page).locator('.aw-tabs').getByRole('button', { name: 'Chaos', exact: true })).toBeVisible();
});

test('the traffic log keeps the number of entries its module is set to', async ({ page }) => {
  await launch(page);
  await install(page, [mockRule('mocked', '/api/settings-log')]);
  await activate(page, 'Mock');
  await openSettings(page);
  await body(page).getByRole('spinbutton', { name: 'Max traffic log entries (Mock Server)' }).fill('2');
  await body(page).getByRole('spinbutton', { name: 'Max traffic log entries (Mock Server)' }).blur();
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  for (const index of [1, 2, 3, 4]) await get(page, '/api/settings-log');
  // The cap trims the log, not the counting: the rule still reports all four hits.
  const log = body(page).locator('.aw-card.aw-list').last();
  await expect(log.locator('.aw-li')).toHaveCount(2);
  await expect(body(page).getByText('4 hits')).toBeVisible();

  // Reset puts the default back.
  await openSettings(page);
  await body(page).getByRole('button', { name: 'Reset max traffic log entries (Mock Server)' }).click();
  await expect(body(page).getByRole('spinbutton', { name: 'Max traffic log entries (Mock Server)' })).toHaveValue('50');
});

test('response bodies reach the intercept traffic log only while Settings asks for them', async ({ page }) => {
  await launch(page);
  await install(page, [interceptRule('watch', '/api/fixture')]);
  await activate(page, 'Intercept');
  await get(page, '/api/fixture');
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  await expect(body(page).locator('.aw-card.aw-list').last().locator('.aw-li')).toHaveCount(1);
  await expect(body(page).locator('details', { hasText: 'Response body' })).toHaveCount(0);

  await openSettings(page);
  await body(page).getByRole('checkbox', { name: 'Store response bodies in traffic log' }).click();
  await goHome(page);
  await get(page, '/api/fixture');
  await panel(page).getByRole('button', { name: 'Intercept', exact: true }).click();
  const stored = body(page).locator('details', { hasText: 'Response body' }).first();
  await expect(stored).toBeVisible();
  await stored.locator('summary').click();
  await expect(stored.locator('pre')).toContainText('fixture');
});

test('Max captures caps the recorder draft', async ({ page }) => {
  await launch(page);
  await openSettings(page);
  await body(page).getByRole('spinbutton', { name: 'Max captures (Recorder)' }).fill('1');
  await body(page).getByRole('spinbutton', { name: 'Max captures (Recorder)' }).blur();
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Record', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await get(page, '/api/fixture');
  await get(page, '/api/echo');
  await expect(panel(page).getByText(/1 captured/)).toBeVisible();
});

test('switching the recorder off closes the Record screen and stops a recording', async ({ page }) => {
  await launch(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Record', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await openSettings(page);
  await body(page).getByRole('switch', { name: 'Recorder' }).click();

  await goHome(page);
  await expect(panel(page).getByRole('button', { name: 'Record', exact: true })).toHaveCount(0);
  await openSettings(page);
  await body(page).getByRole('switch', { name: 'Recorder' }).click();
  await goHome(page);
  await expect(panel(page).getByRole('button', { name: 'Record', exact: true })).toBeVisible();
  // Switching it off stopped the recording, so the screen comes back ready to start again.
  await panel(page).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
  await expect(panel(page).getByRole('button', { name: 'Stop recording', exact: true })).toBeDisabled();
});

test('Save stores the live profile so a switch away and back returns to it', async ({ page }) => {
  await launch(page);
  await install(page, []);
  await openSettings(page);
  await body(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Alpha');
  await body(page).getByRole('button', { name: 'Save profile', exact: true }).click();
  await body(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Beta');
  await body(page).getByRole('button', { name: 'Save as copy', exact: true }).click();

  const active = body(page).getByRole('combobox', { name: 'Active profile' });
  await active.selectOption({ label: 'Beta' });
  await body(page).getByRole('button', { name: 'Load profile', exact: true }).click();
  await expect(panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' })).toHaveText('Beta');
  await openSettings(page);
  await body(page).getByRole('combobox', { name: 'Active profile' }).selectOption({ label: 'Alpha' });
  await body(page).getByRole('button', { name: 'Load profile', exact: true }).click();
  await expect(panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' })).toHaveText('Alpha');
  // Alpha came back with the endpoints it was saved with.
  await goHome(page);
  await panel(page).getByRole('button', { name: /^Endpoints/ }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(sample.endpoints.length);
});

const copyButton = page => body(page).getByRole('button', { name: 'Copy new bookmarklet', exact: true });

test('Check for update reports a newer published version, and offers its bookmarklet', async ({ page }) => {
  await publishes(page, '99.9.9', 'javascript:void%20function()%7B/*99.9.9*/%7D()');
  await context(page).grantPermissions(['clipboard-read', 'clipboard-write']);
  await launch(page);
  await openSettings(page);
  await expect(copyButton(page)).toBeHidden();
  await body(page).getByRole('button', { name: 'Check for update', exact: true }).click();
  await expect(body(page).getByText(/Version 99\.9\.9 has been published/)).toBeVisible();

  // Copied, never applied: the clipboard carries the new text and this build keeps running.
  await copyButton(page).click();
  await expect(body(page).getByText(/Version 99\.9\.9 is on the clipboard/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('javascript:void%20function()%7B/*99.9.9*/%7D()');
  await expect(body(page).locator('.aw-card', { hasText: 'About API Workbench' })).toContainText(buildVersion);

  // The published version matching this build is the one answer the origin note cannot give.
  await publishes(page, buildVersion);
  await body(page).getByRole('button', { name: 'Check for update', exact: true }).click();
  await expect(body(page).getByText(`Up to date: ${buildVersion} is the published version.`)).toBeVisible();
  await expect(copyButton(page)).toBeHidden();
});

test('a published bookmarklet that is not what was promised is refused, not copied', async ({ page }) => {
  // A deployment that has uploaded version.json but not yet the bookmarklet would otherwise hand
  // over the build the user is already running, reported as the update.
  await publishes(page, '99.9.9', 'javascript:void%20function()%7B/*1.0.0*/%7D()');
  await context(page).grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('untouched'));
  await launch(page);
  await openSettings(page);
  await body(page).getByRole('button', { name: 'Check for update', exact: true }).click();
  await copyButton(page).click();
  await expect(body(page).getByText(/the published bookmarklet is not 99\.9\.9/)).toBeVisible();
  await expect(body(page).getByText(/This bookmark is unchanged/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('untouched');
});

test("Check for update survives a page whose CSP refuses the manifest", async ({ page }) => {
  // connect-src 'self' is the ordinary reason the read fails in a real application: the request is
  // refused by the host page, not by the network, and the check has to report rather than throw.
  await page.goto('/policy/strict');
  await launch(page);
  await openSettings(page);
  await body(page).getByRole('button', { name: 'Check for update', exact: true }).click();
  await expect(body(page).locator('.aw-card', { hasText: 'About API Workbench' }).locator('[role=status]'))
    .toHaveText(`Up to date: no build newer than ${buildVersion} has run on this origin.`);
});

test('Check for update falls back to the origin note when the published version cannot be read', async ({ page }) => {
  await publishes(page, null);
  await launch(page);
  await openSettings(page);
  await body(page).getByRole('button', { name: 'Check for update', exact: true }).click();
  // The About card's own status line, not any prose on the screen that mentions the origin.
  await expect(body(page).locator('.aw-card', { hasText: 'About API Workbench' }).locator('[role=status]')).toContainText(/this origin/);
  // A newer build recorded here means the running bookmark is the stale copy.
  await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('api-workbench', 1); request.onsuccess = () => resolve(request.result); });
    await new Promise(resolve => {
      const write = database.transaction('configs', 'readwrite');
      write.objectStore('configs').put('99.0.0', `version:${location.origin}`);
      write.oncomplete = resolve;
    });
  });
  await body(page).getByRole('button', { name: 'Check for update', exact: true }).click();
  await expect(body(page).getByText(/A newer build \(99\.0\.0\)/)).toBeVisible();
});

test('Clear stored data asks first, then empties this origin', async ({ page }) => {
  await launch(page);
  await install(page, [mockRule('mocked', '/api/settings-clear')]);
  expect(await storedConfig(page)).not.toBeNull();
  await openSettings(page);

  await body(page).getByRole('button', { name: 'Clear stored data', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await storedConfig(page)).endpoints.length).toBe(sample.endpoints.length);

  await body(page).getByRole('button', { name: 'Clear stored data', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(body(page).getByRole('combobox', { name: 'Active profile' })).toHaveValue('default');
  const after = await storedConfig(page);
  expect(after.endpoints).toEqual([]);
  expect(after.rules ?? []).toEqual([]);
});

test('Page context globals lists what the named root holds', async ({ page }) => {
  await page.evaluate(() => { window.__awDemo = { baseUrl: 'https://api.example.test', token: 'abcdef123456' }; });
  await launch(page);
  await openSettings(page);
  const globals = panel(page).locator('details', { hasText: 'Page context globals' });
  await globals.locator('summary').click();
  await globals.getByRole('textbox', { name: 'Global roots (comma separated)' }).fill('__awDemo');
  await globals.getByRole('textbox', { name: 'Global roots (comma separated)' }).blur();
  await expect(globals.getByText('__awDemo.baseUrl')).toBeVisible();
  // Previews are masked, never the whole value.
  await expect(globals.getByText('abcdef123456')).toHaveCount(0);
  await expect(globals.getByText(/abc…6 \(12 chars\)/)).toBeVisible();

  // Test's Scan page starts from the roots Settings holds.
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
  await panel(page).locator('details', { hasText: 'Page context' }).first().locator('summary').click();
  await expect(panel(page).getByRole('textbox', { name: 'Global roots (comma separated)' })).toHaveValue('__awDemo');
});

test('a refused write is reported on every screen, with the way out beside it', async ({ page }) => {
  await launch(page);
  const banner = panel(page).locator('.aw-banner');
  await expect(banner).toBeHidden();

  // Every IndexedDB write refuses, the way a blocked-site-data or out-of-quota context does.
  await page.evaluate(() => { IDBObjectStore.prototype.put = function put() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await panel(page).getByRole('button', { name: /^Endpoints/ }).click();
  await panel(page).getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Changes are not being saved: Quota exceeded');
  await expect(banner).toContainText('only in this tab');
  // It is chrome, not screen content: it survives navigation.
  await panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' }).click();
  await expect(banner).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    banner.getByRole('button', { name: 'Export now', exact: true }).click(),
  ]);
  expect(await download.suggestedFilename()).toMatch(/\.json$/);

  // A write that lands clears it again, rather than leaving a warning that outlives the problem.
  await page.evaluate(() => { IDBObjectStore.prototype.put = IDBObjectStore.prototype.__original ?? IDBObjectStore.prototype.put; });
  await page.reload();
  await launch(page);
  await expect(panel(page).locator('.aw-banner')).toBeHidden();
});

test('a backup carries every stored profile, and restoring one replaces the lot', async ({ page }) => {
  await launch(page);
  // Two profiles, so the backup has something the single-profile export would drop.
  await openSettings(page);
  await panel(page).locator('.aw-body').getByRole('textbox', { name: 'Name', exact: true }).fill('Second');
  await panel(page).getByRole('button', { name: 'Save as copy', exact: true }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).getByRole('button', { name: 'Export all data', exact: true }).click(),
  ]);
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(backup.savedProfiles.length).toBeGreaterThan(0);
  expect(backup).toHaveProperty('savedPlans');

  // Wipe everything, then restore the backup over the empty state.
  await panel(page).getByRole('button', { name: 'Clear stored data', exact: true }).click();
  await panel(page).locator('dialog.aw-dlg').getByRole('button', { name: 'Clear', exact: true }).click();
  await openSettings(page);
  await expect(panel(page).getByRole('combobox', { name: 'Active profile' }).locator('option')).toHaveCount(1);

  await panel(page).locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await panel(page).locator('dialog.aw-dlg').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(panel(page).locator('.aw-card [role=status]').last()).toContainText('stored profile');
  await openSettings(page);
  await expect(panel(page).getByRole('combobox', { name: 'Active profile' }).locator('option')).toHaveCount(2);
});

/** The build under test, so a version bump in package.json does not have to be repeated here. */

const storedVersion = page => page.evaluate(() => new Promise(resolve => {
  const request = indexedDB.open('api-workbench');
  request.onsuccess = () => {
    const database = request.result;
    const read = database.transaction('configs', 'readonly').objectStore('configs').get(`version:${location.origin}`);
    read.onsuccess = () => { database.close(); resolve(read.result ?? null); };
  };
}));

test('a newer bookmark launched over a running one is recorded, so the check can report it', async ({ page }) => {
  await launch(page);
  await expect(panel(page)).toBeVisible();

  // Wind the origin's note back, and make the running instance claim to be the older build: the
  // next launch is then a newer bookmark meeting an older one, which is the reported case.
  await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('api-workbench');
    request.onsuccess = () => {
      const database = request.result;
      const write = database.transaction('configs', 'readwrite');
      write.objectStore('configs').put('0.9.0', `version:${location.origin}`);
      write.oncomplete = () => { database.close(); resolve(); };
    };
  }));
  expect(await storedVersion(page)).toBe('0.9.0');
  await page.evaluate(() => {
    const key = '__api_workbench_7f49a1_v1__';
    const running = window[key];
    window[key] = { ...running, version: '0.9.0', restore: running.restore, notify: running.notify };
  });

  // The launch does not take over — but it ran here, and that is the only thing this origin can
  // know about a newer build, so it is recorded rather than lost.
  await launch(page);
  await panel(page).locator('dialog.aw-dlg').getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => storedVersion(page)).toBe(buildVersion);

  // And the button says what it compares, rather than implying it asks a server.
  await openSettings(page);
  await expect(body(page).getByText(/Reads the published version from the deployed installer/)).toBeVisible();
});
