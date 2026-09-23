import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { detect, FORMATS } from '../src/import/detect.ts';
import { parseSource } from '../src/import/parse.ts';
import { parseCurl, tokenize } from '../src/import/curl.ts';
import { parseFetchSnippet } from '../src/import/fetch-snippet.ts';
import { applyCandidates, applyNative, conflictOf, linkedTo, summaryText } from '../src/import/commit.ts';
import { parseNative, remap } from '../src/import/native.ts';
import { defaultEndpoint, defaultProfile, defaultMockRule, defaultTestPlan } from '../src/core/model.ts';

const openapi3 = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1' },
  servers: [{ url: 'https://{host}/v1', variables: { host: { default: 'api.pets.test' } } }],
  components: {
    parameters: { PetId: { name: 'petId', in: 'path', required: true, schema: { type: 'string' } } },
    schemas: { Pet: { type: 'object', example: { name: 'Rex' } } },
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        parameters: [
          { name: 'limit', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { content: { 'application/json': { example: [{ id: 1 }] } } } },
      },
      post: {
        operationId: 'createPet',
        requestBody: {
          content: {
            'application/json': { examples: { full: { value: { name: 'Rex' } }, minimal: { value: {} } } },
            'application/xml': { schema: { $ref: '#/components/schemas/Pet' } },
          },
        },
        responses: { 201: {} },
        security: [{ bearerAuth: [] }],
      },
    },
    '/pets/{petId}': {
      parameters: [{ $ref: '#/components/parameters/PetId' }],
      delete: { operationId: 'deletePet', responses: { 204: {} } },
    },
  },
});

const swagger2 = JSON.stringify({
  swagger: '2.0',
  host: 'api.legacy.test',
  basePath: '/v2',
  schemes: ['https'],
  consumes: ['application/json'],
  paths: {
    '/orders/{orderId}': {
      get: { operationId: 'getOrder', parameters: [{ name: 'orderId', in: 'path', required: true, type: 'string' }], responses: { 200: { examples: { 'application/json': { id: 7 } } } } },
      post: {
        operationId: 'getOrder',
        parameters: [
          { name: 'orderId', in: 'path', required: true, type: 'string' },
          { name: 'X-Trace', in: 'header', type: 'string', default: 'on' },
          { name: 'body', in: 'body', schema: { example: { note: 'hi' } } },
        ],
        responses: { 201: {} },
      },
    },
  },
});

const har = JSON.stringify({
  log: {
    version: '1.2',
    entries: [
      {
        time: 12.4,
        request: { method: 'GET', url: 'https://api.test/items?page=1', headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Cookie', value: 'a=b' }], queryString: [{ name: 'page', value: '1' }], cookies: [] },
        response: { status: 200, headers: [], content: { size: 9, mimeType: 'application/json', text: 'eyJvayI6MX0=', encoding: 'base64' } },
      },
      {
        request: { method: 'POST', url: 'https://api.test/items', headers: [], postData: { mimeType: 'application/json', text: '{"a":1}' }, queryString: [], cookies: [] },
        response: { status: 201, headers: [], content: { size: 0 } },
      },
      {
        request: { method: 'POST', url: 'https://api.test/items', headers: [], postData: { mimeType: 'application/json', text: '{"a":2}' }, queryString: [], cookies: [] },
        response: { status: 201, headers: [], content: {} },
      },
      { request: { method: 'CONNECT', url: 'https://api.test/tunnel', headers: [], queryString: [], cookies: [] }, response: { status: 0, headers: [], content: {} } },
    ],
  },
});

const postman = JSON.stringify({
  info: { _postman_id: 'x', name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{authToken}}' }] },
  variable: [{ key: 'base', value: 'https://api.shop.test' }],
  event: [{ listen: 'prerequest', script: { exec: ['console.log(1)'] } }],
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          request: {
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Old', value: '1', disabled: true }],
            url: { raw: '{{base}}/login?next=/home', query: [{ key: 'next', value: '/home' }, { key: 'debug', value: '1', disabled: true }] },
            body: { mode: 'raw', raw: '{"user":"{{user}}"}', options: { raw: { language: 'json' } } },
            auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] },
          },
        },
      ],
    },
    {
      name: 'Profile',
      request: { method: 'GET', url: '{{base}}/me' },
      event: [{ listen: 'test', script: { exec: ['pm.test()'] } }],
    },
    { name: 'Upload', request: { method: 'POST', url: '{{base}}/upload', body: { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: '/tmp/a.png' }, { key: 'note', value: 'hi', type: 'text' }] } } },
    { name: 'Oauth', request: { method: 'GET', url: '{{base}}/oauth', auth: { type: 'oauth2', oauth2: [] } } },
  ],
});

