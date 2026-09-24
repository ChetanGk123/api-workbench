import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { candidatesFrom, endpointFromRecording } from '../src/recorder/promote.ts';

// candidatesFrom reads location.origin to decide which recorded host is the page's own.
globalThis.location = { origin: 'https://app.test', hostname: 'app.test' };

function recording(overrides = {}) {
  return {
    id: `recording-${Math.random().toString(36).slice(2)}`,
    method: 'GET',
    url: 'https://app.test/api/users',
    headers: {},
    bodyStatus: 'omitted',
    durationMs: 5,
    source: 'network',
    ruleIds: [],
    at: Date.now(),
    ...overrides,
  };
}

test('M4 repeated calls to one path collapse into a single counted candidate', () => {
  const { candidates } = candidatesFrom([
    recording({ url: 'https://app.test/api/users?page=1' }),
    recording({ url: 'https://app.test/api/users?page=2' }),
    recording({ method: 'POST', url: 'https://app.test/api/users' }),
  ], 'profile-1');

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].count, 2);
  // The most recent call supplies the query string; the earlier one is not silently kept.
  assert.equal(candidates[0].endpoint.request.path, '/api/users?page=2');
  assert.equal(candidates[1].count, 1);
  assert.notEqual(candidates[0].endpoint.alias, candidates[1].endpoint.alias);
  assert.deepEqual(candidates.map(item => item.endpoint.profileId), ['profile-1', 'profile-1']);
});

test('M4 a candidate carries the recorded request and response sample without redacted values', () => {
  const { candidates } = candidatesFrom([recording({
    method: 'POST',
    url: 'https://app.test/api/login',
    headers: { authorization: '[REDACTED]', 'content-type': 'application/json' },
    body: '{"user":"a"}',
    bodyStatus: 'captured',
    response: { status: 201, headers: { 'content-type': 'application/json' }, body: '{"ok":true}', bodyStatus: 'captured' },
  })], 'profile-1');

  const endpoint = candidates[0].endpoint;
  assert.equal(endpoint.request.method, 'POST');
  assert.equal(endpoint.request.path, '/api/login');
  assert.equal(endpoint.request.bodyKind, 'json');
  assert.equal(endpoint.request.body, '{"user":"a"}');
  assert.deepEqual(endpoint.request.headers, [{ name: 'content-type', value: 'application/json' }]);
  assert.equal(endpoint.sampleResponse.status, 201);
  assert.equal(endpoint.sampleResponse.body, '{"ok":true}');
  // The credential is gone from the request, and the candidate says which one, so a replay that
  // is no longer the recorded request does not have to be diagnosed from its 401.
  assert.deepEqual(candidates[0].dropped, ['authorization']);
});

test('M4 a candidate names every credential the capture redacted, once', () => {
  const credentialled = overrides => recording({
    url: 'https://app.test/api/guarded',
    headers: { authorization: '[REDACTED]', cookie: '[REDACTED]', accept: 'application/json' },
    ...overrides,
  });
  const { candidates } = candidatesFrom([credentialled(), credentialled()], 'profile-1');
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].dropped, ['authorization', 'cookie']);
  assert.deepEqual(candidates[0].endpoint.request.headers, [{ name: 'accept', value: 'application/json' }]);

  // A request that carried no credential says nothing.
  const { candidates: plain } = candidatesFrom([recording({ url: 'https://app.test/api/open' })], 'profile-1');
  assert.deepEqual(plain[0].dropped, []);
});

test('M4 a traced credential returns as a binding template, not a stored value', () => {
  const { candidates } = candidatesFrom([recording({
    url: 'https://app.test/api/guarded',
    headers: { authorization: '[REDACTED]', accept: 'application/json' },
    credentials: { authorization: { source: 'local', key: 'app_access_token', prefix: 'Bearer ' } },
  })], 'profile-1');

  assert.deepEqual(candidates[0].endpoint.request.headers, [
    { name: 'accept', value: 'application/json' },
    { name: 'authorization', value: 'Bearer {{$context("local_app_access_token")}}' },
  ]);
  assert.deepEqual(candidates[0].bindings, [
    { name: 'local_app_access_token', source: 'local', key: 'app_access_token' },
  ]);
  // Traced, so it is not reported as dropped.
  assert.deepEqual(candidates[0].dropped, []);
});

test('M4 third-party origins become host keys the new profile can map', () => {
  const { candidates, hosts } = candidatesFrom([
    recording({ url: 'https://app.test/api/users' }),
    recording({ url: 'https://api.vendor.test/v1/items' }),
  ], 'profile-1');

  assert.equal(candidates[0].endpoint.hostKey, 'default');
  assert.equal(candidates[1].endpoint.hostKey, 'api.vendor.test');
  assert.deepEqual(hosts, { 'api.vendor.test': 'https://api.vendor.test', default: 'https://app.test' });
});

test('M4 a request that cannot become an endpoint is reported, not converted', () => {
  assert.equal(endpointFromRecording(recording({ method: 'PURGE' }), 'profile-1'), null);
  assert.equal(endpointFromRecording(recording({ url: 'not a url' }), 'profile-1'), null);
  const { candidates, skipped } = candidatesFrom([
    recording({ method: 'PURGE' }),
    recording({ url: 'https://app.test/api/users' }),
  ], 'profile-1');
  assert.equal(skipped, 1);
  assert.equal(candidates.length, 1);
});
