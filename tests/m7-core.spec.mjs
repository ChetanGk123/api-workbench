import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { createBreakpoints } from '../src/breakpoints/registry.ts';
import { createRuleEngine, createRequestContext } from '../src/network/rules.ts';
import { defaultInterceptRule, defaultMockRule, MAX_PAUSED_REQUESTS, PAUSE_DEADLINE_MS } from '../src/core/model.ts';

const matcher = (url = '/api/**', overrides = {}) => ({ method: '*', url, query: '', headers: '', bodyContains: '', ...overrides });
const context = (overrides = {}) =>
  createRequestContext({ kind: 'fetch', method: 'GET', url: 'https://example.test/api/items', ...overrides });

const request = (overrides = {}) => ({
  stage: 'request', transport: 'fetch', method: 'GET', url: 'https://example.test/api/items',
  ruleId: 'rule-1', ruleLabel: 'Pause it', revision: 1, profileId: 'p',
  snapshot: { headers: { accept: 'application/json' } }, bodyEditable: false, ...overrides,
});

test('M7 a pause is a single-use continuation: the first resolution wins', async () => {
  const log = [];
  const breakpoints = createBreakpoints({ report: message => log.push(message) });
  const waiting = breakpoints.pause(request());
  assert.equal(breakpoints.size, 1);
  const [entry] = breakpoints.list();
  assert.match(entry.id, /^pause-1$/);
  assert.equal(entry.stage, 'request');
  assert.ok(entry.deadlineAt - entry.at === PAUSE_DEADLINE_MS);

  entry.resume({ headers: { accept: 'text/plain' } });
  // A second resolution of the same entry must not produce a second outcome.
  entry.abort();
  entry.resume();
  const outcome = await waiting;
  assert.equal(outcome.action, 'continue');
  assert.deepEqual(outcome.edit, { headers: { accept: 'text/plain' } });
  assert.equal(breakpoints.size, 0);
  assert.equal(log.filter(line => line.includes('pause-1')).length, 2, 'one pause and exactly one release are logged');
});

test('M7 the queue limit is explicit: further matching requests continue unpaused', async () => {
  const breakpoints = createBreakpoints({ report: () => {} });
  const waiting = [];
  for (let index = 0; index < MAX_PAUSED_REQUESTS; index++) waiting.push(breakpoints.pause(request()));
  assert.equal(breakpoints.size, MAX_PAUSED_REQUESTS);

  const overflow = await breakpoints.pause(request());
  assert.equal(overflow.action, 'continue');
  assert.equal(overflow.edit, undefined);
  assert.match(overflow.diagnostic, /queue limit reached: 20 requests are already paused/);
  assert.equal(breakpoints.size, MAX_PAUSED_REQUESTS, 'the overflowing request never joined the queue');

  breakpoints.continueAll();
  const outcomes = await Promise.all(waiting);
  assert.deepEqual(new Set(outcomes.map(outcome => outcome.action)), new Set(['continue']));
  assert.equal(breakpoints.size, 0);
});

test('M7 the deadline resumes the original request and says that it did', async () => {
  const log = [];
  const breakpoints = createBreakpoints({ report: message => log.push(message), deadlineMs: 40 });
  const started = Date.now();
  const outcome = await breakpoints.pause(request({ stage: 'response' }));
  const elapsed = Date.now() - started;
  assert.equal(outcome.action, 'continue');
  assert.equal(outcome.edit, undefined, 'an expired pause delivers the original, unedited result');
  assert.match(outcome.diagnostic, /pause deadline 40 ms expired/);
  assert.ok(elapsed >= 35, `waited ${elapsed} ms`);
  assert.ok(log.some(line => line.includes('continued automatically after 40 ms')));
  assert.equal(breakpoints.size, 0);
});

test("M7 the caller's abort wins over a waiting pause", async () => {
  const breakpoints = createBreakpoints({ report: () => {} });
  const controller = new AbortController();
  const waiting = breakpoints.pause(request({ signal: controller.signal }));
  assert.equal(breakpoints.size, 1);
  controller.abort(new Error('caller went away'));
  const outcome = await waiting;
  assert.equal(outcome.action, 'abort');
  assert.equal(outcome.reason.message, 'caller went away');
  assert.equal(breakpoints.size, 0);

  // A request that is already aborted is never queued at all.
  const already = await breakpoints.pause(request({ signal: controller.signal }));
  assert.equal(already.action, 'abort');
  assert.equal(breakpoints.size, 0);
});

test('M7 disposal leaves no unresolved pause, and later requests are not paused', async () => {
  const breakpoints = createBreakpoints({ report: () => {} });
  const waiting = [breakpoints.pause(request()), breakpoints.pause(request({ stage: 'response' }))];
  assert.equal(breakpoints.size, 2);
  breakpoints.dispose();
  const outcomes = await Promise.all(waiting);
  assert.deepEqual(outcomes.map(outcome => outcome.action), ['continue', 'continue']);
  assert.deepEqual(outcomes.map(outcome => outcome.edit), [undefined, undefined]);
  assert.equal(breakpoints.size, 0);

  const after = await breakpoints.pause(request());
  assert.equal(after.action, 'continue');
  assert.match(after.diagnostic, /workbench closed; not paused/);
});

test('M7 the plan carries both pause stages, and a synthetic winner is never paused', () => {
  const engine = createRuleEngine();
  const rule = {
    ...defaultInterceptRule('p', 1), id: 'intercept-1', enabled: true, revision: 4,
    matcher: matcher(), breakpoints: { request: true, response: true },
  };
  engine.setRules([rule]);
  engine.setActive('intercept', true);

  const plan = engine.plan(context());
  assert.equal(plan.provider, 'network');
  assert.equal(plan.intercept.pauseRequest, true);
  assert.equal(plan.intercept.pauseResponse, true);
  assert.equal(plan.intercept.revision, 4, 'the pause records the rule revision it matched');
  assert.equal(plan.intercept.profileId, 'p');
  assert.ok(plan.why.some(line => /with request and response breakpoints/.test(line)));

  // A rule saved before M7 has no breakpoints field and pauses at neither stage.
  engine.setRules([{ ...rule, breakpoints: undefined, revision: 5 }]);
  const legacy = engine.plan(context());
  assert.equal(legacy.intercept.pauseRequest, false);
  assert.equal(legacy.intercept.pauseResponse, false);

  // A mock answers without a dispatch, so there is nothing to hold at either stage.
  engine.setRules([
    rule,
    { ...defaultMockRule('p', 2), id: 'mock-1', enabled: true, matcher: matcher() },
  ]);
  engine.setActive('mock', true);
  const mocked = engine.plan(context());
  assert.equal(mocked.provider, 'mock');
  assert.ok(
    mocked.why.some(line => /breakpoints not applied: a request answered without a dispatch/.test(line)),
    mocked.why.join(' | '),
  );
});
