import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { defaultEndpoint, defaultProfile, defaultTestPlan } from '../src/core/model.ts';
import {
  createScope, prepare, renderTemplate, renderJsonBody, resolveExpression, evalRestricted,
  referencedAliases, escapeFor,
} from '../src/tester/expressions.ts';
import { preflight, dependenciesOf } from '../src/tester/plan.ts';
import { startRun } from '../src/tester/run.ts';
import { percentile, statsOf, csvCell, runToCsv, runToJson } from '../src/tester/results.ts';

const profile = () => {
  const base = defaultProfile();
  base.environments = { default: { default: 'https://example.test' } };
  return base;
};

const endpoint = (alias, overrides = {}) => {
  const base = defaultEndpoint('default');
  base.id = `endpoint-${alias}`;
  base.alias = alias;
  base.name = alias;
  base.request.path = `/api/${alias}`;
  base.checks = [];
  return { ...base, ...overrides, request: { ...base.request, ...(overrides.request ?? {}) } };
};

const plan = (overrides = {}) => ({ ...defaultTestPlan('default'), ...overrides });

/* ── Built-ins and reservations ────────────────────────────────────────────── */

test('M8 a generated value is reserved once per prepared request and reused inside it', () => {
  const run = createScope();
  const request = prepare(run, {});
  const first = renderTemplate('{{$uuid}}|{{$uuid}}', 'text', request);
  const [left, right] = first.value.split('|');
  assert.match(left, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(left, right, 'the same expression twice is one reservation');
  const second = renderTemplate('{{$uuid}}', 'text', prepare(run, {}));
  assert.notEqual(second.value, left, 'a new prepared request gets a new reservation');
});

test('M8 counters are run-scoped, reserved in scheduler order, stable within one request', () => {
  const run = createScope();
  const a = renderTemplate('{{$counter("order", 10, 5)}}-{{$counter("order", 10, 5)}}', 'text', prepare(run, {}));
  assert.equal(a.value, '10-10');
  const b = renderTemplate('{{$counter("order", 10, 5)}}', 'text', prepare(run, {}));
  assert.equal(b.value, '15');
  // A separate session scope (a manual send) never consumes the run's reservations.
  const session = createScope();
  assert.equal(renderTemplate('{{$counter("order", 10, 5)}}', 'text', prepare(session, {})).value, '10');
});

test('M8 $randomInt validates bounds and stays inside them', () => {
  const scope = createScope({ random: () => 0.999999 });
  assert.equal(resolveExpression('$randomInt(1, 100)', prepare(scope, {})).value, 100);
  assert.equal(resolveExpression('$randomInt(1, 1.5)', prepare(scope, {})).error, '$randomInt bounds must be safe integers');
  assert.equal(resolveExpression('$randomInt(9, 2)', prepare(scope, {})).error, '$randomInt maximum is below its minimum');
});

test('M8 references read a bounded path and never traverse the prototype', () => {
  const scope = createScope({ refs: { create_user: { data: { items: [{ id: 42 }] } } } });
  assert.equal(renderTemplate('{{create_user.data.items.0.id}}', 'text', scope).value, '42');
  assert.equal(renderTemplate('{{create_user.data.items[0].id}}', 'text', scope).value, '42');
  assert.match(renderTemplate('{{create_user.__proto__.x}}', 'text', scope).error, /has no value at "__proto__"/);
  assert.match(renderTemplate('{{create_user.missing}}', 'text', scope).error, /has no value at "missing"/);
  assert.match(renderTemplate('{{nobody.id}}', 'text', scope).error, /No value for \{\{nobody\}\} yet/);
});

test('M8 values are escaped for where they land', () => {
  const scope = createScope({ refs: { v: 'a b&c/d' } });
  assert.equal(renderTemplate('/api/{{v}}', 'url', scope).value, '/api/a%20b%26c%2Fd');
  assert.equal(escapeFor('header', 'line\r\nInjected: yes'), 'line Injected: yes');
  assert.equal(renderTemplate('{"k":"{{v}}"}', 'json', createScope({ refs: { v: 'say "hi"\n' } })).value, '{"k":"say \\"hi\\"\\n"}');
});

test('M8 an expression that is a whole JSON value keeps the producer value type', () => {
  const scope = createScope({ refs: { u: { id: 7, tags: ['a'], ok: true } } });
  const body = renderJsonBody('{"id":"{{u.id}}","tags":"{{u.tags}}","ok":"{{u.ok}}","text":"id {{u.id}}"}', scope);
  assert.deepEqual(JSON.parse(body.value), { id: 7, tags: ['a'], ok: true, text: 'id 7' });
});

/* ── The restricted $eval parser ───────────────────────────────────────────── */

test('M8 $eval evaluates literals, arithmetic, comparison and bounded paths', () => {
  const scope = createScope({ refs: { order: { total: 40, currency: 'EUR' } } });
  assert.equal(evalRestricted('order.total * 2 + 1', scope).value, 81);
  assert.equal(evalRestricted('order.total > 30 && order.currency == "EUR"', scope).value, true);
  assert.equal(evalRestricted('order.total > 100 ? "big" : "small"', scope).value, 'small');
  assert.equal(renderTemplate('{{$eval("order.total / 4")}}', 'text', scope).value, '10');
});

test('M8 $eval rejects statements, calls, globals and unknown names', () => {
  const scope = createScope({ refs: { order: { total: 1 } } });
  for (const source of [
    'window.location',
    'document.cookie',
    'fetch("/x")',
    'order.total = 5',
    'order.__proto__.x',
    'order.constructor',
    '(() => 1)()',
    'let x = 1; x',
    'alert(1)',
  ]) {
    const result = evalRestricted(source, scope);
    assert.ok(result.error, `"${source}" must be rejected, got ${JSON.stringify(result.value)}`);
  }
});

/* ── Dependency graph and preflight ────────────────────────────────────────── */

test('M8 dependencies come from the URL, headers and body, and self-reference is not one', () => {
  const step = endpoint('post_order', {
    request: {
      method: 'POST', path: '/api/orders/{{create_user.id}}',
      headers: [{ name: 'X-Token', value: '{{login.token}}' }],
      bodyKind: 'json', body: '{"me":"{{post_order.id}}","uuid":"{{$uuid}}"}', credentials: 'same-origin',
    },
  });
  assert.deepEqual(dependenciesOf(step).sort(), ['create_user', 'login']);
  assert.deepEqual(referencedAliases('{{$uuid}} {{$counter("a",1,1)}}'), []);
});

test('M8 preflight rejects cycles, missing producers and cross-phase dependencies', () => {
  const login = endpoint('login');
  const user = endpoint('create_user', { request: { path: '/api/users/{{login.id}}' } });
  const cycleA = endpoint('a', { request: { path: '/api/a/{{b.id}}' } });
  const cycleB = endpoint('b', { request: { path: '/api/b/{{a.id}}' } });

  const missing = preflight(plan(), [user], profile());
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0], /no selected endpoint has the alias "login"/);

  const cycle = preflight(plan(), [cycleA, cycleB], profile());
  assert.ok(cycle.errors.some(error => /cycle/.test(error)));

  // A setup step may not read a load-phase result.
  const backwards = preflight(plan({ phases: { [user.id]: 'setup' } }), [login, user], profile());
  assert.ok(backwards.errors.some(error => /Setup cannot depend on a load-phase result/.test(error)));

  const ordered = preflight(plan({ phases: { [login.id]: 'setup' } }), [login, user], profile());
  assert.deepEqual(ordered.errors, []);
  assert.deepEqual(ordered.setup.map(step => step.endpoint.alias), ['login']);
  assert.deepEqual(ordered.load.map(step => step.endpoint.alias), ['create_user']);
});

