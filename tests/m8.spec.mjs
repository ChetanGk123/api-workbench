import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.

const endpoint = (alias, method, path, extra = {}) => ({
  id: `endpoint-${alias}`, profileId: sample.profile.id, alias, name: alias, hostKey: 'default',
  request: { method, path, headers: [], bodyKind: 'none', body: '', credentials: 'same-origin', ...(extra.request ?? {}) },
  checks: extra.checks ?? [{ kind: 'status', value: { min: 200, max: 299 } }],
  createdAt: 1727049600000, updatedAt: 1727049600000,
});

const plan = (overrides = {}) => ({
  id: 'plan-test', profileId: sample.profile.id, name: 'Fixture Plan', strategy: 'flow', mode: 'direct',
  phases: {}, excluded: [], iterations: 1, concurrency: 1, delayMs: 0, rampUp: false,
  onFailure: 'continue', notifyOnComplete: false, bindings: [], ...overrides,
});

async function install(page, endpoints, planOverrides) {
  await panel(page).locator('.aw-tb').getByRole('button', { name: 'Import', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Import source', exact: true }).fill(JSON.stringify({ ...sample, endpoints, plan: plan(planOverrides) }));
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await panel(page).getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('replace');
  await panel(page).getByRole('button', { name: 'Import profile', exact: true }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
}

async function openLoad(page) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
}

/** Server-side hit counters, read outside the page so the wrapped transport is never involved. */
async function hits(request) {
  return (await request.get('http://127.0.0.1:4173/api/stats')).json();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
  await expect(panel(page)).toBeVisible();
});

test('M8 the Load view states the planned request count, destinations and mode before dispatch', async ({ page }) => {
  await install(page, [endpoint('seed', 'GET', '/api/seed'), endpoint('child', 'POST', '/api/child')], { iterations: 4 });
  await openLoad(page);
  const preflight = panel(page).locator('.aw-card', { hasText: 'Before dispatch' });
  await expect(preflight).toContainText('8 requests planned');
  await expect(preflight).toContainText('http://127.0.0.1:4173');
  await expect(preflight).toContainText('Direct — active rules are bypassed');
  await expect(preflight).toContainText('Can change data: child');
  await expect(panel(page).locator('.aw-foot')).toContainText('2 selected · 4×1');
});

test('M8 a Flow iteration passes its own producer value to its own consumer', async ({ page, request }) => {
  const before = await hits(request);
  await install(
    page,
    [
      endpoint('seed', 'GET', '/api/m8-seed'),
      endpoint('child', 'GET', '/api/m8-child-{{seed.hit}}'),
    ],
    { iterations: 3 },
  );
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  await expect(panel(page).locator('.aw-big').first()).toHaveText('6');

  const after = await hits(request);
  const delta = path => (after[path] ?? 0) - (before[path] ?? 0);
  expect(delta('/api/m8-seed')).toBe(3);
  // Each iteration used the hit count its own seed returned, so the three children are distinct.
  expect([1, 2, 3].map(index => delta(`/api/m8-child-${index}`))).toEqual([1, 1, 1]);
});

test('M8 a setup step runs once for the run and its output is shared by every iteration', async ({ page, request }) => {
  const before = await hits(request);
  await install(
    page,
    [
      endpoint('setup_seed', 'GET', '/api/m8-setup-seed'),
      endpoint('load_child', 'GET', '/api/m8-setup-child-{{setup_seed.hit}}'),
    ],
    { iterations: 3, phases: { 'endpoint-setup_seed': 'setup' } },
  );
  await openLoad(page);
  await expect(panel(page).locator('.aw-card', { hasText: 'Before dispatch' })).toContainText('4 requests planned · 1 setup');
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });

  const after = await hits(request);
  const delta = path => (after[path] ?? 0) - (before[path] ?? 0);
  expect(delta('/api/m8-setup-seed')).toBe(1);
  expect(delta('/api/m8-setup-child-1')).toBe(3);
});

test('M8 an Independent plan that reads another load endpoint is refused before it runs', async ({ page, request }) => {
  const before = await hits(request);
  await install(
    page,
    [endpoint('seed', 'GET', '/api/m8-indep-seed'), endpoint('child', 'GET', '/api/m8-indep-child/{{seed.hit}}')],
    { strategy: 'independent', iterations: 2 },
  );
  await openLoad(page);
  const preflight = panel(page).locator('.aw-card', { hasText: 'Before dispatch' });
  await expect(preflight).toContainText('cannot read "seed" from another load endpoint');
  await expect(preflight).toContainText('Switch to Flow, or promote "seed" to setup');
  await expect(panel(page).getByRole('button', { name: 'Run Load' })).toBeDisabled();

  // Promoting the producer to setup makes the same plan valid, and only then does anything dispatch.
  const after = await hits(request);
  expect((after['/api/m8-indep-seed'] ?? 0) - (before['/api/m8-indep-seed'] ?? 0)).toBe(0);
  await panel(page).locator('.aw-li', { hasText: 'seed' }).first().getByRole('button', { name: 'To setup' }).click();
  await expect(panel(page).getByRole('button', { name: 'Run Load' })).toBeEnabled();
});

