import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { nameFromHost, pageProfileName, suggestProfileName } from '../src/core/model.ts';

test('a host becomes a readable profile name', () => {
  const cases = [
    ['krushna.cooksbook.in', 'krushna-cooksbook'],
    ['api.cooksbook.in', 'api-cooksbook'],
    ['www.cooksbook.in', 'cooksbook'],
    ['cooksbook.in', 'cooksbook'],
    ['shop.example.co.uk', 'shop-example'],
    // No TLD to drop, so these keep the name the user recognises.
    ['localhost', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
  ];
  for (const [host, expected] of cases) assert.equal(nameFromHost(host), expected, host);
});

test('a new profile name never collides with a stored one', () => {
  const taken = ['krushna-cooksbook', 'krushna-cooksbook-2'];
  assert.equal(suggestProfileName('krushna-cooksbook', taken), 'krushna-cooksbook-3');
  assert.equal(suggestProfileName('  staging  ', taken), 'staging');
  assert.equal(suggestProfileName('staging', ['staging']), 'staging-2');
});

test('an empty name falls back to the page', () => {
  // Other core specs also assign location, so it is set at call time, not at module load.
  const previous = globalThis.location;
  globalThis.location = { origin: 'https://krushna.cooksbook.in', hostname: 'krushna.cooksbook.in' };
  try {
    assert.equal(pageProfileName(), 'krushna-cooksbook');
    assert.equal(suggestProfileName('   ', []), 'krushna-cooksbook');
    assert.equal(suggestProfileName('', ['krushna-cooksbook']), 'krushna-cooksbook-2');
  } finally {
    globalThis.location = previous;
  }
});