const config = (overrides = {}) => ({ profile: defaultProfile(), endpoints: [], rules: [], savedProfiles: [], ...overrides });

/* ── Detection ─────────────────────────────────────────────────────────────── */

test('M9 each format is detected from its own content, not its extension', () => {
  assert.equal(detect(openapi3).format, 'openapi');
  assert.equal(detect(swagger2).format, 'swagger');
  assert.equal(detect(har).format, 'har');
  assert.equal(detect(postman).format, 'postman');
  assert.equal(detect('curl https://a.test -H "x: 1"').format, 'curl');
  assert.equal(detect('fetch("https://a.test");').format, 'fetch');
  assert.equal(detect(JSON.stringify({ schemaVersion: 1, profile: { id: 'p' }, endpoints: [] })).format, 'native');
});

test('M9 detection reports the reader this build has, never the version the document declares', () => {
  const newer = detect(JSON.stringify({ openapi: '3.1.0', paths: {} }));
  assert.equal(newer.version, '3.0');
  assert.match(newer.reason, /OpenAPI 3\.1\.0, read with the 3\.0 reader/);
  const newerHar = detect(JSON.stringify({ log: { version: '1.3', entries: [] } }));
  assert.equal(newerHar.version, '1.2');
  assert.match(newerHar.reason, /HAR 1\.3, read with the 1\.2 reader/);
  const newerNative = detect(JSON.stringify({ schemaVersion: 2, profile: { id: 'p' }, endpoints: [] }));
  assert.equal(newerNative.version, 'schema 1');
  assert.match(newerNative.reason, /declaring schema 2, read with the schema 1 reader/);
  assert.equal(detect(har).version, '1.2');
  assert.equal(detect(postman).version, 'Collection v2.1');
});

test('M9 a JSON document that merely contains a request field is not identified', () => {
  const detection = detect(JSON.stringify({ request: { method: 'GET' }, items: [] }));
  assert.equal(detection.format, undefined);
  assert.match(detection.reason, /no recognised format discriminator/);
  const outcome = parseSource(JSON.stringify({ request: {} }), 'default');
  assert.ok(outcome.error);
  assert.equal(outcome.normalized, undefined);
});

test('M9 a Format override that contradicts the source names the format it looks like', () => {
  const outcome = parseSource(openapi3, 'default', 'native');
  assert.match(outcome.error, /Not a Workbench export/);
  assert.match(outcome.error, /Format is set to Native, but this source looks like OpenAPI/);
  // An override that agrees with the source is read normally, with no added hint.
  assert.equal(parseSource(openapi3, 'default', 'openapi').error, undefined);
});

test('M9 every advertised format has an adapter', () => {
  assert.deepEqual(FORMATS.map(format => format.id).sort(), ['curl', 'fetch', 'har', 'native', 'openapi', 'postman', 'recorder', 'swagger']);
});

/* ── OpenAPI 3.0 ───────────────────────────────────────────────────────────── */

test('M9 OpenAPI 3.0 resolves servers, keeps unresolved path parameters and lists body examples', () => {
  const outcome = parseSource(openapi3, 'default');
  assert.equal(outcome.format, 'openapi');
  assert.equal(outcome.sourceCount, 3);
  const candidates = outcome.normalized.candidates;
  const list = candidates.find(item => item.endpoint.alias === 'listpets');
  assert.equal(list.endpoint.hostKey, 'api.pets.test');
  assert.equal(outcome.normalized.hosts['api.pets.test'], 'https://api.pets.test');
  assert.equal(list.endpoint.request.path, '/v1/pets?limit={{limit}}', 'a required query parameter with no example stays a template');
  assert.deepEqual(list.unresolved, ['limit']);
  assert.equal(list.endpoint.sampleResponse.status, 200);
  const remove = candidates.find(item => item.endpoint.alias === 'deletepet');
  assert.equal(remove.endpoint.request.path, '/v1/pets/{{petId}}', 'a $ref path parameter is resolved and left unresolved as a value');
  const create = candidates.find(item => item.endpoint.alias === 'createpet');
  assert.equal(create.endpoint.request.bodyKind, 'json');
  assert.deepEqual(JSON.parse(create.endpoint.request.body), { name: 'Rex' });
  assert.equal(create.variants.length, 2, 'both named JSON examples are offered');
  assert.ok(create.diagnostics.some(item => /application\/xml is schema-only/.test(item.message)));
  assert.ok(create.diagnostics.some(item => /bearerAuth/.test(item.message)));
});

