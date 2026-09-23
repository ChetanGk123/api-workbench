import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const bookmark = await readFile('dist/bookmarklet.txt', 'utf8');
const page_url = pathToFileURL(process.cwd() + '/dist/index.html').href;

test('Showcase the landing page installs the real bookmarklet and fetches nothing to render', async ({ page }) => {
  // A hosted page that pulled in an asset would not be self-contained the way the product is.
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(page_url);
  expect(requests).toEqual([page_url]);

  const install = page.locator('a.drag');
  await expect(install).toHaveText(/API Workbench/);
  expect(await install.getAttribute('href')).toBe(bookmark);
  expect(await install.getAttribute('draggable')).not.toBe('false');
  // Every advertised format has an adapter: the table is generated from the adapter registry.
  await expect(page.locator('table tbody tr')).toHaveCount(7);
  // The version column is the format spec the build reads, so the page never advertises a newer one.
  await expect(page.locator('table thead')).toContainText('Spec version read');
  await expect(page.locator('body')).toContainText('read with the reader listed here');
  await expect(page.locator('body')).toContainText('Drag the button to your bookmarks bar');
});

test('Showcase the bookmarklet in the page opens the panel on the page it is run from', async ({ page }) => {
  await page.goto('/fixture');
  const href = await (async () => {
    const source = await readFile('dist/index.html', 'utf8');
    return source.slice(source.indexOf('href="javascript:') + 6, source.indexOf('" title="Drag this'));
  })();
  // Decoding the link and running it is the same source the saved bookmark would carry; this is a
  // check of the generated link, not evidence about saved-bookmark installation.
  await page.evaluate(decodeURIComponent(href.replace(/^javascript:/, '').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"')));
  await expect(page.locator('#api-workbench .aw-root:not(.aw-min)')).toBeVisible();
});
