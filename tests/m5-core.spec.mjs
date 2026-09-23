import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRuleEngine, createRequestContext, matchRequest } from '../src/network/rules.ts';
import { defaultChaosRule, defaultMockRule, defaultMockSlot } from '../src/core/model.ts';

const context = (overrides = {}) =>
  createRequestContext({ kind: 'fetch', method: 'GET', url: 'https://example.test/api/items', ...overrides });

function mock(overrides = {}) {
  return { ...defaultMockRule('p', 1), enabled: true, matcher: { method: 'GET', url: '/api/items', query: '', headers: '', bodyContains: '' }, ...overrides };
}

function chaos(overrides = {}) {
  return { ...defaultChaosRule('p', 1), enabled: true, matcher: { method: 'GET', url: '/api/items', query: '', headers: '', bodyContains: '' }, ...overrides };
}

test('M5 matcher: globs, query, headers and an unavailable body', () => {
  const matcher = { method: 'GET', url: '/api/**', query: '', headers: '', bodyContains: '' };
  assert.equal(matchRequest(matcher, context({ url: 'https://example.test/api/a/b/c' })).matched, true);
  assert.equal(matchRequest({ ...matcher, url: '/api/*' }, context({ url: 'https://example.test/api/a/b' })).matched, false);
  assert.equal(matchRequest(matcher, context({ method: 'POST' })).matched, false);

  // A rule URL that still carries a captured request id matches on its pathname.
  const captured = { ...matcher, url: '/api/items?RequestID=361b-34f1' };
  assert.equal(matchRequest(captured, context({ url: 'https://example.test/api/items?RequestID=other' })).matched, true);

  const query = { ...matcher, query: 'action=list' };
  assert.equal(matchRequest(query, context({ url: 'https://example.test/api/items?action=list&x=1' })).matched, true);
  assert.equal(matchRequest(query, context({ url: 'https://example.test/api/items?action=create' })).matched, false);

  const headers = { ...matcher, headers: 'accept=application/json' };
  assert.equal(matchRequest(headers, context({ headers: { Accept: 'application/json' } })).matched, true);
  assert.equal(matchRequest(headers, context()).matched, false);

  // An absolute pattern pins the origin.
  const absolute = { ...matcher, url: 'https://other.test/api/**' };
  assert.equal(matchRequest(absolute, context()).matched, false);

  // A body condition on an unavailable body is reported, never claimed as a match.
  const body = { ...matcher, bodyContains: 'needle' };
  const result = matchRequest(body, context());
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'body condition not evaluated');
  assert.equal(matchRequest(body, context({ body: 'a needle here' })).matched, true);
});

test('M5 precedence: priority, then creation sequence, then id', () => {
  const engine = createRuleEngine();
  engine.setActive('mock', true);
  const low = mock({ id: 'a', priority: 1, seq: 1, slots: [{ ...defaultMockSlot(), status: 201 }] });
  const high = mock({ id: 'b', priority: 9, seq: 2, slots: [{ ...defaultMockSlot(), status: 202 }] });
  engine.setRules([low, high]);
  assert.equal(engine.plan(context()).synthetic.status, 202);

  const first = mock({ id: 'c', priority: 5, seq: 1, slots: [{ ...defaultMockSlot(), status: 203 }] });
  const second = mock({ id: 'd', priority: 5, seq: 2, slots: [{ ...defaultMockSlot(), status: 204 }] });
  engine.setRules([second, first]);
  assert.equal(engine.plan(context()).synthetic.status, 203);

  // A disabled rule is never selected, whatever its priority.
  engine.setRules([mock({ id: 'e', priority: 99, enabled: false }), first]);
  assert.equal(engine.plan(context()).mockRuleId, 'c');
});

test('M5 sequence slots are reserved in arrival order and exhaustion never falls back to the network', () => {
  const engine = createRuleEngine();
  engine.setActive('mock', true);
  const slots = [200, 503, 418].map(status => ({ ...defaultMockSlot(), status }));
  const rule = mock({ id: 'seq', mode: 'sequence', slots, exhaustion: 'repeat-last' });
  engine.setRules([rule]);

  // Reservation is synchronous, so three back-to-back plans take three distinct slots.
  assert.deepEqual([0, 1, 2].map(() => engine.plan(context()).synthetic.status), [200, 503, 418]);
  assert.equal(engine.plan(context()).synthetic.status, 418, 'repeat-last repeats the final slot');
  assert.equal(engine.plan(context()).provider, 'mock', 'exhaustion stays synthetic');

  engine.resetCursor('seq');
  assert.equal(engine.plan(context()).synthetic.status, 200);

  engine.setRules([{ ...rule, exhaustion: 'loop' }]);
  engine.resetCursor('seq');
  assert.deepEqual([0, 1, 2, 3].map(() => engine.plan(context()).synthetic.status), [200, 503, 418, 200]);

  engine.setRules([{ ...rule, exhaustion: 'network-error' }]);
  engine.resetCursor('seq');
  [0, 1, 2].forEach(() => engine.plan(context()));
  const exhausted = engine.plan(context());
  assert.equal(exhausted.provider, 'mock');
  assert.equal(exhausted.syntheticFailure, 'network-error');
  assert.equal(exhausted.synthetic, undefined);
});

