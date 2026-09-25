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

async function exportConfig(page) {
  await panel(page).locator('.aw-tb').getByRole('button', { name: 'Settings', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).getByRole('button', { name: 'Export profile + endpoints', exact: true }).click(),
  ]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

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
  await panel(page).getByRole('button', { name: 'Save as new plan', exact: true }).click();
  await expect(picker(page).locator('option')).toHaveText(['Working Plan', 'Working Plan-2']);
  expect(await picker(page).inputValue()).toBe(id);
});

test('a stored plan keeps its own settings and its name, and switching back restores them', async ({ page }) => {
  await openLoad(page);
  await iterations(page).fill('5');
  await iterations(page).blur();

  // Save stores a copy of the live plan under a name that cannot collide with one already listed.
  await panel(page).getByRole('button', { name: 'Save as new plan', exact: true }).click();
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
  await panel(page).getByRole('button', { name: 'Save as new plan', exact: true }).click();

  await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
  await launch(page);
  await openLoad(page);
  await expect(picker(page).locator('option')).toHaveText(['Checkout load', 'Checkout load-2']);
});

test('a stored plan can be deleted, and deleting the live one leaves another in its place', async ({ page }) => {
  await openLoad(page);
  const remove = panel(page).getByRole('button', { name: 'Delete plan', exact: true });
  // The live plan has never been stored, so there is nothing to delete yet.
  await expect(remove).toBeDisabled();

  await panel(page).getByRole('button', { name: 'Save as new plan', exact: true }).click();
  await expect(picker(page).locator('option')).toHaveText(['Working Plan', 'Working Plan-2']);
  await picker(page).selectOption({ label: 'Working Plan-2' });
  await expect(remove).toBeEnabled();

  await remove.click();
  const dialog = panel(page).locator('dialog.aw-dlg');
  await expect(dialog).toContainText('Delete "Working Plan-2"? This cannot be undone.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker(page).locator('option')).toHaveCount(2);

  await remove.click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  // The deleted plan was the live one, so the remaining stored plan takes its place.
  await expect(picker(page).locator('option')).toHaveText(['Working Plan']);
  expect(await picker(page).inputValue()).toBeTruthy();
});

test('ramp-up is a number with a unit, and the step it sets is what the run waits', async ({ page }) => {
  await openLoad(page);
  const step = panel(page).getByRole('spinbutton', { name: 'Ramp-up step', exact: true });
  // Off by default, and the field says so by being unavailable rather than by disappearing.
  await expect(step).toBeDisabled();
  await expect(step).toHaveValue('250');
  await panel(page).getByRole('switch', { name: 'Ramp-up', exact: true }).click();
  await expect(step).toBeEnabled();
  await step.fill('400');
  await step.blur();
  const config = await exportConfig(page);
  expect(config.plan.rampUp).toBe(true);
  expect(config.plan.rampStepMs).toBe(400);
});

test('the load phase filters, and Include all acts on what the filter shows', async ({ page }) => {
  const sample = JSON.parse(await readFile('tests/fixtures/import-sample.json', 'utf8'));
  await panel(page).locator('.aw-tb').getByRole('button', { name: 'Import', exact: true }).click();
  await panel(page).getByRole('textbox', { name: 'Import source', exact: true }).fill(JSON.stringify(sample));
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await panel(page).getByRole('combobox', { name: 'Import mode', exact: true }).selectOption('replace');
  await panel(page).getByRole('button', { name: 'Import profile', exact: true }).click();
  await panel(page).locator('.aw-sub').getByRole('button', { name: 'Back to Home' }).click();
  await openLoad(page);

  const list = panel(page).locator('[aria-label="Load phase"]');
  const rows = list.locator('.aw-li');
  await expect(rows).toHaveCount(2);
  const filter = panel(page).getByRole('searchbox', { name: 'Filter load phase', exact: true });
  const footer = panel(page).locator('.aw-foot');
  await expect(footer).toContainText('2 selected');

  // Excluding what the filter shows leaves the hidden step alone.
  await filter.fill('echo');
  await expect(rows).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Exclude all', exact: true }).first().click();
  await expect(footer).toContainText('1 selected');
  await filter.fill('');
  await expect(rows).toHaveCount(2);

  // With nothing filtered, Include all takes every step back.
  await panel(page).getByRole('button', { name: 'Include all', exact: true }).first().click();
  await expect(footer).toContainText('2 selected');
});
