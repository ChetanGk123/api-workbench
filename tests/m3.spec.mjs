import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const launch = page => page.evaluate(source);
const panel = '#api-workbench .aw-root:not(.aw-min)';

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });

test('M3 endpoint CRUD, profile export and same-origin relaunch persistence', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await launch(page);
  await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
  await expect(page.locator(`${panel} .aw-h`)).toHaveText('Endpoints');
  await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
  await expect(page.locator(`${panel}`).getByText('New endpoint', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name').fill('fixture health');
  await page.getByLabel('Path').fill('/api/fixture');
  await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
  await expect(page.getByText('fixture health', { exact: true })).toBeVisible();

  await page.locator(`${panel} .aw-tb`).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Name').fill('QA profile');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('button', { name: 'Export profile + endpoints', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue(/QA profile/);
  await expect(page.locator('textarea')).toHaveValue(/fixture health/);

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
  await expect(page.getByText('fixture health', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('fixture health', { exact: true })).toHaveCount(0);
  expect(requests.filter(url => url.includes('/api/')).length).toBe(0);
});

test('M3 direct Once uses the page session and reports checks', async ({ page }) => {
  await page.getByRole('button', { name: 'Log in to local fixture', exact: true }).click();
  await launch(page);
  await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Active profile' })).toContainText('Default');
  const profileSelect = page.locator(`${panel} select`).first();
  await expect(profileSelect.locator('option', { hasText: 'Staging' })).toHaveCount(1);
  await profileSelect.selectOption({ label: 'Staging' });
  await expect(page.getByRole('button', { name: 'Active profile' })).toContainText('Staging');
  await page.getByPlaceholder('host_key').fill('api');
  await page.getByPlaceholder('origin URL').fill('http://127.0.0.1:4173');
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  const exported = await page.locator('textarea[readonly]').inputValue();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('textbox', { name: 'Import JSON', exact: true }).fill(exported);
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await expect(page.locator(`${panel} .aw-h`)).toHaveText('Settings');
});