test('M9 Swagger 2.0 reads base URL, body examples and resolves operation-id collisions', () => {
  const outcome = parseSource(swagger2, 'default');
  assert.equal(outcome.format, 'swagger');
  const [get, post] = outcome.normalized.candidates;
  assert.equal(get.endpoint.request.path, '/v2/orders/{{orderId}}');
  assert.equal(get.endpoint.hostKey, 'api.legacy.test');
  assert.deepEqual(get.endpoint.sampleResponse, { status: 200, headers: [], body: JSON.stringify({ id: 7 }, null, 2) });
  assert.equal(post.endpoint.alias, 'getorder_2', 'a duplicate operation id is resolved in the preview');
  assert.deepEqual(JSON.parse(post.endpoint.request.body), { note: 'hi' });
  assert.equal(post.endpoint.request.headers.find(header => header.name === 'X-Trace').value, 'on');
});

/* ── HAR ───────────────────────────────────────────────────────────────────── */

test('M9 HAR keeps distinct bodies apart, decodes base64 samples and reports absent ones', () => {
  const outcome = parseSource(har, 'default');
  assert.equal(outcome.sourceCount, 4);
  assert.equal(outcome.normalized.skipped, 1, 'the CONNECT entry is skipped, not silently dropped');
  const candidates = outcome.normalized.candidates;
  assert.equal(candidates.length, 3, 'two POSTs to one URL with different bodies stay separate');
  assert.equal(candidates[0].endpoint.sampleResponse.body, '{"ok":1}');
  assert.equal(candidates[0].endpoint.request.credentials, 'include');
  assert.ok(!candidates[0].endpoint.request.headers.some(header => header.name.toLowerCase() === 'cookie'), 'a restricted header is a diagnostic, not a replayable header');
  assert.ok(candidates[0].diagnostics.some(item => /Browser-controlled header not imported: Cookie/.test(item.message)));
  assert.ok(candidates[0].diagnostics.some(item => /Recorded timing: 12 ms/.test(item.message)));
  assert.equal(candidates[1].endpoint.request.body, '{"a":1}');
  assert.equal(candidates[2].endpoint.request.body, '{"a":2}');
  assert.ok(candidates[2].diagnostics.some(item => /omitted by the exporter/.test(item.message)));
});

test('M9 repeated identical HAR entries collapse with a count', () => {
  const twice = JSON.parse(har);
  twice.log.entries = [twice.log.entries[1], twice.log.entries[1]];
  const outcome = parseSource(JSON.stringify(twice), 'default');
  assert.equal(outcome.normalized.candidates.length, 1);
  assert.equal(outcome.normalized.candidates[0].count, 2);
});

/* ── Postman ───────────────────────────────────────────────────────────────── */

test('M9 Postman walks folders, applies inheritance and reports scripts and unsupported auth', () => {
  const outcome = parseSource(postman, 'default');
  assert.equal(outcome.sourceCount, 4);
  const [login, profile, upload, oauth] = outcome.normalized.candidates;
  assert.equal(login.key, 'Auth/Login');
  assert.equal(login.source, 'Postman · Auth/Login');
  assert.equal(login.endpoint.request.path, '/login?next=/home', 'a disabled query parameter is not imported');
  assert.equal(login.endpoint.hostKey, 'api.shop.test', 'a collection variable resolves the host');
  assert.equal(login.endpoint.request.headers.find(header => header.name === 'Authorization').value, `Basic ${btoa('u:p')}`);
  assert.ok(!login.endpoint.request.headers.some(header => header.name === 'X-Old'));
  assert.deepEqual(login.unresolved, ['user'], 'an unresolved collection variable stays a template');
  assert.ok(login.diagnostics.some(item => /disabled header/.test(item.message)));
  assert.equal(profile.endpoint.request.headers.find(header => header.name === 'Authorization').value, 'Bearer {{authToken}}', 'collection auth is inherited');
  assert.ok(profile.diagnostics.some(item => /scripts .* are not imported and never run/.test(item.message)));
  assert.ok(upload.diagnostics.some(item => /file field/.test(item.message)));
  assert.ok(oauth.diagnostics.some(item => /Unsupported auth type "oauth2"/.test(item.message)));
  assert.ok(outcome.diagnostics.some(item => /Collection scripts are not imported/.test(item.message)));
  assert.ok(outcome.diagnostics.some(item => /authToken/.test(item.message)));
});

