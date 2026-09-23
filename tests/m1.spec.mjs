import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const source = decodeURIComponent(bookmark.slice(11));
const launch = page => page.evaluate(source); // Transport/UI tests only; NOT saved-bookmark proof.
const panel = '#api-workbench .aw-root:not(.aw-min)';
const launcher = '#api-workbench .aw-min';
const TABS = ['Home', 'Test', 'Mock', 'Intercept', 'Route', 'Chaos'];
// A module screen is headed by its full product name; a non-tab screen by the Back sub-header.
// Test follows Test.html, which opens on the plan row instead of an in-body title.
const MODULE_TITLE = { Mock: 'Mock Server', Intercept: 'API Interceptor', Route: 'Page Routing', Chaos: 'Chaos Engineering' };
const subTitle = page => page.locator(`${panel} .aw-sub .aw-subtitle`);
const box = (page, selector) => page.locator(selector).boundingBox();
const styles = page => page.evaluate(() => {
  const read = selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return Array.from(style).map(name => `${name}:${style.getPropertyValue(name)}`).join(';');
  };
  return {
    leak: read('#leak'), heading: read('h1'), login: read('#login'), body: read('body'),
    documentSheets: document.styleSheets.length, adopted: document.adoptedStyleSheets.length,
    headChildren: document.head.childElementCount,
  };
});

test.beforeEach(async ({ page }) => { await page.goto('/fixture'); });

test('tabs and links navigate inside the panel without touching the host page', async ({ page }) => {
  const navigations = [];
  page.on('framenavigated', frame => navigations.push(frame.url()));
  const before = page.url();
  await launch(page);
  await expect(page.locator(panel)).toBeVisible();
  for (const label of TABS) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();

  // Every tab mounts its own screen and marks itself current.
  for (const label of TABS.slice(1)) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    if (label === 'Test') await expect(page.locator(panel).getByRole('textbox', { name: 'Plan name', exact: true })).toBeVisible();
    else await expect(page.locator(`${panel} .aw-body .aw-h`).first()).toHaveText(MODULE_TITLE[label]);
    // The tab strip is the way back; a duplicate in-body control would only add chrome.
    await expect(page.locator(`${panel} .aw-tabs`)).toBeVisible();
    await expect(page.locator(`${panel} .aw-sub`)).toBeHidden();
  }
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator(`${panel} .aw-code`)).toBeVisible();

  // Header icon buttons and Home quick actions both reach the non-tab screens.
  for (const control of ['Settings', 'Import']) {
    await page.locator(`${panel} .aw-tb`).getByRole('button', { name: control, exact: true }).click();
    await expect(subTitle(page)).toHaveText(control);
    await expect(page.locator(`${panel} .aw-tabs`)).toBeHidden();
    await page.getByRole('button', { name: 'Back to Home' }).click();
  }
  for (const action of ['Endpoints', 'Import', 'Settings']) {
    await page.locator(`${panel} .aw-body`).getByRole('button', { name: action, exact: true }).click();
    await expect(subTitle(page)).toHaveText(action);
    await page.getByRole('button', { name: 'Back to Home' }).click();
  }

  expect(page.url()).toBe(before);
  expect(navigations).toEqual([]);
  // No anchors: an internal control can never navigate the application away.
  expect(await page.evaluate(() => document.getElementById('api-workbench').shadowRoot.querySelectorAll('a').length)).toBe(0);
  expect(await page.locator('#api-workbench').count()).toBe(1);
  await page.screenshot({ path: 'test-results/m1-panel.png' });
});

test('minimize shows the launcher, restore and relaunch bring the same screen back', async ({ page }) => {
  await launch(page);
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.locator(panel)).toBeHidden();
  await expect(page.locator(launcher)).toBeVisible();
  await expect(page.locator(`${launcher} .aw-brand`)).toHaveText('AW');
  await page.screenshot({ path: 'test-results/m1-minimized.png' });

  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator(panel)).toBeVisible();
  await expect(page.locator(`${panel} .aw-body .aw-h`).first()).toHaveText('Mock Server');

  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await launch(page);
  await expect(page.locator(panel)).toBeVisible();
  await expect(page.locator(launcher)).toBeHidden();

  // The launcher reports an active module, and that survives minimizing.
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await expect(page.locator(`${launcher} .aw-bd`)).toHaveText('Mock active');
});

