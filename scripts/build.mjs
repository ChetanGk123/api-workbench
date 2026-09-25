import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { showcasePage } from './showcase.mjs';

await mkdir('dist', { recursive: true });
// package.json is the only place the app version is written; the bundle and the landing page both
// read it from here, so a release cannot ship a stale version baked into the source.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
assert.match(version, /^\d+\.\d+\.\d+$/, 'package.json version must be a plain semver');
const options = { entryPoints: ['src/entry.ts'], bundle: true, format: 'iife', target: 'es2022', loader: { '.css': 'text' }, define: { __AW_VERSION__: JSON.stringify(version) }, metafile: true, write: false };
const raw = await build(options);
const min = await build({ ...options, minify: true });
const code = min.outputFiles[0].text;
for (const output of Object.values(min.metafile.outputs)) assert.equal(output.imports.length, 0);
// The SVG namespace is an XML identifier, never fetched. The published-version manifest is the one
// URL the bundle may request: it is read as data for the update check, never loaded as code, and a
// failed read falls back to the origin-recorded comparison. No other absolute URL may survive.
const VERSION_MANIFEST_URL = 'https://raw.githubusercontent.com/ChetanGk123/api-workbench/main/package.json';
assert(code.includes(VERSION_MANIFEST_URL), 'The published-version manifest URL is missing from the bundle');
const withoutKnownURLs = code.replaceAll('http://www.w3.org/2000/svg', '').replaceAll(VERSION_MANIFEST_URL, '');
assert(!/\bimport\s*\(|\beval\s*\(|new Function\b|https?:\/\//.test(withoutKnownURLs), 'Unexpected runtime loader, executable evaluator or external URL');
for (const path of ['design/reference/aw-theme.css', 'src/ui/theme.css'])
  assert(!/url\s*\(|@import/i.test(await readFile(path, 'utf8')), 'External CSS asset');
export const encode = source => 'javascript:' + encodeURIComponent('void function(){\n' + source + '\n}()');
export const escapeHTML = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;');
const bookmark = encode(code);
const unusual = `const sample = 'café ✓ <>&"'; // % # ? \u2028\n`;
assert.equal(decodeURIComponent(encode(unusual).slice(11)), 'void function(){\n' + unusual + '\n}()');
await writeFile('dist/api-workbench.js', raw.outputFiles[0].text);
await writeFile('dist/api-workbench.min.js', code);
await writeFile('dist/bookmarklet.txt', bookmark);
const links = [[bookmark, 'API Workbench']];
// Padding is inert and intentionally retained in these installation probes. A probe target the
// real bookmark has already outgrown is dropped rather than silently emitted at the wrong size.
const probes = [131072, 262144, 1048576].filter(length => length > bookmark.length + 11);
const skipped = [131072, 262144, 1048576].filter(length => !probes.includes(length));
for (const length of probes) {
  const padded = bookmark + '%3B%2F*' + 'x'.repeat(length - bookmark.length - 11) + '*%2F';
  assert.equal(padded.length, length);
  await writeFile(`dist/bookmarklet-${length}.txt`, padded);
  links.push([padded, `Payload probe ${length} characters`]);
}
if (skipped.length) console.warn(`Payload probes smaller than the bundle were skipped: ${skipped.join(', ')}`);
await writeFile('dist/install-probes.html', `<!doctype html><html lang="en"><meta charset="utf-8"><title>Install API Workbench</title><h1>API Workbench</h1><p>Drag the first link to the bookmarks bar in desktop Chrome or Edge. Then open the local fixture and click the saved bookmark. Do not click the link on this installer to test installation.</p><ol>${links.map(([url, title]) => `<li><a href="${escapeHTML(url)}">${title}</a></li>`).join('')}</ol><p>Manual alternative: create a bookmark, edit its URL and paste the entire matching bookmarklet.txt file, including javascript:. To update, replace that URL. Restart the browser and click the saved bookmark again to test persistence.</p><p>Start the fixture with <code>npm run fixture</code> and visit <a href="http://127.0.0.1:4173/fixture">the fixture</a>. Enlarged links are experimental size probes, not extra features.</p></html>`);
await writeFile('dist/install.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Install API Workbench</title><h1>API Workbench ${version}</h1><p>Drag <a href="${escapeHTML(bookmark)}">API Workbench</a> to the bookmarks bar in desktop Chrome or Edge.</p><p>Open the application you want to test, then click the saved bookmark to launch API Workbench on that page.</p><p>Manual alternative: open <a href="bookmarklet.txt">bookmarklet.txt</a>, copy its entire contents including <code>javascript:</code>, and paste it into a bookmark's URL field.</p><p>To update, replace your saved bookmark with the latest link on this page. Existing bookmarks do not update automatically. Reload the application before launching the new version.</p><p><a href="./">Features and usage guide</a></p></html>`);
// The landing page lists the formats the product actually implements, read from the adapter
// registry rather than retyped here, so an unimplemented format can never be advertised.
const registry = await build({ entryPoints: ['src/import/detect.ts'], bundle: true, format: 'esm', write: false });
const { FORMATS } = await import(`data:text/javascript,${encodeURIComponent(registry.outputFiles[0].text)}`);
const page = showcasePage({
  bookmark,
  version,
  formats: FORMATS.filter(format => format.id !== 'recorder'),
  sizes: { minifiedBytes: min.outputFiles[0].contents.length, encodedURLLength: bookmark.length },
});
// Self-contained or it is not hostable the way the product is distributed: no asset may be fetched.
// The install link holds the bundle, which was already checked above; the page around it must not
// pull in anything. `url(#id)` is an internal SVG reference, anything else would be a fetch.
const pageShell = page.replace(escapeHTML(bookmark), '');
// The CSS check is case-sensitive on purpose: `cURL (bash)` and `new URL(` are prose, not a fetch.
const externalAsset = [/<img/i, /<link/i, /<iframe/i, /<script[^>]+\bsrc=/i, /@import/i, /url\s*\(\s*['"]?(?!#)/,
  /https?:\/\/(?!www\.w3\.org|app\.example\.com)/i];
assert(!externalAsset.some(pattern => pattern.test(pageShell)), 'Landing page must not reference an external asset');
assert(page.includes('href="javascript:'), 'Landing page lost its install link');
await writeFile('dist/index.html', page);

const sizes = { probes, skippedProbes: skipped, landingPageBytes: Buffer.byteLength(page), sourceBytes: 0, rawBytes: raw.outputFiles[0].contents.length, minifiedBytes: min.outputFiles[0].contents.length, encodedURLLength: bookmark.length };
for (const file of Object.keys(min.metafile.inputs)) sizes.sourceBytes += (await readFile(file)).length;
await writeFile('dist/sizes.json', JSON.stringify(sizes, null, 2));
console.log(JSON.stringify(sizes, null, 2));