/* ── cURL ──────────────────────────────────────────────────────────────────── */

test('M9 the cURL tokenizer handles quoting, escapes, Unicode and line continuations', () => {
  assert.deepEqual(tokenize(`curl 'http://a.test' \\\n  -H 'x: a'\\''b' \\\n  --data-raw '{"é":"ü"}'`).map(token => token.text),
    ['curl', 'http://a.test', '-H', "x: a'b", '--data-raw', '{"é":"ü"}']);
  assert.deepEqual(tokenize('curl "http://a.test" ^\n  -H "x: 1"').map(token => token.text), ['curl', 'http://a.test', '-H', 'x: 1']);
});

test('M9 a Chrome Copy as cURL command becomes one endpoint with a translated credentials intent', () => {
  const outcome = parseSource(`curl 'https://api.test/items?page=2' \\\n  -X POST \\\n  -H 'content-type: application/json' \\\n  -H 'cookie: session=abc' \\\n  -H 'accept-encoding: gzip' \\\n  --data-raw '{"name":"Ré"}' \\\n  --compressed`, 'default');
  assert.equal(outcome.format, 'curl');
  const [candidate] = outcome.normalized.candidates;
  assert.equal(candidate.endpoint.request.method, 'POST');
  assert.equal(candidate.endpoint.request.path, '/items?page=2');
  assert.equal(candidate.endpoint.request.bodyKind, 'json');
  assert.equal(candidate.endpoint.request.body, '{"name":"Ré"}');
  assert.equal(candidate.endpoint.request.credentials, 'include');
  assert.ok(!candidate.endpoint.request.headers.some(header => /cookie|accept-encoding/i.test(header.name)));
  assert.ok(outcome.diagnostics.some(item => /Cookie header replaced by credentials: include/.test(item.message)));
});

test('M9 cURL reports unsupported flags with their position and never reads a file or runs a shell', () => {
  const outcome = parseCurl(`curl https://api.test/upload --data @secret.json --proxy 1.2.3.4 -d "$(cat /etc/passwd)"`);
  assert.ok(outcome.diagnostics.some(item => /File reference @secret.json at character \d+/.test(item.message)));
  assert.ok(outcome.diagnostics.some(item => /Unsupported flag --proxy at character \d+/.test(item.message)));
  assert.ok(outcome.diagnostics.some(item => /Shell substitution at character \d+ is kept as literal text/.test(item.message)));
  assert.equal(outcome.requests[0].body.text, '$(cat /etc/passwd)', 'the substitution stays literal text');
});

test('M9 several cURL commands in one paste become several candidates', () => {
  const outcome = parseSource(`curl 'https://api.test/a'\ncurl 'https://api.test/b' -X DELETE`, 'default');
  assert.equal(outcome.sourceCount, 2);
  assert.deepEqual(outcome.normalized.candidates.map(item => item.endpoint.request.path), ['/a', '/b']);
});

/* ── fetch() ───────────────────────────────────────────────────────────────── */

test('M9 a Chrome Copy as fetch snippet is parsed as data with escapes and Unicode intact', () => {
  const snippet = `fetch("https://api.test/items", {\n  "headers": {\n    "content-type": "application/json",\n    "x-note": "caf\\u00e9"\n  },\n  "referrer": "https://api.test/",\n  "body": "{\\"name\\":\\"R\\u00e9\\"}",\n  "method": "POST",\n  "mode": "cors",\n  "credentials": "include"\n});`;
  const outcome = parseSource(snippet, 'default');
  const [candidate] = outcome.normalized.candidates;
  assert.equal(candidate.endpoint.request.method, 'POST');
  assert.equal(candidate.endpoint.request.path, '/items');
  assert.equal(candidate.endpoint.hostKey, 'api.test');
  assert.equal(candidate.endpoint.request.body, '{"name":"Ré"}');
  assert.equal(candidate.endpoint.request.headers.find(header => header.name === 'x-note').value, 'café');
  assert.equal(candidate.endpoint.request.credentials, 'include');
  assert.ok(outcome.diagnostics.some(item => /Browser-controlled option not imported: mode/.test(item.message)));
  assert.ok(outcome.diagnostics.some(item => /referrer/.test(item.message)));
});

