import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('dist', { recursive: true });
const options = { entryPoints: ['src/entry.ts'], bundle: true, format: 'iife', target: 'es2022', loader: { '.css': 'text' }, metafile: true, write: false };
const raw = await build(options);
const min = await build({ ...options, minify: true });
const code = min.outputFiles[0].text;
for (const output of Object.values(min.metafile.outputs)) assert.equal(output.imports.length, 0);
// The SVG namespace is an XML identifier, never fetched; no other absolute URL may survive.
const withoutSVGNamespace = code.replaceAll('http://www.w3.org/2000/svg', '');
assert(!/\bimport\s*\(|\beval\s*\(|new Function\b|https?:\/\//.test(withoutSVGNamespace), 'Unexpected runtime loader, executable evaluator or external URL');
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
// Padding is inert and intentionally retained in these installation probes.
for (const length of [131072, 262144, 1048576]) {
  const padded = bookmark + '%3B%2F*' + 'x'.repeat(Math.max(0, length - bookmark.length - 11)) + '*%2F';
  assert.equal(padded.length, length);
  await writeFile(`dist/bookmarklet-${length}.txt`, padded);
  links.push([padded, `Payload probe ${length} characters`]);
}
await writeFile('dist/install.html', `<!doctype html><html lang="en"><meta charset="utf-8"><title>Install API Workbench</title><h1>API Workbench</h1><p>Drag the first link to the bookmarks bar in desktop Chrome or Edge. Then open the local fixture and click the saved bookmark. Do not click the link on this installer to test installation.</p><ol>${links.map(([url, title]) => `<li><a href="${escapeHTML(url)}">${title}</a></li>`).join('')}</ol><p>Manual alternative: create a bookmark, edit its URL and paste the entire matching bookmarklet.txt file, including javascript:. To update, replace that URL. Restart the browser and click the saved bookmark again to test persistence.</p><p>Start the fixture with <code>npm run fixture</code> and visit <a href="http://127.0.0.1:4173/fixture">the fixture</a>. Enlarged links are experimental size probes, not extra features.</p></html>`);
const sizes = { sourceBytes: 0, rawBytes: raw.outputFiles[0].contents.length, minifiedBytes: min.outputFiles[0].contents.length, encodedURLLength: bookmark.length };
for (const file of Object.keys(min.metafile.inputs)) sizes.sourceBytes += (await readFile(file)).length;
await writeFile('dist/sizes.json', JSON.stringify(sizes, null, 2));
console.log(JSON.stringify(sizes, null, 2));
