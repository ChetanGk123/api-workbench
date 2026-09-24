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
  await panel(page).getByRole('textbox', { name: 'Import source', exact: true }).fill(JSON.stringify(config));
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await panel(page).getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('replace');
  await panel(page).getByRole('button', { name: 'Import profile', exact: true }).click();
  await expect(panel(page).locator('.aw-sub .aw-subtitle')).toHaveText('Endpoints');
}

// Non-tab screens hide the tab strip, so reach Home through the Back sub-header when it is shown.
async function goHome(page) {
  const back = panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' });
  if (await back.isVisible()) await back.click();
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
}

async function openEndpoints(page) {
  await goHome(page);
  await panel(page).getByRole('button', { name: /^Endpoints/ }).click();
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

test('a failed run wears a badge, not the radio dot aw-rd also names', async ({ page }) => {
  // Nothing listens on 4199, so the run fails for real and the row renders its red outcome badge.
  await importSample(page, {
    ...sample,
    profile: { ...sample.profile, environments: { default: { default: 'http://127.0.0.1:4199' } } },
  });
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Run Once', exact: true }).click();
  const badge = panel(page).locator('.aw-li .aw-bd.aw-rd').first();
  await expect(badge).toHaveText('network-error');
  // The reference sheet gives `.aw-rd` the 16px radio-dot geometry after the red badge tone, so a
  // badge that inherits it collapses to a circle and spills its text across the row.
  const box = await badge.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, height: node.clientHeight }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
  expect(box.client).toBeGreaterThan(box.height);
});

