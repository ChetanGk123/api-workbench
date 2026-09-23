import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const panel = page => page.locator('#api-workbench .aw-root:not(.aw-min)');
const launch = page => page.evaluate(source); // UI checks only, not saved-bookmark installation evidence.

const picker = page => panel(page).getByRole('combobox', { name: 'Test plan', exact: true });
const iterations = page => panel(page).getByRole('spinbutton', { name: 'Iterations', exact: true });
// The rename field is hidden until it is used, so it is addressed by CSS rather than by role. The
// picker sync writes it in the same callback that rebuilds the form, which makes it the signal
// that the form on screen belongs to the plan just selected: two plans can hold the same numbers,
// so no field of theirs can say which one is mounted.
const shownPlan = page => panel(page).locator('input[aria-label="Plan name"]');
const switchTo = async (page, value, name) => {
  await picker(page).selectOption(value);
  await expect(shownPlan(page)).toHaveValue(name);
};

async function openLoad(page) {
  await panel(page).getByRole('button', { name: 'Test', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/fixture');
  await launch(page);
  await expect(panel(page)).toBeVisible();
});

test('the live plan holds one identity before it is ever edited', async ({ page }) => {
  // A configuration without a stored plan used to fall back to a freshly built one on every read,
  // with a new id each time, so the picker, the form and a plan switch each addressed a different
  // plan and an edit could be written back over the wrong one.
  await openLoad(page);
  const id = await picker(page).inputValue();
  expect(id).not.toBe('');
  await panel(page).getByRole('button', { name: 'Once', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Load', exact: true }).click();
  expect(await picker(page).inputValue()).toBe(id);
  await panel(page).getByRole('button', { name: 'Home', exact: true }).click();
  await openLoad(page);
  expect(await picker(page).inputValue()).toBe(id);
  // Saving a copy leaves the live plan where it was, rather than switching to a new identity.
  await panel(page).getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(picker(page).locator('option')).toHaveText(['Working Plan', 'Working Plan-2']);
  expect(await picker(page).inputValue()).toBe(id);
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
  // The live plan is listed first, so each option is taken by name rather than by position.
  const idOf = name => picker(page).locator('option').filter({ hasText: new RegExp(`^${name}$`) }).getAttribute('value');
  const copy = await idOf('Working Plan-2');
  const original = await idOf('Working Plan');
  await switchTo(page, copy, 'Working Plan-2');
  await expect(iterations(page)).toHaveValue('5');
  await iterations(page).fill('9');
  await iterations(page).blur();
  await expect(iterations(page)).toHaveValue('9');

  await switchTo(page, original, 'Working Plan');
  await expect(iterations(page)).toHaveValue('5');
  await switchTo(page, copy, 'Working Plan-2');
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
