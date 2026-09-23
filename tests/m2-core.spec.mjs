import test from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline, createRequestContext } from '../src/network/pipeline.ts';
import { createRecorder } from '../src/recorder/recorder.ts';
import { defaultMockRule } from '../src/core/model.ts';

test('M2 request context is immutable and keeps the original request shape', () => {
  const context = createRequestContext({
    kind: 'fetch',
    method: 'POST',
    url: 'https://example.test/api/mock-target?mode=all',
    headers: { Accept: 'application/json', 'X-Test': 'one' },
    body: '{"hello":"world"}',
  });

  assert.equal(context.method, 'POST');
  assert.equal(context.url, 'https://example.test/api/mock-target?mode=all');
  assert.equal(context.headers.accept, 'application/json');
  assert.equal(context.body, '{"hello":"world"}');
  assert.throws(() => {
    // @ts-expect-error immutability test
    context.headers.accept = 'changed';
  }, TypeError);
});

test('M2 request lifecycle records abort and completion events', () => {
  const pipeline = createPipeline(() => {});
  pipeline.setRules([{
    ...defaultMockRule('p', 1),
    id: 'mock-rule',
    matcher: { method: 'GET', url: '/api/mock-target', query: '', headers: '', bodyContains: '' },
  }]);
  pipeline.setActive('mock', true);
  const context = createRequestContext({
    kind: 'fetch',
    method: 'GET',
    url: 'https://example.test/api/mock-target',
    headers: { Accept: 'application/json' },
  });

  const lifecycle = pipeline.beginRequest(context, 'fetch');
  assert.equal(lifecycle.plan.provider, 'mock');
  lifecycle.settle('abort', 'user-cancelled');

  assert.equal(pipeline.trace.length >= 2, true);
  assert.equal(pipeline.trace.some(event => event.kind === 'abort'), true);
  assert.equal(pipeline.trace.some(event => event.kind === 'request'), true);
});

test('M2 body policy keeps string bodies bounded and marks unsupported payloads as omitted', () => {
  const pipeline = createPipeline(() => {});
  const large = 'x'.repeat(1024 * 32);
  const text = pipeline.analyzeBody(large, 'text/plain');
  const unsupported = pipeline.analyzeBody(new Blob(['abc']), 'application/octet-stream');

  assert.equal(text.truncated, true);
  assert.match(text.preview, /x{0,128}/i);
  assert.equal(unsupported.kind, 'omitted');
  assert.equal(unsupported.preview, '');
});

test('M2 cancellation-aware lifecycle reports a cancelled signal before dispatch completes', () => {
  const pipeline = createPipeline(() => {});
  const controller = new AbortController();
  const context = createRequestContext({
    kind: 'fetch',
    method: 'POST',
    url: 'https://example.test/api/mock-target',
    headers: { 'Content-Type': 'application/json' },
    body: '{"a":1}',
    signal: controller.signal,
  });

  controller.abort('cancelled');
  const lifecycle = pipeline.beginRequest(context, 'fetch');
  assert.equal(lifecycle.cancelled, true);
  assert.equal(lifecycle.trace.some(event => event.kind === 'abort'), true);
});

test('M4 recorder subscribes to bounded, redacted traffic and disposes cleanly', () => {
  const pipeline = createPipeline(() => {});
  const recorder = createRecorder(pipeline);
  assert.equal(recorder.start(), true);
  const context = createRequestContext({
    kind: 'fetch', method: 'POST', url: 'https://example.test/api/login',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: 'x'.repeat(20000),
  });
  pipeline.publishTraffic({
    request: context,
    response: { status: 201, headers: { 'Set-Cookie': 'session=secret', 'Content-Type': 'application/json' }, body: '{"ok":true}', bodyStatus: 'captured' },
    durationMs: 12, source: 'network', ruleIds: [],
  });
  assert.equal(recorder.records.length, 1);
  assert.equal(recorder.records[0].headers.authorization, '[REDACTED]');
  assert.equal(recorder.records[0].bodyStatus, 'truncated');
  assert.equal(recorder.records[0].body.length, 16384);
  assert.equal(recorder.records[0].response.headers['Set-Cookie'], '[REDACTED]');
  pipeline.publishTraffic({ request: context, response: { status: 200, headers: {}, body: 'short', bodyStatus: 'truncated' }, durationMs: 1, source: 'network', ruleIds: [] });
  assert.equal(recorder.records[1].response.bodyStatus, 'truncated');
  recorder.stop();
  pipeline.publishTraffic({ request: context, durationMs: 1, source: 'network', ruleIds: [] });
  assert.equal(recorder.records.length, 2);
});