test('Once headers are visible on the Test screen and reach the request', async ({ page }) => {
  await importSample(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('combobox', { name: 'Endpoint to run' }).selectOption({ label: 'POST · Imported echo payload' });
  // Once and Load each carry a Headers card, and the hidden one is still in the DOM.
  const headers = panel(page).locator('details:visible', { hasText: 'Headers' }).first();
  await headers.locator('summary').click();
  // The profile's own headers are here too, not only on Settings.
  await expect(headers.getByRole('textbox', { name: 'Header name', exact: true }).first()).toHaveValue('X-Workbench-Import');
  await expect(headers.getByText('Imported echo payload · replaces a global of the same name')).toBeVisible();

  // The endpoint's own header, added from the Test screen, is what the server receives.
  await headers.getByRole('button', { name: 'Add header', exact: true }).last().click();
  await headers.getByRole('textbox', { name: 'Header name', exact: true }).last().fill('X-Fixture');
  await headers.getByRole('textbox', { name: 'Header value', exact: true }).last().fill('from-test-screen');
  // The badge counts what the request will carry: the global one plus the endpoint's two.
  await expect(headers.locator('summary .aw-bd')).toHaveText('3');
  await panel(page).getByRole('button', { name: 'Run Once', exact: true }).click();
  await expect(panel(page).locator('pre.aw-code').first()).toContainText('"header": "from-test-screen"');

  // Selecting another endpoint shows that endpoint's headers instead.
  await panel(page).getByRole('combobox', { name: 'Endpoint to run' }).selectOption({ label: 'GET · Imported fixture health' });
  await expect(headers.getByText('Imported fixture health · replaces a global of the same name')).toBeVisible();
  await expect(headers.getByRole('textbox', { name: 'Header name', exact: true })).toHaveCount(1);
});

test('Load headers edit the profile headers every planned request carries', async ({ page }) => {
  await importSample(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
  const headers = panel(page).locator('details:visible', { hasText: 'Headers' }).first();
  await headers.locator('summary').click();
  await expect(headers.getByText("An endpoint's own headers are edited on Endpoints.")).toBeVisible();
  await headers.getByRole('textbox', { name: 'Header value', exact: true }).first().fill('edited-from-load');
  await headers.getByRole('textbox', { name: 'Header value', exact: true }).first().blur();
  // Writing a header re-renders the plan; the editor has to survive that or an edit loses focus.
  await expect(headers).toHaveAttribute('open', '');
  const saved = await exportConfig(page);
  expect(saved.profile.globalHeaders).toEqual([{ name: 'X-Workbench-Import', value: 'edited-from-load' }]);
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

test('the Once result shows a JSON response indented, and only the response', async ({ page }) => {
  await importSample(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Run Once', exact: true }).click();
  const detail = panel(page).locator('pre.aw-code').first();
  await expect(detail).toContainText('"source": "network"');
  // Indented, not the single line the server sent. A body that does not parse is left as it is.
  expect(await detail.textContent()).toMatch(/\{\n\s+"source"/);
  // The box holds the response; a passing run's checks are already summarised in the status line.
  await expect(detail).not.toContainText('Checks');
  await expect(panel(page).getByText('passed · HTTP 200', { exact: false })).toBeVisible();
});

test('a failed check is reported under the result instead of inside the body', async ({ page }) => {
  const impossible = {
    ...sample,
    endpoints: sample.endpoints.map(endpoint => ({ ...endpoint, checks: [{ kind: 'status', value: { min: 500, max: 599 } }] })),
  };
  await importSample(page, impossible);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Run Once', exact: true }).click();
  const result = panel(page).locator('.aw-card', { hasText: 'RESULT' }).first();
  await expect(result.getByText(/failed-check/)).toBeVisible();
  await expect(result.locator('p.aw-rd')).toHaveCount(1);
  await expect(result.locator('pre.aw-code')).not.toContainText('status 200');
});

test('a result box can be dragged taller than its resting height', async ({ page }) => {
  await importSample(page);
  await goHome(page);
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Run Once', exact: true }).click();
  const detail = panel(page).locator('pre.aw-code').first();
  await expect(detail).toContainText('"source"');
  const resting = await detail.evaluate(node => ({
    resize: getComputedStyle(node).resize,
    max: getComputedStyle(node).maxHeight,
    height: node.clientHeight,
  }));
  expect(resting.resize).toBe('vertical');
  expect(resting.max).toBe('160px');
  // Dragging the handle is the browser writing a height onto the element; the cap has to give way
  // or the box would stay at 160px however far it is pulled.
  await detail.evaluate(node => { node.style.height = '360px'; });
  const dragged = await detail.evaluate(node => ({ max: getComputedStyle(node).maxHeight, height: node.clientHeight }));
  expect(dragged.max).toBe('none');
  expect(dragged.height).toBeGreaterThan(300);
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
  const viewport = page.viewportSize();
  const initial = await panel(page).boundingBox();
  expect(initial.width).toBe(480);
  expect(initial.height).toBe(Math.min(720, viewport.height - 96));
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
  await expect(panel(page).getByRole('textbox', { name: 'Import source', exact: true })).toBeVisible();
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
  await headerButton(page, 'Settings').click();
  await panel(page).locator('.aw-body').getByRole('textbox', { name: 'Name', exact: true }).fill('Copy');
  await panel(page).getByRole('button', { name: 'Save as copy', exact: true }).click();
  await openEndpoints(page);
  await panel(page).locator('.aw-endpoint-row').first().getByRole('button', { name: 'Delete', exact: true }).click();
  await panel(page).locator('dialog.aw-dlg').getByRole('button', { name: 'Delete', exact: true }).click();
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
  await headerButton(page, 'Settings').click();
  await panel(page).locator('.aw-body').getByRole('textbox', { name: 'Name', exact: true }).fill('Copy');
  await panel(page).getByRole('button', { name: 'Save as copy', exact: true }).click();

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
  await panel(page).locator('.aw-body').getByRole('textbox', { name: 'Name', exact: true }).fill('Copy');
  await panel(page).getByRole('button', { name: 'Save as copy', exact: true }).click();
  const switcher = panel(page).locator('.aw-tb').getByRole('button', { name: 'Active profile' });
  const options = panel(page).locator('.aw-body').getByRole('combobox', { name: 'Active profile' }).locator('option');
  const remove = panel(page).locator('.aw-body').getByRole('button', { name: 'Delete profile', exact: true });
  await expect(options).toHaveCount(2);

  // The confirmation is the panel's own dialog, not the page's native confirm(); cancelling,
  // and Escape, delete nothing.
  const confirmation = panel(page).locator('dialog.aw-dlg');
  const accept = () => confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await remove.click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await remove.click();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(switcher).toHaveText('Import Demo');
  await expect(options).toHaveCount(2);

  // Deleting the live profile hands the stored copy, and its endpoints, to the panel.
  await remove.click();
  await accept();
  await expect(switcher).toHaveText('Copy');
  await expect(options).toHaveCount(1);
  await openEndpoints(page);
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(2);

  // The last delete cannot leave the panel without a profile, so an empty one takes over.
  await headerButton(page, 'Settings').click();
  await remove.click();
  await accept();
  await expect(switcher).toHaveText('127.0.0.1');
  await openEndpoints(page);
  await expect(panel(page).locator('.aw-endpoint-row')).toHaveCount(0);
});

test('UI Home reports each module the way the reference card does, and switches it on from there', async ({ page }) => {
  await launch(page);
  // One intercept rule, so the card can show a configured module that is not running.
  await importSample(page, { ...sample, rules: [{
    id: 'rule-1', kind: 'intercept', name: 'demo', enabled: true, priority: 0, seq: 0,
    match: { method: 'GET', url: '/api/echo', conditions: [] },
    response: { status: 200, body: '', headers: [] },
  }] });
  await goHome(page);
  const card = name => panel(page).locator('.aw-card', { hasText: name }).first();
  const indicators = panel(page).locator('.aw-tb .aw-tbm .aw-ind:visible');
  const interceptTab = panel(page).locator('.aw-tabs').getByRole('button', { name: 'Intercept', exact: true });

  // The Tester card states the live plan, not an on/off state.
  await expect(card('API Tester')).toContainText('Working Plan · 2/2 in plan · No runs yet');
  await expect(card('API Tester').locator('.aw-bd')).toBeHidden();

  // Reference stat lines: each module counts its rules and names its own kind of hit.
  await expect(card('Mock Server')).toContainText('0/0 rules active · 0 requests matched');
  await expect(card('API Interceptor')).toContainText('1/1 rules active · 0 responses modified');
  await expect(card('Page Routing')).toContainText('0/0 rules enabled · 0 routed');
  await expect(card('Chaos Engineering')).toContainText('0/0 rules · 0 chaos hits');

  // A module with no rules is Inactive and stays out of the title bar; a configured one is Paused.
  await expect(card('Mock Server').locator('.aw-bd')).toHaveText('Inactive');
  await expect(card('API Interceptor').locator('.aw-bd')).toHaveText('Paused');

  // With no rules there is nothing to activate, so the card offers the rule list instead.
  await expect(card('Mock Server').getByRole('button', { name: 'Manage rules', exact: true })).toBeVisible();
  await expect(card('Chaos Engineering').getByRole('button', { name: 'Configure', exact: true })).toBeVisible();
  await card('Mock Server').getByRole('button', { name: 'Manage rules', exact: true }).click();
  await expect(panel(page).locator('.aw-body .aw-h').first()).toHaveText('Mock Server');
  await goHome(page);
  await expect(indicators).toHaveCount(1);
  await expect(interceptTab.locator('.aw-d')).toBeHidden();

  // Activate switches the module on from Home: badge, card outline and tab dot follow one state.
  const intercept = card('API Interceptor');
  await intercept.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(intercept.locator('.aw-bd')).toHaveText('Running');
  await expect(intercept).toHaveClass(/aw-live/);
  await expect(interceptTab.locator('.aw-d')).toBeVisible();
  await expect(indicators).toHaveCount(1);

  // Stop returns it to Paused: the rule is still configured, it is just not touching traffic.
  await intercept.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(intercept.locator('.aw-bd')).toHaveText('Paused');
  await expect(intercept).not.toHaveClass(/aw-live/);
  await expect(interceptTab.locator('.aw-d')).toBeHidden();
});

test('UI Home Activity lists the observed requests, newest first, instead of one line', async ({ page }) => {
  await launch(page);
  await page.evaluate(async () => { for (let index = 0; index < 3; index++) await fetch(`/api/echo?call=${index}`); });
  const log = panel(page).locator('.aw-code');
  // The store batches its notifications, so poll the rendered log rather than reading it once.
  await expect.poll(async () => (await log.textContent()).split('\n').length).toBe(3);
  const lines = (await log.textContent()).split('\n');
  // Newest first, each line stamped and carrying the method and the same-origin path.
  expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d {2}fetch GET \/api\/echo\?call=2 · request$/);
  expect(lines[2]).toContain('call=0');
  await expect(panel(page).getByText(/^Activity · 3 observed$/)).toBeVisible();
});

// The remembered geometry is written to IndexedDB asynchronously, so read it back rather than
// assuming a reload cannot outrun the write.
const storedGeometry = page => page.evaluate(() => new Promise(resolve => {
  const request = indexedDB.open('api-workbench');
  request.onsuccess = () => {
    const database = request.result;
    const read = database.transaction('configs', 'readonly').objectStore('configs').get(`geometry:${location.origin}`);
    read.onsuccess = () => { database.close(); resolve(read.result ?? null); };
  };
}));

test('UI a resized and moved panel opens the same way on the next launch', async ({ page }) => {
  const opened = await panel(page).boundingBox();

  // Geometry is remembered only when the pointer actually moved, so drive real drags.
  const grip = await panel(page).locator('.aw-rs-se').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 120, grip.y + grip.height / 2 - 60, { steps: 4 });
  await page.mouse.up();
  const header = await panel(page).locator('.aw-tb').boundingBox();
  await page.mouse.move(header.x + 40, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(260, 150, { steps: 4 });
  await page.mouse.up();
  const arranged = await panel(page).boundingBox();
  expect(arranged.width).toBe(opened.width - 120);
  expect(arranged.height).toBe(opened.height - 60);
  expect(arranged.x).not.toBe(opened.x);

  const expected = { x: Math.round(arranged.x), y: Math.round(arranged.y), width: arranged.width, height: arranged.height };
  await expect.poll(() => storedGeometry(page)).toEqual(expected);

  await page.reload();
  await launch(page);
  const restored = await panel(page).boundingBox();
  expect({ x: Math.round(restored.x), y: Math.round(restored.y), width: restored.width, height: restored.height }).toEqual(expected);
});

test('UI a launch that never moved the panel leaves no geometry to restore', async ({ page }) => {
  const opened = await panel(page).boundingBox();
  // A click on the header is a pointerup too, and must not be recorded as a drag.
  await panel(page).locator('.aw-tb').click({ position: { x: 40, y: 12 } });
  await page.reload();
  await launch(page);
  expect(await storedGeometry(page)).toBeNull();
  expect(await panel(page).boundingBox()).toEqual(opened);
});

test('UI the endpoint list filters, and a filtered list refuses to reorder', async ({ page }) => {
  await importSample(page);
  const rows = panel(page).locator('.aw-endpoint-row');
  await expect(rows).toHaveCount(2);
  const filter = panel(page).getByRole('searchbox', { name: 'Filter endpoints', exact: true });
  const count = panel(page).locator('.aw-bd.aw-s').first();

  // Every term must match, across method, name and path.
  await filter.fill('echo');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('/api/echo');
  await expect(count).toHaveText('1 of 2');
  await filter.fill('post echo');
  await expect(rows).toHaveCount(1);
  await filter.fill('get echo');
  await expect(rows).toHaveCount(0);
  await expect(panel(page).locator('.aw-empty')).toContainText('Nothing matches "get echo"');

  // Order is edited against the whole list, never a filtered view of it.
  await filter.fill('echo');
  await expect(rows.first().getByRole('button', { name: 'Move up', exact: true })).toBeDisabled();
  await expect(rows.first().getByRole('button', { name: 'Move down', exact: true })).toBeDisabled();
  await filter.fill('');
  await expect(rows).toHaveCount(2);
  await expect(count).toHaveText('2');
  await expect(rows.first().getByRole('button', { name: 'Move down', exact: true })).toBeEnabled();
});

test('UI deleting an endpoint asks first, and Cancel keeps it', async ({ page }) => {
  await importSample(page);
  const rows = panel(page).locator('.aw-endpoint-row');
  const name = await rows.first().locator('.aw-endpoint-name').textContent();
  await rows.first().getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = panel(page).locator('dialog.aw-dlg');
  await expect(dialog).toContainText(`Delete "${name}"? This cannot be undone.`);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).not.toContainText(name);
});

test('UI Run on an endpoint row sends it and opens Test on that endpoint', async ({ page }) => {
  await importSample(page);
  const rows = panel(page).locator('.aw-endpoint-row');
  const target = rows.nth(1);
  const name = await target.locator('.aw-endpoint-name').textContent();
  await target.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(panel(page).locator('.aw-tabs').getByRole('button', { name: 'Test', exact: true })).toHaveAttribute('aria-current', 'page');
  // The selector names the endpoint whose result is shown, not whichever one is first.
  await expect(panel(page).getByRole('combobox', { name: 'Endpoint to run', exact: true }).locator('option:checked')).toHaveText(new RegExp(name));
  await expect(panel(page).locator('.aw-card [role=status]').first()).toContainText(/HTTP \d\d\d/);
});