test('M5 a revision change and a fresh activation reset the cursor; other edits do not', () => {
  const engine = createRuleEngine();
  engine.setActive('mock', true);
  const rule = mock({ id: 'seq', mode: 'sequence', slots: [200, 503].map(status => ({ ...defaultMockSlot(), status })) });
  engine.setRules([rule]);
  assert.equal(engine.plan(context()).synthetic.status, 200);

  engine.setRules([{ ...rule }]);
  assert.equal(engine.plan(context()).synthetic.status, 503, 'same revision keeps the cursor');

  engine.setRules([{ ...rule, revision: 2 }]);
  assert.equal(engine.plan(context()).synthetic.status, 200, 'an edited rule restarts its sequence');

  engine.setActive('mock', false);
  engine.setActive('mock', true);
  assert.equal(engine.plan(context()).synthetic.status, 200, 'a fresh activation restarts it too');
});

test('M5 probability is sampled once, is seed-repeatable, and honours a hit budget', () => {
  const never = createRuleEngine();
  never.setActive('chaos', true);
  never.setRules([chaos({ id: 'n', probability: 0, seed: 'x' })]);
  const skipped = never.plan(context());
  assert.equal(skipped.provider, 'network');
  assert.equal(skipped.chaosRuleId, undefined);
  assert.match(skipped.why.join(' '), /skip/);

  // A failed sample means no chaos on this request: a lower-priority rule is not retried.
  never.setRules([
    chaos({ id: 'high', priority: 10, probability: 0, seed: 'x' }),
    chaos({ id: 'low', priority: 1, probability: 100 }),
  ]);
  assert.equal(never.plan(context()).provider, 'network');

  const run = () => {
    const engine = createRuleEngine();
    engine.setActive('chaos', true);
    engine.setRules([chaos({ id: 'seeded', probability: 50, seed: 'fixed-seed' })]);
    return [0, 0, 0, 0, 0, 0].map(() => engine.plan(context()).provider);
  };
  assert.deepEqual(run(), run(), 'the same seed repeats the same ordered sample stream');
  assert.ok(new Set(run()).size > 1, 'a 50% rule is neither always on nor always off');

  const budgeted = createRuleEngine();
  budgeted.setActive('chaos', true);
  budgeted.setRules([chaos({ id: 'b', probability: 100, budget: 2 })]);
  assert.deepEqual(
    [0, 0, 0, 0].map(() => budgeted.plan(context()).provider),
    ['synthetic-chaos', 'synthetic-chaos', 'network', 'network'],
  );
});

test('M5 composition: synthetic chaos supersedes a mock, real chaos does not touch one', () => {
  const engine = createRuleEngine();
  engine.setActive('mock', true);
  engine.setActive('chaos', true);
  const mockRule = mock({ id: 'm', slots: [{ ...defaultMockSlot(), status: 200 }] });

  engine.setRules([mockRule, chaos({ id: 'c', mode: 'synthetic', fault: { kind: 'status', status: 503, body: '' } })]);
  const superseded = engine.plan(context());
  assert.equal(superseded.provider, 'synthetic-chaos');
  assert.equal(superseded.synthetic.status, 503);
  assert.match(superseded.why.join(' '), /supersedes/);

  engine.setRules([mockRule, chaos({ id: 'c', mode: 'real', fault: { kind: 'latency', delayMs: 500 } })]);
  const mocked = engine.plan(context());
  assert.equal(mocked.provider, 'mock');
  assert.equal(mocked.real, undefined);
  assert.match(mocked.why.join(' '), /does not apply to a mocked response/);

  // Replay has no synthetic form, so a synthetic replay rule applies no fault at all.
  engine.setRules([chaos({ id: 'r', mode: 'synthetic', fault: { kind: 'replay', copies: 2, gapMs: 0 } })]);
  const replay = engine.plan(context());
  assert.equal(replay.provider, 'network');
  assert.equal(replay.real, undefined);

  // Real replay is bounded to the documented v1 maximum even if configuration asks for more.
  engine.setRules([chaos({ id: 'r', mode: 'real', fault: { kind: 'replay', copies: 9, gapMs: 10 } })]);
  assert.equal(engine.plan(context()).real.replay.copies, 2);
});

test('M5 hit counts follow applied rules only', () => {
  const engine = createRuleEngine();
  engine.setActive('mock', true);
  engine.setRules([mock({ id: 'm' })]);
  engine.plan(context());
  engine.plan(context({ url: 'https://example.test/api/other' }));
  assert.equal(engine.hits('m'), 1);
});

test('M5 an inactive module applies nothing', () => {
  const engine = createRuleEngine();
  engine.setRules([mock({ id: 'm' }), chaos({ id: 'c' })]);
  const plan = engine.plan(context());
  assert.equal(plan.provider, 'network');
  assert.equal(engine.hits('m'), 0);
});
