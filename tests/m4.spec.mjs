import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const launch = page => page.evaluate(source);
const panel = '#api-workbench .aw-root:not(.aw-min)';
// The recorder is its own screen, reached from Home's quick actions.
const openRecorder = page => page.locator(panel).getByRole('button', { name: 'Record', exact: true }).click();

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });

test('M4 records future traffic and creates a profile from the selected endpoints', async ({ page }) => {
  await launch(page);
  await openRecorder(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture').then(response => response.text()));
  await page.evaluate(() => fetch('/api/fixture?again=1').then(response => response.text()));
  await page.evaluate(() => fetch('/api/echo', { method: 'POST', body: 'hello' }));
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText(/3 captured · reviewable draft/)).toBeVisible();
  // Two calls to one path are one candidate; the POST is a second one.
  await expect(page.locator(`${panel} .aw-endpoint-row`)).toHaveCount(2);
  await expect(page.locator(panel).getByText('×2', { exact: true })).toBeVisible();
  for (const box of await page.locator(`${panel} input[type="checkbox"]`).all()) await expect(box).toBeChecked();

  await page.locator(panel).getByRole('checkbox', { name: 'Include POST /api/echo' }).uncheck();
  await page.locator(panel).getByRole('textbox', { name: 'New profile name' }).fill('Fixture capture');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();

  await expect(page.locator(`${panel} .aw-h`)).toHaveText('Endpoints');
  await expect(page.getByText('GET /api/fixture', { exact: true })).toBeVisible();
  await expect(page.getByText('POST /api/echo', { exact: true })).toHaveCount(0);
  const config = await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('api-workbench', 1); request.onsuccess = () => resolve(request.result); });
    return new Promise(resolve => { const read = database.transaction('configs', 'readonly').objectStore('configs').get(location.origin); read.onsuccess = () => resolve(read.result); });
  });
  assert.equal(config.profile.name, 'Fixture capture');
  assert.equal(config.endpoints.length, 1);
  assert.equal(config.endpoints[0].profileId, config.profile.id);
  assert.equal(config.endpoints[0].request.path, '/api/fixture?again=1');
  assert.equal(config.profile.environments.default.default, new URL(page.url()).origin);
});

test('M4 a recorded endpoint can be edited before the profile is created', async ({ page }) => {
  await launch(page);
  await openRecorder(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture').then(response => response.text()));
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.locator(panel).getByRole('button', { name: 'GET /api/fixture' }).click();
  await page.locator(panel).getByRole('textbox', { name: 'Name', exact: true }).fill('Fixture list');
  await page.locator(panel).getByRole('textbox', { name: 'Path', exact: true }).fill('/api/fixture?edited=1');
  await page.getByRole('button', { name: 'Save endpoint', exact: true }).click();
  // The edit survives returning to the review list and is what the profile receives.
  await expect(page.locator(panel).getByRole('button', { name: 'Fixture list' })).toBeVisible();
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await expect(page.locator(`${panel} .aw-h`)).toHaveText('Endpoints');
  await expect(page.getByText('Fixture list', { exact: true })).toBeVisible();
  await expect(page.locator(panel).getByText('/api/fixture?edited=1', { exact: true })).toBeVisible();
});

test('M4 recorder redacts request credentials before review', async ({ page }) => {
  await launch(page);
  await openRecorder(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => fetch('/api/fixture', { headers: { Authorization: 'Bearer should-not-display' } }));
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText(/1 captured · reviewable draft/)).toBeVisible();
  await expect(page.locator(`${panel}`).getByText('Bearer should-not-display', { exact: true })).toHaveCount(0);
});

test('M4 records native XHR traffic and restores the review draft after relaunch', async ({ page }) => {
  await launch(page);
  await openRecorder(page);
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
  await openRecorder(page);
  await expect(page.getByText(/1 captured · reviewable draft/)).toBeVisible();
  await expect(page.locator(`${panel}`).getByText('/api/fixture', { exact: true })).toBeVisible();
});
