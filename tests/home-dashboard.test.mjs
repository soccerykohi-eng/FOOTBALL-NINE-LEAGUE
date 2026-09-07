import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dashboardBody = html.match(/function renderHomeDashboard\(\) \{([\s\S]*?)\n        \}/)?.[1] || '';
const matchesBody = html.match(/function renderHomeFeaturedMatch\(\) \{([\s\S]*?)\n        \}/)?.[1] || '';

test('HOME presents the current league status metrics', () => {
  assert.match(html, /id="home-status-title">リーグ状況/);
  assert.match(dashboardBody, /現在の首位/);
  assert.match(dashboardBody, /得点王/);
  assert.match(dashboardBody, /<div class="metric-label">消化試合<\/div>/);
  assert.match(dashboardBody, /\$\{played\} \/ \$\{state\.schedule\.length\}/);
  assert.doesNotMatch(dashboardBody, /home-progress-track/);
  assert.match(dashboardBody, /\$\{topScorer\.goals\} 得点/);
});

test('HOME has separate next-match and latest-result cards', () => {
  assert.match(html, /id="home-next-title">NEXT MATCH/);
  assert.match(html, /id="home-featured-match"/);
  assert.match(html, /id="home-latest-title">LATEST RESULT/);
  assert.match(html, /id="home-latest-result"/);
  assert.match(matchesBody, /MATCHWEEK \$\{match\.mw\}/);
  assert.match(matchesBody, /\$\{match\.hs\} - \$\{match\.as\}/);
});

test('HOME handles pre-season, in-progress, completed, and empty schedules', () => {
  assert.match(matchesBody, /find\(match => !isMatchCompleted\(match\)\)/);
  assert.match(matchesBody, /filter\(isMatchCompleted\)/);
  assert.match(matchesBody, /nextMatch \? matchCard\(nextMatch, false\) : '<div class="home-match-empty">全日程終了/);
  assert.match(matchesBody, /latestCompletedMatch \? matchCard\(latestCompletedMatch, true\) : '<div class="home-match-empty">まだ試合結果はありません/);
  assert.match(dashboardBody, /state\.schedule\.filter\(isMatchCompleted\)\.length/);
});

test('HOME redesign does not restore the retired content UI', () => {
  assert.doesNotMatch(html, /news|ニュース/i);
});

test('root and public HOME implementations remain synchronized', () => {
  assert.equal(rootHtml, html);
});