test('M8 an Independent plan cannot resolve one load endpoint from another', () => {
  const login = endpoint('login');
  const user = endpoint('create_user', { request: { path: '/api/users/{{login.id}}' } });
  const invalid = preflight(plan({ strategy: 'independent' }), [login, user], profile());
  assert.equal(invalid.errors.length, 1);
  assert.match(invalid.errors[0], /Switch to Flow, or promote "login" to setup/);
  const promoted = preflight(plan({ strategy: 'independent', phases: { [login.id]: 'setup' } }), [login, user], profile());
  assert.deepEqual(promoted.errors, []);
});

test('M8 preflight counts the planned requests and names the destinations and mutating steps', () => {
  const login = endpoint('login');
  const write = endpoint('post_order', { request: { method: 'POST', path: 'https://other.test/api/orders' } });
  const check = preflight(plan({ phases: { [login.id]: 'setup' }, iterations: 10 }), [login, write], profile());
  assert.equal(check.requestCount, 1 + 1 * 10);
  assert.deepEqual(check.origins.sort(), ['https://example.test', 'https://other.test']);
  assert.deepEqual(check.mutating, ['post_order']);
});

/* ── Running ───────────────────────────────────────────────────────────────── */

const jsonResponse = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function recordingFetcher(handler) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body, at: performance.now() });
    return handler(String(url), init, calls.length);
  };
  return { calls, fetcher };
}

