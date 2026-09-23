import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.

const picker = page => panel(page).getByRole('combobox', { name: 'Test plan', exact: true });
const iterations = page => panel(page).getByRole('spinbutton', { name: 'Iterations', exact: true });

async function openLoad(page) {
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
  await expect(panel(page)).toBeVisible();
});

test('a stored plan keeps its own settings and its name, and switching back restores them', async ({ page }) => {
  await openLoad(page);
  await iterations(page).fill('5');
  await iterations(page).blur();

  // Save stores a copy of the live plan under a name that cannot collide with one already listed.
  await panel(page).getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(picker(page).locator('option')).toHaveText(['Working Plan', 'Working Plan-2']);
  await expect(picker(page)).toHaveValue(await picker(page).locator('option').first().getAttribute('value'));

  // Switching to the copy carries its settings, and editing it leaves the plan behind untouched.
  const copy = await picker(page).locator('option').nth(1).getAttribute('value');
  await picker(page).selectOption(copy);
  await expect(iterations(page)).toHaveValue('5');
  await iterations(page).fill('9');
  await iterations(page).blur();

  const original = await picker(page).locator('option').nth(1).getAttribute('value');
  await picker(page).selectOption(original);
  await expect(iterations(page)).toHaveValue('5');
  await picker(page).selectOption(copy);
  await expect(iterations(page)).toHaveValue('9');
});

test('rename retitles the live plan in the picker and survives a relaunch', async ({ page }) => {
  await openLoad(page);
  await panel(page).getByRole('button', { name: 'Rename plan', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Plan name', exact: true }).fill('Checkout load');
  await panel(page).getByRole('textbox', { name: 'Plan name', exact: true }).blur();
  await expect(picker(page).locator('option')).toHaveText(['Checkout load']);
  await panel(page).getByRole('button', { name: 'Save plan', exact: true }).click();

  await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await openLoad(page);
  await expect(picker(page).locator('option')).toHaveText(['Checkout load', 'Checkout load-2']);
});
