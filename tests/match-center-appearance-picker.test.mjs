import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const refreshBody = html.match(/window\.refreshLeagueParticipantOptions = function\(mId\) \{([\s\S]*?)\n        \};/)?.[1] || '';

test('appearance changes update the draft without rebuilding the match center', () => {
  assert.match(refreshBody, /captureLeagueMatchDraft\(match\)/);
  assert.match(refreshBody, /leagueMatchDrafts\.set\(mId, draft\)/);
  assert.doesNotMatch(refreshBody, /renderLeagueMatchCenter/);
  assert.doesNotMatch(refreshBody, /sheet-body/);
});

test('home and away appearance pickers use the partial participant refresh', () => {
  assert.match(html, /renderAppearancePicker\(match\.h, 'league-home',[\s\S]*?refreshLeagueParticipantOptions/);
  assert.match(html, /renderAppearancePicker\(match\.a, 'league-away',[\s\S]*?refreshLeagueParticipantOptions/);
  assert.match(html, /data-appearance="\$\{side\}"/);
});

test('dependent MOM and goal controls are updated in place', () => {
  assert.match(refreshBody, /motmSelect\.innerHTML = matchEventPlayerOptions/);
  assert.match(refreshBody, /goalPlayerSelect\.innerHTML = goalScorerOptions/);
  assert.match(refreshBody, /goalAssistSelect\.innerHTML = matchEventPlayerOptions/);
});

test('root and public entry points remain synchronized', () => {
  assert.equal(rootHtml, html);
});
