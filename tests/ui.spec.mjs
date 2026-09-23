import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.
const headerButton = (page, name) => panel(page).locator('.aw-tb').getByRole('button', { name, exact: true });

async function importSample(page, config = sample) {
  await headerButton(page, 'Import').click();
  await panel(page).getByRole('textbox', { name: 'Import JSON', exact: true }).fill(JSON.stringify(config));
  await panel(page).getByRole('button', { name: 'Import JSON', exact: true }).click();
}

// Non-tab screens hide the tab strip, so reach Home through the Back sub-header when it is shown.
async function goHome(page) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
}

async function openEndpoints(page) {
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Endpoints', exact: true }).click();
}

async function exportConfig(page) {
  await headerButton(page, 'Settings').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).getByRole('button', { name: 'Export profile + endpoints', exact: true }).click(),
  ]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
});

test('UI global headers add editable rows and preserve consecutive edits', async ({ page }) => {
  await openEndpoints(page);
  await panel(page).getByRole('button', { name: 'Add header', exact: true }).click();
  const names = panel(page).getByRole('textbox', { name: 'Header name', exact: true });
  const values = panel(page).getByRole('textbox', { name: 'Header value', exact: true });
  await expect(names).toHaveCount(1);
  await expect(names.first()).toBeVisible();
  await names.first().fill('X-First');
  await values.first().fill('first');
  await panel(page).getByRole('button', { name: 'Add header', exact: true }).click();
  await expect(names).toHaveCount(2);
  await names.last().fill('X-Second');
  await values.last().fill('second');
  await names.first().fill('X-First-Edited');
  await values.first().fill('one');
  await names.last().fill('X-Second-Edited');
  await values.last().fill('two');
  const config = await exportConfig(page);
  expect(config.profile.globalHeaders).toEqual([
    { name: 'X-First-Edited', value: 'one' },
    { name: 'X-Second-Edited', value: 'two' },
  ]);
});

