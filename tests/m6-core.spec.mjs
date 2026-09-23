import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { applyPatch, parsePointer, pointers } from '../src/network/patch.ts';
import { applyTransform, compileTransform, textLike } from '../src/network/transform.ts';
import { createRuleEngine, createRequestContext, routeTarget, validateRewrite } from '../src/network/rules.ts';
import { defaultInterceptRule, defaultMockRule, defaultMockSlot, defaultTransform, defaultRouteRule } from '../src/core/model.ts';

const context = (overrides = {}) =>
  createRequestContext({ kind: 'fetch', method: 'GET', url: 'https://example.test/api/items', ...overrides });

const matcher = (url = '/api/**', overrides = {}) => ({ method: '*', url, query: '', headers: '', bodyContains: '', ...overrides });

const route = (overrides = {}) => ({
  ...defaultRouteRule('p', 1), enabled: true, matcher: matcher(), destinationOrigin: 'https://qa.example.test', ...overrides,
});

const intercept = (overrides = {}) => ({ ...defaultInterceptRule('p', 1), enabled: true, matcher: matcher(), ...overrides });

test('M6 JSON Pointer: escaping, arrays and blocked prototype segments', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  assert.deepEqual(parsePointer('/items/0/name'), ['items', '0', 'name']);
  assert.ok('error' in parsePointer('items/0'));
  assert.ok('error' in parsePointer('/__proto__/polluted'));
  assert.ok('error' in parsePointer('/a/constructor/b'));

  // The pointer list feeds the editor's path suggestions.
  assert.deepEqual(pointers({ a: [1], 'b/c': 2 }), ['/a', '/a/0', '/b~1c']);
});

test('M6 JSON Patch: all six operations, and a failure commits nothing', () => {
  const document = { name: 'first', items: [{ id: 1 }, { id: 2 }], keep: true };

  const replaced = applyPatch(document, [{ op: 'replace', path: '/name', value: 'second' }]);
  assert.equal(replaced.ok && replaced.value.name, 'second');
  // The original is untouched: every operation runs on an isolated clone.
  assert.equal(document.name, 'first');

  const added = applyPatch(document, [{ op: 'add', path: '/items/-', value: { id: 3 } }]);
  assert.equal(added.ok && added.value.items.length, 3);
  assert.equal(document.items.length, 2);

  const removed = applyPatch(document, [{ op: 'remove', path: '/items/0' }]);
  assert.equal(removed.ok && removed.value.items[0].id, 2);

  const moved = applyPatch(document, [{ op: 'move', from: '/name', path: '/label' }]);
  assert.equal(moved.ok && moved.value.label, 'first');
  assert.equal(moved.ok && 'name' in moved.value, false);

  const copied = applyPatch(document, [{ op: 'copy', from: '/name', path: '/label' }]);
  assert.equal(copied.ok && copied.value.name, 'first');
  assert.equal(copied.ok && copied.value.label, 'first');

  assert.equal(applyPatch(document, [{ op: 'test', path: '/keep', value: true }]).ok, true);
  assert.equal(applyPatch(document, [{ op: 'test', path: '/keep', value: false }]).ok, false);

  // Nullify is `replace` with null, not a separate operation.
  const nullified = applyPatch(document, [{ op: 'replace', path: '/name', value: null }]);
  assert.equal(nullified.ok && nullified.value.name, null);

  // A later failure discards every earlier operation in the same patch.
  const partial = applyPatch(document, [
    { op: 'replace', path: '/name', value: 'changed' },
    { op: 'replace', path: '/missing/deep', value: 1 },
  ]);
  assert.equal(partial.ok, false);
  assert.match(partial.error, /missing/);

  // Prototype pollution is refused rather than applied.
  const polluted = applyPatch({}, [{ op: 'add', path: '/__proto__/owned', value: true }]);
  assert.equal(polluted.ok, false);
  assert.equal({}.owned, undefined);
});

test('M6 transform: header edits, status range, body replace and skipped reasons', () => {
  const compiled = compileTransform({
    ...defaultTransform(),
    setHeaders: 'X-Env: qa\nContent-Type: application/json',
    removeHeaders: 'x-trace\nx-absent',
    status: 418,
    body: { find: 'a', replace: 'b', scope: 'all' },
  });
  const outcome = applyTransform(compiled, {
    headers: { 'x-trace': '1', 'content-length': '9' },
    body: 'a-a-a',
    status: 200,
  }, 'response');
  assert.equal(outcome.status, 418);
  assert.equal(outcome.headers['x-env'], 'qa');
  assert.equal('x-trace' in outcome.headers, false);
  assert.equal(outcome.body, 'b-b-b');
  // A rewritten payload drops metadata that no longer describes it.
  assert.equal('content-length' in outcome.headers, false);
  assert.ok(outcome.skipped.some(reason => reason.includes('x-absent')));

  // A forbidden request header is reported, never shown as an applied edit.
  const request = applyTransform(
    compileTransform({ ...defaultTransform(), setHeaders: 'Host: elsewhere.test\nX-Ok: 1' }),
    { headers: {} },
    'request',
  );
  assert.equal('host' in request.headers, false);
  assert.equal(request.headers['x-ok'], '1');
  assert.ok(request.skipped.some(reason => reason.includes('host')));

  // An out-of-range status override is refused with a reason.
  const bad = applyTransform(compileTransform({ ...defaultTransform(), status: 99 }), { headers: {}, status: 200 }, 'response');
  assert.equal(bad.status, 200);
  assert.ok(bad.skipped.some(reason => reason.includes('200–599')));

  // An unavailable or non-JSON body is a skipped transform, not a claimed edit.
  const patch = compileTransform({ ...defaultTransform(), patch: [{ op: 'replace', path: '/a', value: 1 }] });
  assert.ok(applyTransform(patch, { headers: {} }, 'response').skipped[0].includes('no supported text body'));
  assert.ok(applyTransform(patch, { headers: {}, body: '<html>' }, 'response').skipped[0].includes('not valid JSON'));
  assert.equal(applyTransform(patch, { headers: {}, body: '{"a":0}' }, 'response').body, '{"a":1}');

  assert.equal(textLike('application/json; charset=utf-8'), true);
  assert.equal(textLike('image/png'), false);
});

