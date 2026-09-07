import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bottomNav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';

test('bottom navigation replaces the more menu with a direct roster destination', () => {
  assert.doesNotMatch(bottomNav, /その他|data-nav-more|openMoreNavigationSheet|ellipsis/);
  assert.match(bottomNav, /data-page="transfer"/);
  assert.match(bottomNav, /onclick="navigateTo\('transfer', '選手名簿', this\)"/);
  assert.match(bottomNav, /data-lucide="users-round"/);
  assert.match(bottomNav, /<span>選手名簿<\/span>/);
});

test('more-menu-only code and styles are absent', () => {
  assert.doesNotMatch(html, /openMoreNavigationSheet|navigateFromMoreMenu|data-nav-more|more-menu-(?:grid|button)|その他のページ/);
});

test('roster page and direct navigation behavior remain available', () => {
  assert.match(html, /id="page-transfer"/);
  assert.match(html, /if \(pageId === 'transfer'\) renderPlayerDirectory\(\)/);
  assert.match(html, /document\.getElementById\(`page-\$\{pageId\}`\)/);
});

test('root and public entry points stay synchronized after navigation changes', () => {
  assert.equal(rootHtml, html);
});
