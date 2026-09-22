import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.mjs', workers: 1, timeout: 20000,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', channel: process.env.AW_BROWSER || 'chrome' },
  webServer: { command: 'node tests/fixtures/server.mjs', wait: { stdout: /Fixtures:/ }, timeout: 10000 },
});
