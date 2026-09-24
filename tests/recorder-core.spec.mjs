import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRecorder, DEFAULT_RECORD_LIMIT } from '../src/recorder/recorder.ts';

/** Only `observe` is used by the recorder; the rest of the pipeline is irrelevant here. */
function fakePipeline() {
  const listeners = new Set();
  return {
    pipeline: { observe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    emit(event) { for (const listener of [...listeners]) listener(event); },
  };
}

const event = ({ request, ...overrides } = {}) => ({
  response: { status: 200, headers: {}, body: '{"ok":true}', bodyStatus: 'captured' },
  durationMs: 4,
  source: 'network',
  ruleIds: [],
  ...overrides,
  request: { kind: 'fetch', method: 'GET', url: 'https://app.test/api/users', headers: {}, ...request },
});

test('the recorder keeps only the number of requests its limit allows', () => {
  const { pipeline, emit } = fakePipeline();
  const recorder = createRecorder(pipeline);
  assert.equal(recorder.limit, DEFAULT_RECORD_LIMIT);
  recorder.setLimit(2);
  recorder.start();
  for (const index of [1, 2, 3, 4]) emit(event({ request: { url: `https://app.test/api/users/${index}` } }));
  assert.equal(recorder.records.length, 2);
  assert.deepEqual(recorder.records.map(item => item.url), [
    'https://app.test/api/users/3',
    'https://app.test/api/users/4',
  ]);
  // Bytes follow the kept records, so the resume-storage figure cannot drift upward forever.
  assert.equal(recorder.bytes, recorder.records.reduce((total, item) => total + JSON.stringify(item).length, 0));

  // Lowering the limit drops the oldest immediately rather than waiting for the next capture.
  recorder.setLimit(1);
  assert.deepEqual(recorder.records.map(item => item.url), ['https://app.test/api/users/4']);
  recorder.stop();
});

test('tester traffic is recorded only when the profile asks for it', () => {
  const { pipeline, emit } = fakePipeline();
  const recorder = createRecorder(pipeline);
  recorder.start();
  emit(event({ request: { fromTester: true } }));
  emit(event({ request: { url: 'https://app.test/api/page' } }));
  assert.deepEqual(recorder.records.map(item => item.url), ['https://app.test/api/page']);
  recorder.stop();

  recorder.reset();
  recorder.start({ includeTester: true });
  emit(event({ request: { fromTester: true } }));
  assert.equal(recorder.records.length, 1);
  recorder.stop();
});

test('a reset draft reports nothing held', () => {
  const { pipeline, emit } = fakePipeline();
  const recorder = createRecorder(pipeline);
  recorder.start();
  emit(event());
  assert.equal(recorder.records.length, 1);
  assert.ok(recorder.bytes > 0);
  recorder.reset();
  assert.deepEqual(recorder.records, []);
  assert.equal(recorder.bytes, 0);
  recorder.stop();
});
