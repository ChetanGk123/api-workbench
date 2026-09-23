import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const launch = page => page.evaluate(source);
const panel = '#api-workbench .aw-root:not(.aw-min)';

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });

test('M4 records a future fetch and promotes the reviewed request', async ({ page }) => {
  await launch(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture').then(response => response.text()));
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText(/1 captured · reviewable draft/)).toBeVisible();
  await expect(page.locator(`${panel}`).getByText('/api/fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.locator(`${panel} .aw-h`)).toHaveText('Endpoints');
  await expect(page.getByText('GET /api/fixture', { exact: true })).toBeVisible();
});

test('M4 recorder redacts request credentials before review', async ({ page }) => {
  await launch(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture', { headers: { Authorization: 'Bearer should-not-display' } }));
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText(/1 captured · reviewable draft/)).toBeVisible();
  await expect(page.locator(`${panel}`).getByText('Bearer should-not-display', { exact: true })).toHaveCount(0);
});

test('M4 records native XHR traffic and restores the review draft after relaunch', async ({ page }) => {
  await launch(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', '/api/fixture');
    request.addEventListener('load', () => resolve(request.status));
    request.addEventListener('error', reject);
    request.send();
  }));
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText(/1 captured · reviewable draft/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await expect(page.getByText(/1 captured · reviewable draft/)).toBeVisible();
  await expect(page.locator(`${panel}`).getByText('/api/fixture', { exact: true })).toBeVisible();
});
