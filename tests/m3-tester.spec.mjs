import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEndpoint, defaultProfile } from '../src/core/model.ts';
import { executeOnce } from '../src/tester/once.ts';

test('Once blocks unresolved hosts and variables before dispatch', async () => {
  const endpoint = defaultEndpoint('default');
  endpoint.request.path = '/api/{{missing}}';
  const profile = defaultProfile();
  let calls = 0;
  const result = await executeOnce(endpoint, profile, async () => { calls += 1; return new Response('unexpected'); });
  assert.equal(result.outcome, 'blocked');
  assert.equal(calls, 0);
  assert.match(result.error ?? '', /missing/);
});

test('Once uses global then local headers and evaluates bounded response checks', async () => {
  const endpoint = defaultEndpoint('default');
  endpoint.request.path = 'https://example.test/api/result';
  endpoint.request.headers = [{ name: 'X-Test', value: 'local' }];
  endpoint.checks = [{ kind: 'status', value: 200 }, { kind: 'body-contains', value: 'ok' }];
  const profile = defaultProfile();
  profile.globalHeaders = [{ name: 'X-Test', value: 'global' }, { name: 'X-Global', value: 'yes' }];
  let seen;
  const result = await executeOnce(endpoint, profile, async (_input, init) => {
    seen = init;
    return new Response('{"state":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(result.outcome, 'passed');
  assert.equal(result.checks.every(check => check.state === 'passed'), true);
  assert.equal(new Headers(seen.headers).get('x-test'), 'local');
  assert.equal(new Headers(seen.headers).get('x-global'), 'yes');
});