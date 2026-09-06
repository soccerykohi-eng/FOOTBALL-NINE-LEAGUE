import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const firebaseSync = fs.readFileSync(new URL('../public/firebase-sync.js', import.meta.url), 'utf8');
const rootFirebaseSync = fs.readFileSync(new URL('../firebase-sync.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const rootServiceWorker = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

test('FNL-002 removes all news UI and operations', () => {
  [
    /page-news/,
    /home-news-preview/,
    /最新ニュース/,
    /page: 'news'/,
    /renderNews\(/,
    /openNewsDetailSheet/,
    /openPostNewsSheet/,
    /submitNewsPostToCloud/,
    /deleteNewsFromCloud/,
    /news-notification-button/,
    /news-pagination/,
    /notifyNewsPublished/
  ].forEach(pattern => assert.doesNotMatch(html, pattern));
});

test('FNL-002 preserves stored news data compatibility', () => {
  assert.match(html, /news: JSON\.parse\(JSON\.stringify\(INITIAL_NEWS\)\)/);
  assert.match(html, /parsed\.news/);
  assert.match(html, /news: state\.news/);
  assert.match(firebaseSync, /"news"/);
  assert.match(firebaseSync, /remote\.news/);
  assert.match(firebaseSync, /mergeChangedField[\s\S]*field === "news"/);
});

test('FNL-002 removes app-side notification setup without clearing old tokens', () => {
  assert.doesNotMatch(firebaseSync, /firebase-messaging|toggleNewsNotifications|initializeNewsNotifications|notifyNewsPublished/);
  assert.doesNotMatch(firebaseSync, /fnl-news-notifications-enabled|fnl-news-notification-token|removeItem\(notification/);
});

test('duplicated deployment files remain synchronized', () => {
  assert.equal(rootHtml, html);
  assert.equal(rootFirebaseSync, firebaseSync);
  assert.equal(rootServiceWorker, serviceWorker);
});

test('FNL-002 advances the app shell cache', () => {
  assert.match(serviceWorker, /const CACHE_NAME = 'fnl-app-v121'/);
});