test('M8 Independent aggregates by endpoint and dispatches endpoints × iterations requests', async ({ page, request }) => {
  const before = await hits(request);
  await install(page, [endpoint('one', 'GET', '/api/m8-indep-one'), endpoint('two', 'GET', '/api/m8-indep-two')], {
    strategy: 'independent', iterations: 3, concurrency: 2,
  });
  await openLoad(page);
  await expect(panel(page).locator('.aw-card', { hasText: 'Before dispatch' })).toContainText('6 requests planned');
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  await expect(panel(page).locator('.aw-big').first()).toHaveText('6');
  const after = await hits(request);
  expect((after['/api/m8-indep-one'] ?? 0) - (before['/api/m8-indep-one'] ?? 0)).toBe(3);
  expect((after['/api/m8-indep-two'] ?? 0) - (before['/api/m8-indep-two'] ?? 0)).toBe(3);
});

test('M8 a failed check is counted as a failed check, not as a network error', async ({ page }) => {
  await install(page, [endpoint('boom', 'GET', '/api/error', { checks: [{ kind: 'status', value: 200 }] })], { iterations: 2 });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  const breakdown = panel(page).locator('.aw-card', { hasText: 'Outcome breakdown' });
  await expect(breakdown).toContainText('Failed checks');
  await expect(breakdown).not.toContainText('Network error');
  await expect(panel(page).locator('.aw-big').nth(1)).toHaveText('2');
});