test('M8 Flow runs setup once, then each iteration in dependency order over its own context', async () => {
  const login = endpoint('login');
  const order = endpoint('order', {
    request: {
      method: 'POST', path: '/api/orders', bodyKind: 'json',
      body: '{"token":"{{login.token}}","n":"{{$counter("n", 1, 1)}}"}', credentials: 'same-origin',
    },
  });
  const { calls, fetcher } = recordingFetcher(url => jsonResponse(url.endsWith('/api/login') ? { token: 'T1' } : { ok: true }));
  const run = await startRun({
    plan: plan({ phases: { [login.id]: 'setup' }, iterations: 3 }),
    profile: profile(), endpoints: [login, order], fetcher, signal: new AbortController().signal,
  });
  assert.equal(run.state, 'completed');
  assert.equal(calls.filter(call => call.url.endsWith('/api/login')).length, 1, 'setup runs once for the run');
  const orders = calls.filter(call => call.url.endsWith('/api/orders'));
  assert.equal(orders.length, 3);
  assert.deepEqual(orders.map(call => JSON.parse(call.body).n), [1, 2, 3]);
  assert.equal(orders.every(call => JSON.parse(call.body).token === 'T1'), true, 'setup output is shared read-only');
  assert.equal(run.counts.passed, 4);
  assert.equal(run.completed, run.planned);
});

test('M8 one iteration never sees another iteration variables', async () => {
  const create = endpoint('create', { request: { method: 'POST', path: '/api/create' } });
  const read = endpoint('read', { request: { path: '/api/read/{{create.id}}' } });
  let issued = 0;
  const { calls, fetcher } = recordingFetcher(url => (url.endsWith('/api/create') ? jsonResponse({ id: ++issued }) : jsonResponse({ ok: true })));
  await startRun({
    plan: plan({ iterations: 3, concurrency: 3 }), profile: profile(), endpoints: [create, read],
    fetcher, signal: new AbortController().signal,
  });
  const reads = calls.filter(call => call.url.includes('/api/read/')).map(call => call.url.split('/').pop());
  assert.deepEqual([...reads].sort(), ['1', '2', '3'], 'each iteration read only the id its own create produced');
});

test('M8 a failed producer skips its dependents with a reason and keeps unrelated steps running', async () => {
  const create = endpoint('create', { request: { method: 'POST', path: '/api/create' } });
  const read = endpoint('read', { request: { path: '/api/read/{{create.id}}' } });
  const other = endpoint('other');
  const { calls, fetcher } = recordingFetcher(url => {
    if (url.endsWith('/api/create')) throw Object.assign(new Error('offline'), { name: 'TypeError' });
    return jsonResponse({ ok: true });
  });
  const run = await startRun({
    plan: plan(), profile: profile(), endpoints: [create, read, other], fetcher, signal: new AbortController().signal,
  });
  assert.equal(run.counts['network-error'], 1);
  assert.equal(run.counts['skipped-dependency'], 1);
  assert.equal(run.counts.passed, 1, 'the unrelated step still ran');
  assert.equal(calls.some(call => call.url.includes('/api/read/')), false, 'no request is dispatched for a skipped step');
  const skipped = run.recent.find(entry => entry.outcome === 'skipped-dependency');
  assert.match(skipped.error, /create did not produce a result/);
});

test('M8 setup failure blocks the load phase', async () => {
  const login = endpoint('login', { checks: [{ kind: 'status', value: 200 }] });
  const order = endpoint('order');
  const { calls, fetcher } = recordingFetcher(url =>
    url.endsWith('/api/login') ? new Response('no', { status: 500 }) : jsonResponse({ ok: true }));
  const run = await startRun({
    plan: plan({ phases: { [login.id]: 'setup' }, iterations: 5 }), profile: profile(),
    endpoints: [login, order], fetcher, signal: new AbortController().signal,
  });
  assert.equal(run.state, 'setup-failed');
  assert.equal(calls.length, 1);
  assert.ok(run.errors.some(error => /Setup did not complete/.test(error)));
});

test('M8 Independent gives every endpoint its own queue under one global concurrency limit', async () => {
  const a = endpoint('a');
  const b = endpoint('b');
  let live = 0;
  let peak = 0;
  const fetcher = async url => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise(resolve => setTimeout(resolve, 5));
    live -= 1;
    return jsonResponse({ url });
  };
  const run = await startRun({
    plan: plan({ strategy: 'independent', iterations: 4, concurrency: 2 }), profile: profile(),
    endpoints: [a, b], fetcher, signal: new AbortController().signal,
  });
  assert.equal(run.planned, 8);
  assert.equal(run.completed, 8);
  assert.equal(run.progressTotal, 8);
  assert.ok(peak <= 2, `global concurrency was ${peak}, expected at most 2`);
  for (const stats of run.endpoints) assert.equal(stats.counts.passed, 4);
});