test('M6 route rewrite grammar: trailing capture, exact path and rejected combinations', () => {
  const rule = route({ pathRewrite: '/sandbox/**' });
  const target = routeTarget(rule, 'https://example.test/api/users/42?active=1');
  assert.equal(target.to, 'https://qa.example.test/sandbox/users/42?active=1');
  assert.equal(target.crossOrigin, true);
  assert.deepEqual(target.stripped, ['authorization']);

  // Authorization survives only when the destination is explicitly trusted with it.
  assert.deepEqual(routeTarget(route({ pathRewrite: '/sandbox/**', keepAuthorization: true }), 'https://example.test/api/x').stripped, []);

  // An exact replacement path ignores the captured tail.
  assert.equal(routeTarget(route({ pathRewrite: '/fixed' }), 'https://example.test/api/a/b?q=1').to, 'https://qa.example.test/fixed?q=1');

  // Blank rewrite: preserve, or route to the destination root.
  assert.equal(routeTarget(route({ pathRewrite: '' }), 'https://example.test/api/a').to, 'https://qa.example.test/api/a');
  assert.equal(routeTarget(route({ pathRewrite: '', preservePath: false }), 'https://example.test/api/a').to, 'https://qa.example.test/');

  // Unsupported combinations are rejected rather than guessed.
  assert.ok(validateRewrite('/api/*', '/sandbox/**'));
  assert.ok(validateRewrite('/api/**', '/a/**/b'));
  assert.ok(validateRewrite('/api/**', 'sandbox'));
  assert.equal(validateRewrite('/api/**', '/sandbox/**'), undefined);
  assert.equal(validateRewrite('/api/*/v/**', '/s/**'), undefined);

  assert.match(routeTarget(route({ destinationOrigin: 'ftp://qa.example.test' }), 'https://example.test/api/a').error, /http or https/);
  assert.match(routeTarget(route({ destinationOrigin: 'not a url' }), 'https://example.test/api/a').error, /not a URL/);
});

test('M6 pipeline order: a route never applies without a dispatch, and a mock response is still transformed', () => {
  const engine = createRuleEngine();
  engine.setActive('intercept', true);
  engine.setActive('route', true);
  const transforming = intercept({
    response: { ...defaultTransform(), status: 201, setHeaders: 'X-Edited: yes' },
    request: { ...defaultTransform(), setHeaders: 'X-Sent: yes' },
  });
  engine.setRules([transforming, route()]);

  // Stage 5: no dispatch, so no route; stage 6 still edits the synthetic response.
  engine.setActive('mock', true);
  const mock = { ...defaultMockRule('p', 2), enabled: true, matcher: matcher(), slots: [{ ...defaultMockSlot(), body: '{"ok":true}' }] };
  engine.setRules([transforming, route(), mock]);
  const mocked = engine.plan(context());
  assert.equal(mocked.provider, 'mock');
  assert.equal(mocked.route, undefined);
  assert.equal(mocked.synthetic.status, 201);
  assert.equal(mocked.synthetic.headers['x-edited'], 'yes');
  assert.ok(mocked.why.some(line => line.includes('no network dispatch')));
  assert.ok(mocked.why.some(line => line.includes('request transform not applied')));

  // With no mock the same request routes and carries both transforms to the adapters.
  engine.setActive('mock', false);
  const dispatched = engine.plan(context());
  assert.equal(dispatched.provider, 'network');
  assert.equal(dispatched.route.to, 'https://qa.example.test/api/items');
  assert.equal(dispatched.intercept.requestWork, true);
  assert.equal(dispatched.intercept.responseWork, true);

  // An inactive module selects nothing, whatever its rules say.
  engine.setActive('intercept', false);
  engine.setActive('route', false);
  const plain = engine.plan(context());
  assert.equal(plain.intercept, undefined);
  assert.equal(plain.route, undefined);
});

test('M6 selection: one rule per module, by priority then creation sequence', () => {
  const engine = createRuleEngine();
  engine.setActive('intercept', true);
  const low = intercept({ id: 'a', priority: 1, seq: 1, response: { ...defaultTransform(), status: 201 } });
  const high = intercept({ id: 'b', priority: 9, seq: 2, response: { ...defaultTransform(), status: 202 } });
  engine.setRules([low, high]);
  assert.equal(engine.plan(context()).intercept.ruleId, 'b');

  // A route whose match origin names another host is not selected.
  engine.setActive('route', true);
  engine.setRules([route({ matchOrigin: 'https://other.test' })]);
  assert.equal(engine.plan(context()).route, undefined);
  engine.setRules([route({ matchOrigin: 'https://example.test' })]);
  assert.equal(engine.plan(context()).route.to, 'https://qa.example.test/api/items');
});
