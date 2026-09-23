// Local test infrastructure only; never bundled into the bookmarklet.
const METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const MAX_BODY = 1024 * 1024;
const TOKEN = 'workbench-test-token';

export function createTestApi(port) {
  const origin = `http://127.0.0.1:${port}`;
  const items = new Map();
  let nextId = 1;
  let hits = {};
  const reset = () => { items.clear(); items.set(1, { id: 1, name: 'First item', done: false }); nextId = 2; hits = {}; };
  reset();

  return async (req, res, url) => {
    const path = url.pathname.replace('/api/test', '');
    const method = req.method;
    res.setHeader('X-Test-Origin', origin);
    res.setHeader('X-Test-Server', 'api-workbench');
    if (path !== '/cors-denied' && ['http://127.0.0.1:4173', 'http://127.0.0.1:4174'].includes(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', METHODS);
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-Fixture');
      res.setHeader('Access-Control-Expose-Headers', 'X-Test-Origin, X-Test-Server, Location, Retry-After');
      res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
    }
    const send = (body, status = 200, type = 'application/json; charset=utf-8') => {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(type.startsWith('application/json') ? JSON.stringify(body) : body);
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      const bodyless = [204, 205, 304].includes(status);
      if (!bodyless) res.setHeader('Content-Length', bytes.length);
      res.end(method === 'HEAD' || bodyless ? undefined : bytes);
    };
    const fail = (message, status = 400) => send({ error: message }, status);
    const allow = methods => {
      if (methods.includes(method)) return true;
      res.setHeader('Allow', methods.join(', '));
      fail('Method not allowed', 405); return false;
    };
    const integer = (name, fallback, max, min = 0) => {
      const raw = url.searchParams.get(name);
      const value = raw === null ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
      return value;
    };
    const readBody = () => new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
        else { chunks.length = 0; reject(Object.assign(new Error('Body exceeds 1 MiB'), { status: 413 })); }
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const readJson = async () => {
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
        throw Object.assign(new Error('Send Content-Type: application/json'), { status: 415 });
      const data = JSON.parse((await readBody()).toString());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Body must be a JSON object');
      return data;
    };
    try {
      if (path === '/openapi.json') return send(openApi(origin));
      if (method === 'OPTIONS') { res.setHeader('Allow', METHODS); return send(null, 204); }
      if (path !== '/stats') hits[`${method} ${url.pathname}`] = (hits[`${method} ${url.pathname}`] || 0) + 1;
      if (path === '/echo' || path === '/cors-denied') {
        const bytes = await readBody();
        const body = bytes.toString();
        let json = null;
        if (/application\/json/i.test(req.headers['content-type'] || '') && body) json = JSON.parse(body);
        return send({ method, url: url.href, headers: req.headers,
          query: Object.fromEntries([...new Set(url.searchParams.keys())].map(key => [key, url.searchParams.getAll(key)])),
          body, json, bytes: bytes.length, base64: bytes.toString('base64') });
      }
      if (path === '/stats') return allow(['GET', 'HEAD']) && send({ hits, items: items.size });
      if (path === '/reset') { if (allow(['POST'])) { reset(); send({ reset: true }); } return; }
      if (path === '/login') {
        if (!allow(['POST'])) return;
        res.setHeader('Set-Cookie', 'aw_test_session=local-test; HttpOnly; SameSite=Lax; Path=/api/test');
        return send({ token: TOKEN, user: { id: 1, name: 'Test user' } });
      }
      if (path === '/session' || path === '/auth') {
        if (!allow(['GET', 'HEAD'])) return;
        const authenticated = path === '/auth' ? req.headers.authorization === `Bearer ${TOKEN}`
          : (req.headers.cookie || '').split(';').some(cookie => cookie.trim() === 'aw_test_session=local-test');
        if (!authenticated) { res.setHeader('WWW-Authenticate', 'Bearer realm="workbench-test"'); return fail('Unauthorized', 401); }
        return send({ authenticated, user: { id: 1, name: 'Test user' } });
      }
      if (path === '/items') {
        if (!allow(['GET', 'HEAD', 'POST'])) return;
        if (method !== 'POST') return send({ items: [...items.values()] });
        const data = await readJson();
        if (typeof data.name !== 'string' || !data.name.trim()) return fail('name is required');
        if (items.size >= 1000) return fail('Item limit reached; POST /api/test/reset', 409);
        const item = { ...data, id: nextId++ };
        items.set(item.id, item); res.setHeader('Location', `/api/test/items/${item.id}`);
        return send(item, 201);
      }
      const match = /^\/items\/(\d+)$/.exec(path);
      if (match) {
        if (!allow(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'])) return;
        const id = Number(match[1]);
        if (!items.has(id)) return fail('Item not found', 404);
        if (method === 'DELETE') { items.delete(id); return send(null, 204); }
        if (method === 'PUT' || method === 'PATCH') {
          const data = await readJson();
          const item = { ...(method === 'PATCH' ? items.get(id) : {}), ...data, id };
          if (typeof item.name !== 'string' || !item.name.trim()) return fail('name is required');
          items.set(id, item);
        }
        return send(items.get(id));
      }
      if (path === '/status') {
        const status = integer('code', 500, 599, 200);
        if (status === 429 || status === 503) res.setHeader('Retry-After', '1');
        return send({ status, message: 'Requested test status' }, status);
      }
      if (path === '/delay') {
        const ms = integer('ms', 1500, 30000);
        const timer = setTimeout(() => send({ delayed: ms }), ms);
        res.once('close', () => clearTimeout(timer)); return;
      }
      if (path === '/redirect') {
        res.setHeader('Location', '/api/test/echo?redirected=true'); return send(null, 302);
      }
      if (path === '/text') return send('Hello from API Workbench — café ✓\n', 200, 'text/plain; charset=utf-8');
      if (path === '/xml') return send('<item><id>1</id><name>Test item</name></item>', 200, 'application/xml');
      if (path === '/invalid-json') return send(Buffer.from('{"broken":'), 200);
      if (path === '/bytes') return send(Buffer.alloc(integer('size', 65536, MAX_BODY), 97), 200, 'application/octet-stream');
      if (path === '/large-json') return send({ data: 'x'.repeat(integer('size', 262144, MAX_BODY)) });
      if (path === '/disconnect') { req.socket.destroy(); return; }
      if (path === '/stream') {
        const count = integer('chunks', 5, 100, 1), ms = integer('ms', 100, 1000, 10);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        if (method === 'HEAD') return res.end();
        let sent = 0;
        const timer = setInterval(() => {
          res.write(`${JSON.stringify({ chunk: ++sent })}\n`);
          if (sent === count) { clearInterval(timer); res.end(); }
        }, ms);
        res.once('close', () => clearInterval(timer)); return;
      }
      fail('Unknown test endpoint', 404);
    } catch (error) { fail(error.message, error.status || 400); }
  };
}

export function openApi(origin) {
  const paths = {};
  const add = (path, method, summary, { body, parameters = [], status = 200 } = {}) => {
    const operation = { summary, operationId: `${method}_${path.replace(/\W+/g, '_')}`, parameters,
      responses: { [status]: { description: summary } } };
    if (body) operation.requestBody = { required: true, content: { 'application/json': { example: body } } };
    (paths[`/api/test${path}`] ||= {})[method] = operation;
  };
  const param = (name, example, location = 'query') => ({ name, in: location, required: true, schema: { type: typeof example === 'number' ? 'integer' : 'string' }, example });
  for (const method of METHODS.toLowerCase().split(', '))
    add('/echo', method, `Echo ${method.toUpperCase()}`, {
      status: method === 'options' ? 204 : 200,
      body: ['post', 'put', 'patch', 'delete'].includes(method) ? { message: 'Hello workbench' } : undefined,
    });
  add('/items', 'get', 'List items');
  add('/items', 'post', 'Create item', { body: { name: 'New item', done: false }, status: 201 });
  for (const method of ['get', 'put', 'patch', 'delete']) add('/items/{id}', method, `${method.toUpperCase()} item`, {
    parameters: [param('id', 1, 'path')], status: method === 'delete' ? 204 : 200,
    body: ['put', 'patch'].includes(method) ? { name: 'Updated item', done: true } : undefined,
  });
  add('/login', 'post', 'Create test session and token');
  add('/session', 'get', 'Check session cookie');
  add('/auth', 'get', 'Check bearer token', { parameters: [param('Authorization', `Bearer ${TOKEN}`, 'header')] });
  add('/status', 'get', 'Return chosen HTTP status', { parameters: [param('code', 503)], status: 503 });
  add('/delay', 'get', 'Delayed response', { parameters: [param('ms', 1500)] });
  add('/bytes', 'get', 'Binary response', { parameters: [param('size', 65536)] });
  add('/large-json', 'get', 'Large JSON response', { parameters: [param('size', 262144)] });
  add('/stream', 'get', 'Finite NDJSON stream', { parameters: [param('chunks', 5), param('ms', 100)] });
  for (const path of ['/text', '/xml', '/invalid-json', '/redirect', '/disconnect', '/cors-denied', '/stats'])
    add(path, 'get', path.slice(1), { status: path === '/redirect' ? 302 : 200 });
  add('/reset', 'post', 'Reset test items and counters');
  return { openapi: '3.0.3', info: { title: 'API Workbench local test API', version: '1.0.0' }, servers: [{ url: origin }], paths };
}