test('M8 Flow concurrency limits simultaneous iterations, not requests inside one', async () => {
  const first = endpoint('first');
  const second = endpoint('second');
  let live = 0;
  let peak = 0;
  const fetcher = async () => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise(resolve => setTimeout(resolve, 5));
    live -= 1;
    return jsonResponse({ ok: true });
  };
  await startRun({
    plan: plan({ iterations: 4, concurrency: 2 }), profile: profile(), endpoints: [first, second],
    fetcher, signal: new AbortController().signal,
  });
  assert.ok(peak <= 2, `two iteration workers dispatched ${peak} requests at once`);
});

test('M8 Stop aborts owned requests and schedules nothing more', async () => {
  const slow = endpoint('slow');
  const controller = new AbortController();
  let started = 0;
  const fetcher = (url, init) =>
    new Promise((resolve, reject) => {
      started += 1;
      const timer = setTimeout(() => resolve(jsonResponse({ ok: true })), 1000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  const running = startRun({
    plan: plan({ iterations: 20, concurrency: 1 }), profile: profile(), endpoints: [slow],
    fetcher, signal: controller.signal,
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  controller.abort();
  const run = await running;
  assert.equal(run.state, 'stopped');
  assert.equal(run.counts.aborted, 1);
  assert.equal(started, 1, 'no further iteration was scheduled after Stop');
});

test('M8 ramp-up admits one worker at a time instead of all at once', async () => {
  const step = endpoint('step');
  const controller = new AbortController();
  let inFlight = 0;
  // Every request hangs until the run is stopped, so in-flight count is exactly the admitted workers.
  const fetcher = (_url, init) =>
    new Promise((_resolve, reject) => {
      inFlight += 1;
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' })));
    });
  const running = startRun({
    plan: plan({ iterations: 3, concurrency: 3, rampUp: true }), profile: profile(), endpoints: [step],
    fetcher, signal: controller.signal,
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  await sleep(120);
  assert.equal(inFlight, 1, 'only the first worker is admitted immediately');
  await sleep(250);
  assert.equal(inFlight, 2, 'the second worker is admitted one ramp step later');
  await sleep(250);
  assert.equal(inFlight, 3);
  controller.abort();
  const run = await running;
  assert.equal(run.counts.aborted, 3);
});

test('M8 a plan that fails preflight dispatches nothing', async () => {
  const orphan = endpoint('orphan', { request: { path: '/api/x/{{nobody.id}}' } });
  let calls = 0;
  const run = await startRun({
    plan: plan(), profile: profile(), endpoints: [orphan],
    fetcher: async () => { calls += 1; return jsonResponse({}); },
    signal: new AbortController().signal,
  });
  assert.equal(run.state, 'preflight-failed');
  assert.equal(calls, 0);
  assert.equal(run.errors.length, 1);
});

/* ── Statistics and export ─────────────────────────────────────────────────── */

test('M8 P95 uses nearest rank and averages come from the samples', () => {
  const samples = Array.from({ length: 20 }, (_unused, index) => index + 1);
  assert.equal(percentile(samples, 0.95), 19, 'ceil(0.95 × 20) − 1 = index 18, the value 19');
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([], 0.95), undefined);
  const stats = statsOf([10, 20, 30]);
  assert.deepEqual([stats.avgMs, stats.minMs, stats.maxMs, stats.count], [20, 10, 30, 3]);
  // A statistic with no samples is omitted, never reported as zero.
  assert.equal(statsOf([], 4).avgMs, undefined);
  assert.equal(statsOf([], 4).truncated, true);
});

test('M8 CSV export escapes and neutralises spreadsheet formulas', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(undefined), '');
});

test('M8 exports carry the schema version, configuration revision and timing definitions', async () => {
  const step = endpoint('step');
  const run = await startRun({
    plan: plan({ iterations: 2 }), profile: profile(), endpoints: [step],
    fetcher: async () => jsonResponse({ ok: true }), signal: new AbortController().signal,
  });
  const exported = JSON.parse(runToJson(run, 7));
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.configurationRevision, 7);
  assert.equal(exported.run.plannedRequests, 2);
  assert.equal(exported.outcomes.passed, 2);
  assert.match(exported.definitions.p95, /nearest rank/i);
  const csv = runToCsv(run);
  const [header, row] = csv.split('\r\n');
  assert.equal(header.split(',')[0], 'endpoint');
  assert.equal(row.split(',')[1], 'step');
});
