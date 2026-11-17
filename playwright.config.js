'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    headless: true
  },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: '3100',
      LLM_API_KEY: ''
    }
  }
});