test('dragging the header moves the panel and clamps it inside the viewport', async ({ page }) => {
  await launch(page);
  const start = await box(page, panel);
  const drag = async (x, y) => {
    const header = await box(page, `${panel} .aw-tb`);
    await page.mouse.move(header.x + 8, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.up();
    return box(page, panel);
  };
  const moved = await drag(260, 300);
  expect(moved.x).not.toBe(start.x);
  expect(moved.y).not.toBe(start.y);

  const topLeft = await drag(-600, -600);
  expect(topLeft.x).toBeGreaterThanOrEqual(8);
  expect(topLeft.y).toBeGreaterThanOrEqual(8);

  const viewport = page.viewportSize();
  const bottomRight = await drag(viewport.width + 600, viewport.height + 600);
  expect(bottomRight.x + bottomRight.width).toBeLessThanOrEqual(viewport.width);
  expect(bottomRight.y + bottomRight.height).toBeLessThanOrEqual(viewport.height);

  // A header control must act, not drag.
  const before = await box(page, panel);
  await page.locator(`${panel} .aw-tb`).getByRole('button', { name: 'Settings', exact: true }).hover();
  await page.mouse.down();
  await page.mouse.move(before.x + 200, before.y + 200, { steps: 3 });
  await page.mouse.up();
  const after = await box(page, panel);
  expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
});

test('the panel is resizable and stays usable at its smallest size', async ({ page }) => {
  await launch(page);
  expect(await page.locator(panel).evaluate(node => getComputedStyle(node).resize)).toBe('both');
  const viewport = page.viewportSize();
  const limits = await page.locator(panel).evaluate(node => {
    const style = getComputedStyle(node);
    return { maxWidth: parseFloat(style.maxWidth), maxHeight: parseFloat(style.maxHeight) };
  });
  expect(limits.maxWidth).toBeLessThanOrEqual(viewport.width);
  expect(limits.maxHeight).toBeLessThanOrEqual(viewport.height);

  // Shrinking the panel the way the resize grip does must keep the header, tabs and footer reachable.
  await page.locator(panel).evaluate(node => { node.style.width = '340px'; node.style.height = '220px'; });
  for (const part of ['.aw-tb', '.aw-tabs', '.aw-foot']) await expect(page.locator(`${panel} ${part}`)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  const body = await page.locator(`${panel} .aw-body`).evaluate(node => ({ scroll: node.scrollHeight, client: node.clientHeight, overflow: getComputedStyle(node).overflowY }));
  expect(body.scroll).toBeGreaterThan(body.client);
  expect(body.overflow).toBe('auto');
});

test('the panel styles nothing outside its shadow root and loads no font', async ({ page }) => {
  const before = await styles(page);
  await launch(page);
  const after = await styles(page);
  expect(after).toEqual(before);
  expect(await page.evaluate(() => document.getElementById('api-workbench').shadowRoot.adoptedStyleSheets.length)).toBe(1);
  expect(await page.locator(panel).evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(9, 9, 11)');
  expect(await page.locator(panel).evaluate(node => getComputedStyle(node).fontFamily)).not.toContain('Geist');
  expect(await page.locator(`${panel} .aw-code`).evaluate(node => getComputedStyle(node).fontFamily)).not.toContain('Geist');
});

test('store notifications are batched and keep the final observed count', async ({ page }) => {
  await launch(page);
  const result = await page.evaluate(async () => {
    const footer = document.getElementById('api-workbench').shadowRoot.querySelector('.aw-foot');
    let mutations = 0;
    new MutationObserver(records => { mutations += records.length; }).observe(footer, { subtree: true, characterData: true, childList: true });
    const calls = [];
    for (let index = 0; index < 50; index++) calls.push(fetch(`/api/echo?call=${index}`));
    await Promise.all(calls);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { mutations, text: footer.textContent };
  });
  expect(result.text).toContain('50 requests observed');
  expect(result.mutations).toBeGreaterThan(0);
  expect(result.mutations).toBeLessThan(50);
});
