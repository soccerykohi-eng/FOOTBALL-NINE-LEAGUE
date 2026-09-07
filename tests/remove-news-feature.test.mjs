import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const rootHtml = read('../index.html');
const firebaseSync = read('../public/firebase-sync.js');
const firebaseConfig = read('../public/firebase-config.js');
const serviceWorker = read('../public/service-worker.js');
const cupHtml = read('../public/hirabayashi-cup/index.html');
const cupFirebaseSync = read('../public/hirabayashi-cup/firebase-sync.js');
const cupFirebaseConfig = read('../public/hirabayashi-cup/firebase-config.js');
const cupServiceWorker = read('../public/hirabayashi-cup/service-worker.js');

const retiredFeaturePattern = /news|ニュース/i;
const retiredPushPattern = /notification|firebase-messaging|vapid|FNL_NOTIFICATION_CONFIG|fnl-news/i;

test('retired content feature has no page, navigation, home panel, composer, or logic', () => {
  for (const source of [html, cupHtml]) {
    assert.doesNotMatch(source, retiredFeaturePattern);
  }
});

test('Firestore synchronization ignores the retired field and keeps other data fields', () => {
  for (const source of [firebaseSync, cupFirebaseSync]) {
    assert.doesNotMatch(source, retiredFeaturePattern);
    assert.doesNotMatch(source, retiredPushPattern);
    assert.match(source, /"schedule"/);
    assert.match(source, /"rosters"/);
    assert.match(source, /"seasonInfo"/);
  }
});

test('push configuration and service-worker handlers are absent', () => {
  for (const source of [firebaseConfig, serviceWorker, cupFirebaseConfig, cupServiceWorker]) {
    assert.doesNotMatch(source, retiredPushPattern);
    assert.doesNotMatch(source, retiredFeaturePattern);
  }
  assert.equal(fs.existsSync(new URL('../cloudflare-worker.js', import.meta.url)), false);
});

test('root and public duplicated files remain synchronized', () => {
  assert.equal(rootHtml, html);
  assert.equal(read('../firebase-config.js'), firebaseConfig);
  assert.equal(read('../firebase-sync.js'), firebaseSync);
  assert.equal(read('../manifest.webmanifest'), read('../public/manifest.webmanifest'));
  assert.equal(read('../service-worker.js'), serviceWorker);
});