test('M9 a fetch snippet that depends on code is rejected with a position and never evaluated', () => {
  globalThis.__m9_executed = false;
  const outcome = parseFetchSnippet('fetch("https://api.test/x", { method: "POST", body: JSON.stringify({ a: (globalThis.__m9_executed = true) }) });');
  assert.equal(outcome.requests.length, 0);
  assert.match(outcome.diagnostics[0].message, /^Character \d+: the options object contains code or invalid JSON/);
  assert.equal(globalThis.__m9_executed, false);
});

test('M9 a fetch URL that is not a literal is rejected', () => {
  const outcome = parseFetchSnippet('fetch(url, { method: "GET" });');
  assert.match(outcome.diagnostics[0].message, /the fetch URL must be a literal string/);
  assert.match(parseFetchSnippet('fetch(`https://api.test/${id}`);').diagnostics[0].message, /literal string/);
  assert.equal(parseFetchSnippet('fetch(\'https://api.test/a\')').requests[0].url, 'https://api.test/a');
});

/* ── Native ────────────────────────────────────────────────────────────────── */

const nativeDocument = (overrides = {}) => {
  const profile = { ...defaultProfile(), id: 'p1', name: 'Imported' };
  const endpoint = { ...defaultEndpoint('p1'), id: 'e1', alias: 'login', name: 'Login' };
  const rule = { ...defaultMockRule('p1', 1), id: 'r1', endpointId: 'e1' };
  const plan = { ...defaultTestPlan('p1'), id: 'pl1', phases: { e1: 'setup' }, excluded: [] };
  return { schemaVersion: 1, profile, endpoints: [endpoint], rules: [rule], plan, ...overrides };
};

test('M9 a newer native schema is rejected and changes nothing', () => {
  const outcome = parseSource(JSON.stringify(nativeDocument({ schemaVersion: 99 })), 'default');
  assert.match(outcome.error, /schema 99/);
  assert.equal(outcome.native, undefined);
});

test('M9 importing native as a copy remaps ids and every dependent reference', () => {
  const { native } = parseNative(nativeDocument());
  const copy = remap(native, 'Copy');
  assert.notEqual(copy.profile.id, 'p1');
  assert.equal(copy.profile.name, 'Copy');
  const [endpoint] = copy.endpoints;
  assert.notEqual(endpoint.id, 'e1');
  assert.equal(endpoint.profileId, copy.profile.id);
  assert.equal(copy.rules[0].endpointId, endpoint.id);
  assert.deepEqual(copy.plan.phases, { [endpoint.id]: 'setup' });
});

test('M9 a native new-profile import is stored without being activated', () => {
  const current = config();
  const { native } = parseNative(nativeDocument());
  const outcome = applyNative(current, native, 'new-profile', 'Copy');
  assert.equal(outcome.config.profile.id, current.profile.id, 'the live profile is unchanged');
  assert.equal(outcome.config.savedProfiles.length, 1);
  assert.equal(outcome.stored.profile.name, 'Copy');
  assert.equal(outcome.activated, undefined);
});

test('M9 a native merge adds endpoints to the current profile and skips duplicates', () => {
  const existing = { ...defaultEndpoint('default'), id: 'keep', alias: 'login', name: 'Existing login' };
  const current = config({ endpoints: [existing] });
  const { native } = parseNative(nativeDocument());
  const outcome = applyNative(current, native, 'merge');
  assert.equal(outcome.summary.added, 0);
  assert.equal(outcome.summary.skipped, 1, 'the imported endpoint duplicates the existing one');
  assert.equal(outcome.config.endpoints.length, 1);
  const other = { ...nativeDocument() };
  other.endpoints = [{ ...other.endpoints[0], id: 'e2', alias: 'orders', request: { ...other.endpoints[0].request, path: '/orders' } }];
  other.rules = [{ ...other.rules[0], endpointId: 'e2' }];
  const second = applyNative(current, parseNative(other).native, 'merge');
  assert.equal(second.summary.added, 1);
  assert.equal(second.config.rules.length, 1);
  assert.equal(second.config.rules[0].endpointId, second.config.endpoints[1].id, 'a merged rule points at the merged endpoint');
});

test('M9 a native replace installs the imported snapshot as the live profile', () => {
  const current = config({ endpoints: [defaultEndpoint('default')] });
  const { native } = parseNative(nativeDocument());
  const outcome = applyNative(current, native, 'replace');
  assert.equal(outcome.config.profile.name, 'Imported');
  assert.equal(outcome.config.endpoints.length, 1);
  assert.equal(outcome.summary.replaced, 1);
  assert.ok(outcome.activated);
});

/* ── Conflicts and commit ──────────────────────────────────────────────────── */

