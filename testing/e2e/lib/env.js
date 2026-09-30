// Where the suites find the system under test. Defaults match a local run
// (API on 3000, owner app on 3001); CI and the runner override them.
const { chromium } = require('playwright-core');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:3000';
const BASE = process.env.E2E_WEB_URL || 'http://127.0.0.1:3001';

// A superuser connection to the same database, used only to arrange time
// (backdating) and to read the ledger directly. Never the app's connection:
// the API itself runs as morbeez_app, under row-level security.
const DB_URL = process.env.E2E_DB_URL || 'postgres://postgres@127.0.0.1:5433/postgres';

// The password database/seeds gives every dev user.
const PASSWORD = 'dev-only-change-me-123';

// CI uses Playwright's bundled Chromium; locally, set E2E_BROWSER_CHANNEL=msedge
// (or chrome) to use an installed browser instead.
function launchBrowser() {
  const channel = process.env.E2E_BROWSER_CHANNEL || undefined;
  return chromium.launch({ channel, headless: true });
}

module.exports = { API, BASE, DB_URL, PASSWORD, launchBrowser };
