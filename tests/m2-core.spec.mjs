import test from 'node:test';
import assert from 'node:assert/strict';

import { createPipeline, createRequestContext } from '../src/network/pipeline.ts';

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
  pipeline.addRule({
    id: 'mock-rule',
    enabled: true,
    priority: 50,
    method: 'GET',
    url: '/api/mock-target',
  });
  const context = createRequestContext({
    kind: 'fetch',
    method: 'GET',
    url: 'https://example.test/api/mock-target',
    headers: { Accept: 'application/json' },
  });

  const lifecycle = pipeline.beginRequest(context, 'fetch');
  assert.equal(lifecycle.decision?.provider, 'mock');
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

test('M2 rules resolve deterministically and honor glob + conditions', () => {
  const pipeline = createPipeline(() => {});

  pipeline.addRule({
    id: 'fallback',
    enabled: true,
    priority: 1,
    method: 'GET',
    url: '/api/**',
    condition: { query: { action: 'list' } },
  });

  pipeline.addRule({
    id: 'exact-match',
    enabled: true,
    priority: 10,
    method: 'GET',
    url: '/api/mock-target',
    condition: { headers: { accept: 'application/json' } },
  });

  const decision = pipeline.decide('GET', 'https://example.test/api/mock-target?foo=bar', 'fetch', {
    headers: { accept: 'application/json' },
  });

  assert.ok(decision);
  assert.equal(decision.ruleId, 'exact-match');
  assert.equal(decision.provider, 'mock');
  assert.match(decision.why, /exact-match/);
});

test('disabled and non-matching rules are skipped', () => {
  const pipeline = createPipeline(() => {});

  pipeline.addRule({
    id: 'disabled',
    enabled: false,
    priority: 50,
    method: 'POST',
    url: '/api/**',
  });

  pipeline.addRule({
    id: 'wrong-method',
    enabled: true,
    priority: 20,
    method: 'GET',
    url: '/api/**',
    condition: { query: { mode: 'admin' } },
  });

  const decision = pipeline.decide('POST', 'https://example.test/api/mock-target', 'xhr');
  assert.equal(decision, null);
});