const selection = (candidate, overrides = {}) => ({
  key: candidate.key, endpoint: candidate.endpoint, selected: true, resolution: 'keep-both', unresolved: candidate.unresolved.length, ...overrides,
});

test('M9 a conflict is matched on request identity, not on a display name', () => {
  const existing = { ...defaultEndpoint('default'), id: 'e1', alias: 'a', name: 'Completely different name', request: { ...defaultEndpoint('default').request, method: 'GET', path: '/api/items?page=2' } };
  const same = { ...defaultEndpoint('default'), id: 'e2', alias: 'b', name: 'Completely different name', request: { ...defaultEndpoint('default').request, method: 'GET', path: '/api/items' } };
  assert.equal(conflictOf(same, [existing])?.id, 'e1');
  const other = { ...same, request: { ...same.request, method: 'POST' } };
  assert.equal(conflictOf(other, [existing]), undefined, 'a different method is not a duplicate');
});

test('M9 Replace keeps the existing id so linked rules and plan references survive', () => {
  const existing = { ...defaultEndpoint('default'), id: 'e1', alias: 'items', hostKey: 'localhost', request: { ...defaultEndpoint('default').request, path: '/api/items' } };
  const rule = { ...defaultMockRule('default', 1), id: 'r1', label: 'Items mock', endpointId: 'e1' };
  const current = config({ endpoints: [existing], rules: [rule], plan: { ...defaultTestPlan('default'), phases: { e1: 'setup' } } });
  assert.deepEqual(linkedTo(current, 'e1'), { rules: ['Items mock'], plan: true });
  const outcome = parseSource(`curl 'http://localhost/api/items' -H 'x-new: 1'`, 'default');
  const [candidate] = outcome.normalized.candidates;
  const applied = applyCandidates(current, [selection(candidate, { resolution: 'replace' })], outcome.normalized.hosts);
  assert.equal(applied.config.endpoints.length, 1);
  assert.equal(applied.config.endpoints[0].id, 'e1');
  assert.equal(applied.config.endpoints[0].request.headers[0].name, 'x-new');
  assert.equal(applied.summary.replaced, 1);
  assert.equal(linkedTo(applied.config, 'e1').rules.length, 1);
});

test('M9 Keep both adds a second endpoint with a free alias, Skip changes nothing', () => {
  const existing = { ...defaultEndpoint('default'), id: 'e1', alias: 'get_api_items', hostKey: 'localhost', request: { ...defaultEndpoint('default').request, path: '/api/items' } };
  const current = config({ endpoints: [existing] });
  const [candidate] = parseSource(`curl 'http://localhost/api/items'`, 'default').normalized.candidates;
  const kept = applyCandidates(current, [selection(candidate)], {});
  assert.equal(kept.config.endpoints.length, 2);
  assert.equal(kept.config.endpoints[1].alias, 'get_api_items_2');
  const skipped = applyCandidates(current, [selection(candidate, { resolution: 'skip' })], {});
  assert.deepEqual(skipped.config.endpoints, current.endpoints);
  assert.equal(skipped.summary.skipped, 1);
});

test('M9 imported hosts become base URLs without overwriting configured ones', () => {
  const current = config();
  current.profile.environments = { default: { default: '', 'api.pets.test': 'https://staging.pets.test' } };
  const outcome = parseSource(openapi3, 'default');
  const selections = outcome.normalized.candidates.map(candidate => selection(candidate));
  const applied = applyCandidates(current, selections, { ...outcome.normalized.hosts, 'api.other.test': 'https://api.other.test' });
  assert.equal(applied.config.profile.environments.default['api.pets.test'], 'https://staging.pets.test');
  assert.equal(applied.config.profile.environments.default['api.other.test'], 'https://api.other.test');
  assert.deepEqual(applied.summary.hosts, ['api.other.test']);
  assert.match(summaryText(applied.summary), /3 endpoints added, 2 need variables, 1 base URL added\./);
});

test('M9 the same source imported from a file buffer and from a paste yields equal candidates', () => {
  const pasted = parseSource(postman, 'default');
  const loaded = parseSource(new TextDecoder().decode(new TextEncoder().encode(postman)), 'default');
  assert.deepEqual(
    pasted.normalized.candidates.map(item => ({ ...item, endpoint: { ...item.endpoint, id: '', createdAt: 0, updatedAt: 0 } })),
    loaded.normalized.candidates.map(item => ({ ...item, endpoint: { ...item.endpoint, id: '', createdAt: 0, updatedAt: 0 } })),
  );
});
