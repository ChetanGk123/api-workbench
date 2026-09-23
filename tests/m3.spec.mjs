import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const launch = page => page.evaluate(source);
const panel = '#api-workbench .aw-root:not(.aw-min)';

// Export writes a JSON file; read it back off the download instead of the removed textarea.
async function exportDownload(page, root = page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    root.getByRole('button', { name: 'Export profile + endpoints', exact: true }).click(),
  ]);
  return { name: download.suggestedFilename(), json: await readFile(await download.path(), 'utf8') };
}

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });

test('M3 endpoint CRUD, profile export and same-origin relaunch persistence', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await launch(page);
  await page.getByRole('button', { name: /^Endpoints/ }).click();
  await expect(page.locator(`${panel} .aw-h`)).toHaveText('Endpoints');
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await expect(page.locator(`${panel}`).getByText('New endpoint', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name').fill('fixture health');
  await page.getByLabel('Path').fill('/api/fixture');
  await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
  await expect(page.getByText('fixture health', { exact: true })).toBeVisible();

  // The Home tile counts the active profile's endpoints, singular at one.
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.locator(`${panel} .aw-body .aw-qa .aw-bd`).first()).toHaveText('1 endpoint');
  await page.getByRole('button', { name: /^Endpoints/ }).click();

  await page.locator(`${panel} .aw-tb`).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('QA profile');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  const exportFile = await exportDownload(page);
  expect(exportFile.name).toBe('QA-profile.json');
  expect(exportFile.json).toMatch(/QA profile/);
  expect(exportFile.json).toMatch(/fixture health/);

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await page.getByRole('button', { name: /^Endpoints/ }).click();
  await expect(page.getByText('fixture health', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('fixture health', { exact: true })).toHaveCount(0);
  expect(requests.filter(url => url.includes('/api/')).length).toBe(0);
});

test('M3 direct Once uses the page session and reports checks', async ({ page }) => {
  // The playground keeps its compatibility tools in a <details>. A closed one holds its content
  // out of the accessibility tree, so it is opened by its own summary before the button inside it
  // is addressed, and left alone when the page already ships it open.
  const tools = page.locator('details:has(#login)');
  if (!(await tools.evaluate(node => node.open))) await tools.locator('> summary').click();
  await page.getByRole('button', { name: 'Log in to local fixture', exact: true }).click();
  await launch(page);
  await page.getByRole('button', { name: /^Endpoints/ }).click();
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name').fill('session check');
  await page.getByLabel('Path').fill('/api/session');
  await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Run Once', exact: true }).click();
  await expect(page.getByText(/passed · HTTP 200/)).toBeVisible();
  await expect(page.locator(`${panel} .aw-code`)).toContainText('authenticated');
  await expect(page.locator(`${panel} .aw-code`)).toContainText('Checks');
  await expect(page.getByText('Run history', { exact: true })).toBeVisible();
});

test('M3 profiles, environment mapping and native JSON import are usable', async ({ page }) => {
  await launch(page);
  await page.locator(`${panel} .aw-tb`).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByPlaceholder('New profile name').fill('Staging');
  await page.getByRole('button', { name: 'Save as profile', exact: true }).click();
  // The title-bar control is a real profile switcher, not a second route into Settings.
  const switcher = page.locator(`${panel} .aw-tb`).getByRole('button', { name: 'Active profile' });
  const openMenu = page.locator('#api-workbench .aw-menu:not([hidden])');
  await switcher.click();
  await expect(openMenu.getByRole('menuitemradio')).toHaveText(['127.0.0.1', 'Staging']);
  await page.keyboard.press('Escape');
  const settingsProfile = page.locator(`${panel} .aw-body`).getByRole('combobox', { name: 'Active profile' });
  await expect(settingsProfile.locator('option', { hasText: 'Staging' })).toHaveCount(1);
  await settingsProfile.selectOption({ label: 'Staging' });
  await expect(switcher).toHaveText('Staging');
  await page.getByPlaceholder('host_key').fill('api');
  await page.getByPlaceholder('origin URL').fill('http://127.0.0.1:4173');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  const exported = (await exportDownload(page)).json;
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('textbox', { name: 'Import source', exact: true }).fill(exported);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('replace');
  await page.getByRole('button', { name: 'Import profile', exact: true }).click();
  await expect(page.locator(`${panel} .aw-sub .aw-subtitle`)).toHaveText('Endpoints');
});