test('UI endpoint editor focuses the draft and Cancel keeps saved values intact', async ({ page }) => {
  const config = structuredClone(sample);
  config.endpoints[0].request.headers = [{ name: 'X-Saved', value: 'original' }];
  await importSample(page, config);
  await openEndpoints(page);
  await panel(page).getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(0);
  await expect(panel(page).getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await panel(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved name');
  await panel(page).getByRole('textbox', { name: 'Header value', exact: true }).fill('unsaved');
  await panel(page).getByRole('button', { name: 'Add header', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Header name', exact: true }).last().fill('X-Unsaved');
  await panel(page).getByRole('textbox', { name: 'Header value', exact: true }).last().fill('unsaved');
  await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);
  const saved = await exportConfig(page);
  expect(saved.endpoints[0]).toEqual(config.endpoints[0]);
});

test('UI endpoint save commits request and header edits together, and reordering is immediate', async ({ page }) => {
  await importSample(page);
  await openEndpoints(page);
  await panel(page).getByRole('button', { name: 'Edit', exact: true }).first().click();
  await panel(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Edited fixture');
  await panel(page).getByRole('textbox', { name: 'Path', exact: true }).fill('/api/echo');
  for (const [name, value] of [['X-One', 'one'], ['X-Two', 'two']]) {
    await panel(page).getByRole('button', { name: 'Add header', exact: true }).click();
    await panel(page).getByRole('textbox', { name: 'Header name', exact: true }).last().fill(name);
    await panel(page).getByRole('textbox', { name: 'Header value', exact: true }).last().fill(value);
  }
  await panel(page).getByRole('button', { name: 'Save endpoint', exact: true }).click();
  const rows = panel(page).locator('.aw-endpoint-row');
  await expect(rows.first()).toContainText('Edited fixture');
  await rows.first().getByRole('button', { name: 'Move down', exact: true }).click();
  await expect(rows.first()).toContainText('Imported echo payload');
  await expect(rows.last()).toContainText('Edited fixture');
  await expect(rows.first().getByRole('button', { name: 'Move up', exact: true })).toBeDisabled();
  await expect(rows.last().getByRole('button', { name: 'Move down', exact: true })).toBeDisabled();
  const config = await exportConfig(page);
  expect(config.endpoints.map(endpoint => endpoint.name)).toEqual(['Imported echo payload', 'Edited fixture']);
  expect(config.endpoints[1].request.path).toBe('/api/echo');
  expect(config.endpoints[1].request.headers).toEqual([
    { name: 'X-One', value: 'one' },
    { name: 'X-Two', value: 'two' },
  ]);
});

test('every module screen edits rules in place without touching the host page', async ({ page }) => {
  const navigations = [];
  page.on('framenavigated', frame => navigations.push(frame.url()));
  const originalURL = page.url();
  for (const [name, add] of [['Intercept', 'Add rule'], ['Route', 'New page rule']]) {
    const tab = panel(page).locator('.aw-tabs').getByRole('button', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    // Activation is real from M6 onward, and starts inactive on every launch.
    await expect(panel(page).getByRole('button', { name: 'Activate', exact: true })).toBeEnabled();
    await panel(page).getByRole('button', { name: add, exact: true }).click();
    await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect(panel(page).getByRole('button', { name: add, exact: true })).toBeVisible();
  }
  expect(page.url()).toBe(originalURL);
  expect(navigations).toEqual([]);
});

test('UI tester history updates while the screen stays open', async ({ page }) => {
  await importSample(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await expect(panel(page).getByText(/^No runs yet\./)).toBeVisible();
  for (let count = 1; count <= 2; count++) {
    await panel(page).getByRole('button', { name: 'Run Once', exact: true }).click();
    await expect(panel(page).getByText('passed', { exact: true })).toHaveCount(count);
    await expect(panel(page).getByText(/^No runs yet\./)).toHaveCount(0);
  }
});

test('UI Record screen supports capture, review and resetting the draft', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Record', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture').then(response => response.text()));
  await panel(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(panel(page).getByText(/1 captured · reviewable draft/)).toBeVisible();
  await expect(panel(page).getByText('/api/fixture', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: /Reset/i }).click();
  await expect(panel(page).getByText('/api/fixture', { exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
});

test('UI Format JSON appears only when there is something to format, and rewrites in place', async ({ page }) => {
  await panel(page).locator('.aw-tabs').getByRole('button', { name: 'Mock', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Add ad-hoc rule', exact: true }).click();
  const body = panel(page).getByRole('textbox', { name: 'Body 1', exact: true });
  const format = panel(page).getByRole('button', { name: 'Format JSON', exact: true });
  // An empty body and a body that is not JSON have nothing to format.
  await expect(format).toBeHidden();
  await body.fill('{"a":1,');
  await expect(format).toBeHidden();

  await body.fill('{"a":1,"b":[2,3]}');
  await expect(format).toBeVisible();
  await format.click();
  await expect(body).toHaveValue('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  // The validity line is driven by the input event, so formatting must fire it.
  await expect(panel(page).getByText('Valid JSON.', { exact: true })).toBeVisible();
  // Already indented: the control retires itself.
  await expect(format).toBeHidden();
});

test('UI Format JSON is available on a recorded endpoint body and its response sample', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Record', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sent":[1,2]}' }));
  await panel(page).getByRole('button', { name: 'Stop recording', exact: true }).click();
  await panel(page).getByRole('button', { name: 'POST /api/echo' }).click();

  const request = panel(page).getByRole('textbox', { name: 'Body', exact: true });
  await expect(request).toHaveValue('{"sent":[1,2]}');
  await panel(page).getByRole('button', { name: 'Format JSON', exact: true }).first().click();
  await expect(request).toHaveValue('{\n  "sent": [\n    1,\n    2\n  ]\n}');

  const sample = panel(page).locator('details').filter({ hasText: 'Response sample' });
  await sample.locator('summary').click();
  await sample.getByRole('button', { name: 'Format JSON', exact: true }).click();
  await expect(sample.locator('pre.aw-code')).toContainText('"method": "POST"');
  // The formatted sample is what Save keeps.
  await panel(page).getByRole('button', { name: 'Save endpoint', exact: true }).click();
  await panel(page).getByRole('button', { name: 'POST /api/echo' }).click();
  const reopened = panel(page).locator('details').filter({ hasText: 'Response sample' });
  await reopened.locator('summary').click();
  await expect(reopened.locator('pre.aw-code')).toContainText('"method": "POST"');
  await expect(reopened.getByRole('button', { name: 'Format JSON', exact: true })).toBeHidden();
});

test('UI compact panel keeps navigation and close reachable while content scrolls', async ({ page }) => {
  const initial = await panel(page).boundingBox();
  expect(initial.width).toBe(480);
  expect(initial.height).toBe(560);
  await panel(page).evaluate(node => { node.style.width = '320px'; node.style.height = '220px'; });
  await expect(panel(page)).toHaveCSS('width', '320px');
  const footer = panel(page).locator('.aw-foot');
  const body = panel(page).locator('.aw-body');
  const before = await footer.boundingBox();
  await body.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await footer.boundingBox()).toEqual(before);
  await expect(footer).toBeInViewport();
  for (const name of ['Chaos', 'Route', 'Intercept', 'Mock', 'Test', 'Home']) {
    const tab = panel(page).locator('.aw-tabs').getByRole('button', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect(tab).toBeInViewport();
    await expect(headerButton(page, 'Close')).toBeInViewport();
  }
  await headerButton(page, 'Settings').click();
  await expect(panel(page).getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  await headerButton(page, 'Import').click();
  await expect(panel(page).getByRole('textbox', { name: 'Import JSON', exact: true })).toBeVisible();
  await headerButton(page, 'Close').click();
  await expect(page.locator('#api-workbench')).toHaveCount(0);
});

test('UI editor chrome: footer carries the actions and Back returns to the list, not Home', async ({ page }) => {
  const footer = panel(page).locator('.aw-foot');
  const subTitle = panel(page).locator('.aw-sub .aw-subtitle');
  const status = footer.getByText(/requests observed/);
  await importSample(page);
  await openEndpoints(page);
  await expect(status).toBeVisible();

  // Opening an endpoint retitles the sub-header and moves Save/Cancel into the footer.
  await panel(page).locator('.aw-endpoint-row').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(subTitle).toHaveText('Imported fixture health');
  await expect(footer.getByRole('button', { name: 'Save endpoint', exact: true })).toBeVisible();
  await expect(status).toHaveCount(0);

  // Back leaves the editor for the endpoint list rather than jumping two levels to Home.
  await panel(page).locator('.aw-sub').getByRole('button').first().click();
  await expect(subTitle).toHaveText('Endpoints');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);
  await expect(status).toBeVisible();

  // A rule editor gets the same footer, and Cancel returns to its own module screen.
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Mock', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Add ad-hoc rule', exact: true }).click();
  await expect(subTitle).toHaveText('New mock rule');
  await expect(footer.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel(page).locator('.aw-body .aw-h').first()).toHaveText('Mock Server');
  await expect(status).toBeVisible();
});

test('UI title-bar profile menu switches profiles instead of opening Settings', async ({ page }) => {
  const switcher = panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' });
  const menu = page.locator('#api-workbench .aw-menu:not([hidden])');
  const focused = () => page.evaluate(() => {
    const active = document.getElementById('api-workbench').shadowRoot.activeElement;
    return active && (active.getAttribute('aria-label') ?? active.textContent.trim());
  });
  await importSample(page);

  // Snapshot the imported profile, then diverge the active one from that snapshot.
  await panel(page).getByPlaceholder('New profile name').fill('Copy');
  await panel(page).getByRole('button', { name: 'Save as profile', exact: true }).click();
  await openEndpoints(page);
  await panel(page).locator('.aw-endpoint-row').first().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(1);

  // The menu is mounted beside the panel so the panel's overflow cannot clip it.
  await expect(switcher).toHaveAttribute('aria-expanded', 'false');
  await switcher.click();
  await expect(switcher).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Import Demo', 'Copy']);
  await expect(menu.locator('[aria-checked="true"]')).toHaveText('Import Demo');
  expect(await focused()).toBe('Import Demo');
  const box = await menu.boundingBox();
  const panelBox = await panel(page).boundingBox();
  expect(box.height).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThan(panelBox.y + panelBox.height);

  // Escape closes without selecting and hands focus back to the trigger.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await focused()).toBe('Active profile');
  await expect(switcher).toHaveText('Import Demo');

  // Keyboard selection switches profile and re-renders the mounted screen; it does not navigate.
  await switcher.click();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).toBe('Copy');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(switcher).toHaveText('Copy');
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);

  // A pointerdown anywhere else dismisses the menu.
  await switcher.click();
  await expect(menu).toHaveCount(1);
  await page.mouse.click(10, 400);
  await expect(menu).toHaveCount(0);
});

test('UI export carries only the active profile and its endpoints, and import keeps the other saved profiles', async ({ page }) => {
  await importSample(page);
  await panel(page).getByPlaceholder('New profile name').fill('Copy');
  await panel(page).getByRole('button', { name: 'Save as profile', exact: true }).click();

  const exported = await exportConfig(page);
  expect(exported.savedProfiles).toBeUndefined();
  expect(exported.profile.name).toBe('Import Demo');
  expect(exported.endpoints.map(endpoint => endpoint.name)).toEqual(sample.endpoints.map(endpoint => endpoint.name));

  // Re-importing that single-profile export must not wipe the snapshot taken above.
  await importSample(page, exported);
  await panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' }).click();
  await expect(page.locator('#api-workbench .aw-menu:not([hidden])').getByRole('menuitemradio')).toHaveText(['Import Demo', 'Copy']);
});

test('UI deleting a profile activates the next one, and deleting the last leaves an empty profile', async ({ page }) => {
  await importSample(page);
  await headerButton(page, 'Settings').click();
  await panel(page).getByPlaceholder('New profile name').fill('Copy');
  await panel(page).getByRole('button', { name: 'Save as profile', exact: true }).click();
  const switcher = panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' });
  const options = panel(page).locator('.aw-body').getByRole('combobox', { name: 'Active profile' }).locator('option');
  const remove = panel(page).locator('.aw-body').getByRole('button', { name: 'Delete profile', exact: true });
  await expect(options).toHaveCount(2);

  // A dismissed confirmation deletes nothing.
  page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  await expect(switcher).toHaveText('Import Demo');
  await expect(options).toHaveCount(2);

  // Deleting the live profile hands the stored copy, and its endpoints, to the panel.
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(switcher).toHaveText('Copy');
  await expect(options).toHaveCount(1);
  await openEndpoints(page);
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);

  // The last delete cannot leave the panel without a profile, so an empty one takes over.
  await headerButton(page, 'Settings').click();
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(switcher).toHaveText('127.0.0.1');
  await openEndpoints(page);
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(0);
});