test('M8 Stop ends the run and reports it as stopped', async ({ page }) => {
  await install(page, [endpoint('slow', 'GET', '/api/slow')], { iterations: 20 });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('running');
  await panel(page).locator('.aw-foot').getByRole('button', { name: 'Stop' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('stopped', { timeout: 15000 });
  // 20 iterations of a 1.5 s endpoint cannot have completed in the time before Stop.
  const completed = await panel(page).locator('.aw-xs.aw-mu').first().textContent();
  expect(Number(completed.match(/(\d+) of 20 requests/)[1])).toBeLessThan(20);
});

test('M8 a run exports as JSON and CSV with the run statistics', async ({ page }) => {
  await install(page, [endpoint('one', 'GET', '/api/m8-export')], { iterations: 2 });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  for (const [label, extension] of [['JSON', 'json'], ['CSV', 'csv']]) {
    const download = page.waitForEvent('download');
    await panel(page).locator('.aw-foot').getByRole('button', { name: label, exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
  }
});

test('M8 a built-in resolves from the page and reaches the server', async ({ page }) => {
  await install(
    page,
    [
      endpoint('csrf', 'GET', '/api/echo-headers', {
        request: { headers: [{ name: 'X-Csrf', value: '{{$meta("csrf-token")}}' }] },
        checks: [{ kind: 'body-contains', value: 'fixture-csrf-abc123' }],
      }),
    ],
    { iterations: 1 },
  );
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  // The check passes only if the echoed request headers contain the value read from the page.
  await expect(panel(page).locator('.aw-big').first()).toHaveText('1');
});

test('M8 a missing built-in value blocks the request instead of sending an empty header', async ({ page, request }) => {
  const before = await hits(request);
  await install(
    page,
    [endpoint('missing', 'GET', '/api/m8-blocked', { request: { headers: [{ name: 'X-Token', value: '{{$meta("not-on-this-page")}}' }] } })],
    { iterations: 2 },
  );
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  await expect(panel(page).locator('.aw-card', { hasText: 'Outcome breakdown' })).toContainText('Blocked before dispatch');
  const after = await hits(request);
  expect((after['/api/m8-blocked'] ?? 0) - (before['/api/m8-blocked'] ?? 0)).toBe(0);
});

test('M8 Scan page lists page values masked and turns one into a named binding', async ({ page }) => {
  await page.evaluate(() => { document.cookie = 'aw_scan_demo=super-secret-value; Path=/'; });
  await install(page, [endpoint('one', 'GET', '/api/m8-scan')], {});
  await openLoad(page);
  // Page context sits in a disclosure: Test.html shows the plan, not the scanner.
  await panel(page).getByText('Page context', { exact: true }).click();
  await panel(page).getByRole('button', { name: 'Scan page' }).click();
  const results = panel(page).locator('[aria-label="Scan results"]');
  await expect(results).toContainText('aw_scan_demo');
  await expect(results).toContainText('sup…e (18 chars)');
  await expect(results).not.toContainText('super-secret-value');
  await results.locator('.aw-li', { hasText: 'aw_scan_demo' }).getByRole('button', { name: 'Use' }).click();
  await expect(panel(page).locator('[aria-label="Context bindings"]')).toContainText('{{$context("cookie_aw_scan_demo")}}');
});

test('M8 the Once view still sends one direct request', async ({ page }) => {
  await install(page, [endpoint('health', 'GET', '/api/m8-once')], {});
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Run Once' }).click();
  await expect(panel(page).locator('[aria-label="Once history"]')).toContainText('passed', { timeout: 15000 });
});

test('M8 Home lists a completed plan run and opens it on Results', async ({ page }) => {
  await install(page, [endpoint('seed', 'GET', '/api/m8-home-history')], { iterations: 2 });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });

  // The run is a plan run, not a direct Once result: Home used to report "No runs yet" for it.
  // Results' Back returns to Test, which is where the tab strip reappears.
  await panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' }).click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
  const history = panel(page).locator('[aria-label="Run history"]');
  await expect(history).toContainText('Fixture Plan · flow');
  await expect(history).toContainText('2/2');
  await expect(history).not.toContainText('No runs yet');

  // Open shows the run, which only Results renders.
  await history.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Results');
  await expect(panel(page).locator('.aw-big').first()).toHaveText('2');
});

test('M8 notify on complete raises a dialog that leads to the run, and stays quiet when unchecked', async ({ page }) => {
  await install(page, [endpoint('seed', 'GET', '/api/m8-notify')], { notifyOnComplete: false });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await expect(panel(page).locator('.aw-bd.aw-s')).toHaveText('completed', { timeout: 15000 });
  // Unchecked: the run is reported in the activity log only.
  await expect(panel(page).getByRole('dialog')).toHaveCount(0);

  await install(page, [endpoint('seed', 'GET', '/api/m8-notify')], { notifyOnComplete: true });
  await openLoad(page);
  await expect(panel(page).getByRole('checkbox', { name: 'Notify on complete' })).toBeChecked();
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  const dialog = panel(page).getByRole('dialog', { name: 'Run completed' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog).toContainText('Fixture Plan: 1 of 1 request passed.');

  // Running from the Load view lands on Results, so the run is already on screen: the dialog
  // reports it with one button rather than offering a trip to where the reader already is.
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Results');
  await expect(dialog.getByRole('button')).toHaveText(['Close']);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel(page).locator('.aw-big').first()).toHaveText('1');
});

test('M8 a notified run that finishes off the Results screen offers the way to it', async ({ page }) => {
  // Spaced iterations, so the reader can leave Results before the run finishes.
  await install(page, [endpoint('seed', 'GET', '/api/m8-notify-away')], { notifyOnComplete: true, iterations: 3, delayMs: 300 });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' }).click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();

  // Off Results the two buttons differ: Dismiss stays put, so the reader is still on Home.
  const dialog = panel(page).getByRole('dialog', { name: 'Run completed' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByRole('button')).toHaveText(['Dismiss', 'View results']);
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(panel(page).locator('.aw-cap', { hasText: 'Quick actions' })).toBeVisible();

  // The same run, announced again, taken up this time: View results goes where Dismiss did not.
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' }).click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await dialog.getByRole('button', { name: 'View results', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Results');
  await expect(panel(page).locator('.aw-big').first()).toHaveText('3');
});

test('M8 a notified run restores a minimized panel to show the dialog', async ({ page }) => {
  // Three iterations spaced out, so the panel can be minimized while the run is still going.
  await install(page, [endpoint('seed', 'GET', '/api/m8-notify-min')], { notifyOnComplete: true, iterations: 3, delayMs: 300 });
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Run Load' }).click();
  await panel(page).locator('.aw-tb').getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.locator('#api-workbench .aw-min')).toBeVisible();

  // The point of the setting is to be told while looking elsewhere, so the panel comes back.
  const dialog = panel(page).getByRole('dialog', { name: 'Run completed' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#api-workbench .aw-min')).toBeHidden();
  // Restoring lands back on Results, where the run is already rendered, so the dialog only reports.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
});
