import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const firebaseSync = fs.readFileSync(new URL('../public/firebase-sync.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('FNL-001 removes the regulations page and navigation', () => {
  assert.doesNotMatch(html, /page-rules/);
  assert.doesNotMatch(html, /pageId === 'rules'/);
  assert.doesNotMatch(html, /renderRules\(/);
  assert.doesNotMatch(html, /switchRulesView/);
  assert.doesNotMatch(html, /data-rules-tab/);
  assert.doesNotMatch(html, /page: 'rules'/);
  assert.match(html, /data-page="transfer"/);
});

test('FNL-001 preserves regulations data compatibility', () => {
  assert.match(html, /regulations: createInitialRegulationState\(\)/);
  assert.match(html, /parsed\.regulations/);
  assert.match(firebaseSync, /"regulations"/);
  assert.match(firebaseSync, /remote\.regulations/);
});

test('root and public entry points stay synchronized', () => {
  assert.equal(rootHtml, html);
});

test('FNL app shell cache is current', () => {
  assert.match(serviceWorker, /const CACHE_NAME = 'fnl-app-v121'/);
});
