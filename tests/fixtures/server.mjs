import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createTestApi, openApi } from './test-api.mjs';

export const policies = {
  strict: "default-src 'none'; script-src 'self'; style-src 'none'; connect-src 'self'; img-src 'none'; require-trusted-types-for 'script'",
  blocked: "default-src 'none'; script-src 'self'; style-src 'none'; connect-src 'none'; require-trusted-types-for 'script'",
};
export async function startFixtures() {
  const servers = [];
  for (const port of [4173, 4174]) {
    const hits = {};
    const testApi = createTestApi(port);
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const path = url.pathname;
      res.setHeader('Cache-Control', 'no-store');
      const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      try {
        if (path === '/') { res.writeHead(302, { Location: '/fixture' }); res.end(); return; }
        if (path === '/openapi.json' || path.startsWith('/api/test/')) return await testApi(req, res, url);
        if (path === '/api/stats') return json(hits);
        if (path === '/login') {
          res.setHeader('Set-Cookie', 'aw_fixture_session=local-test; HttpOnly; SameSite=Lax; Path=/');
          return json({ loggedIn: true });
        }
        if (path.startsWith('/api/')) {
          hits[path] = (hits[path] || 0) + 1;
          if (path === '/api/cors-allowed') {
            res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
          }
          if (path === '/api/slow') {
            const timer = setTimeout(() => json({ source: 'network', slow: true }), 1500);
            res.on('close', () => clearTimeout(timer)); return;
          }
          if (path === '/api/session') return json({ authenticated: /aw_fixture_session=local-test/.test(req.headers.cookie || '') });
          if (path === '/api/error') return json({ error: 'fixture' }, 503);
          if (path === '/api/echo-headers') {
            let body = ''; for await (const chunk of req) body += chunk;
            return json({ method: req.method, body, headers: req.headers });
          }
          if (path === '/api/echo') {
            let body = ''; for await (const chunk of req) body += chunk;
            return json({ method: req.method, body, header: req.headers['x-fixture'] || null });
          }
          return json({ source: 'network', path, hit: hits[path] });
        }
        if (path === '/fixture' || path.startsWith('/policy/')) {
          const policy = policies[path.split('/')[2]];
          if (policy) res.setHeader('Content-Security-Policy', policy);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(await readFile(new URL('./page.html', import.meta.url))); return;
        }
        if (path === '/fixture.js') {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(`const fixtureSpec = ${JSON.stringify(openApi(`http://127.0.0.1:${port}`))};\n` + await readFile(new URL('./page.js', import.meta.url), 'utf8')); return;
        }
        if (path === '/fixture.css') {
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
          res.end(await readFile(new URL('./page.css', import.meta.url))); return;
        }
        const artifacts = ['index.html', 'install.html', 'bookmarklet.txt', 'bookmarklet-262144.txt', 'bookmarklet-1048576.txt'];
        if (artifacts.includes(path.slice(1))) {
          res.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
          res.end(await readFile(new URL(`../../dist${path}`, import.meta.url))); return;
        }
        res.writeHead(404); res.end();
      } catch (error) { res.writeHead(500); res.end(String(error)); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    servers.push(server);
  }
  console.log('Fixtures: http://127.0.0.1:4173/fixture and http://127.0.0.1:4174/fixture');
  console.log('Test API: http://127.0.0.1:4173/api/test/echo · Import: http://127.0.0.1:4173/openapi.json');
  return () => Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
}
if (process.argv[1] === new URL(import.meta.url).pathname) await startFixtures();
