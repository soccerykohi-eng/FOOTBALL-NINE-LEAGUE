import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionStart = html.indexOf('function findRegisteredPlayers(query)');
const functionEnd = html.indexOf('\n\n        function renderPlayerDirectory()', functionStart);
const functionSource = html.slice(functionStart, functionEnd);
const teams = [{ id: 'a', name: 'Alpha FC' }, { id: 'b', name: 'Beta FC' }];
const rosters = {
  a: [
    { id: '1', name: 'Alex Smith', position: 'FW', cardType: 'special', status: 'active' },
    { id: '2', name: 'Goal Keeper', position: 'GK', cardType: 'normal', status: 'active' }
  ],
  b: [
    { id: '3', name: 'Alex Stone', position: 'MF', cardType: 'normal', status: 'active' },
    { id: '4', name: 'Released Alex', position: 'DF', cardType: 'normal', status: 'released' }
  ]
};
const context = {
  RAW_TEAMS: teams,
  activeRosterPlayers: teamId => rosters[teamId].filter(player => player.status === 'active'),
  getPlayerSeasonAppearances: (teamName, playerName) => playerName === 'Alex Smith' ? 10 : 3
};
const findRegisteredPlayers = vm.runInNewContext(`(${functionSource})`, context);

test('empty search keeps the existing nine-club directory path', () => {
  assert.equal(findRegisteredPlayers('').length, 0);
  assert.match(html, /if \(query\) \{[\s\S]*?return;[\s\S]*?roster-team-grid/);
  assert.match(html, /RAW_TEAMS\.map\(team =>/);
});

test('player search supports exact, partial, case-insensitive, and trimmed matches', () => {
  assert.equal(findRegisteredPlayers('Alex Smith').length, 1);
  assert.equal(findRegisteredPlayers('alex').length, 2);
  assert.equal(findRegisteredPlayers('ALEX SMITH').length, 1);
  assert.equal(findRegisteredPlayers('  alex smith  ').length, 1);
});

test('player search spans clubs and excludes missing or inactive players', () => {
  const matches = findRegisteredPlayers('alex');
  assert.deepEqual(Array.from(matches, player => player.teamName), ['Alpha FC', 'Beta FC']);
  assert.equal(findRegisteredPlayers('unknown').length, 0);
  assert.equal(findRegisteredPlayers('Released Alex').length, 0);
});

test('search results reuse roster metadata, appearances, and protection rule', () => {
  assert.match(html, /placeholder="選手名を検索"/);
  assert.match(html, /getPlayerSeasonAppearances\(team\.name, player\.name\)/);
  assert.match(html, /player\.cardType === 'special' \? '特別' : '通常'/);
  assert.match(html, /player\.appearances >= 10 \? '<span class="protection-ready">プロテクト可/);
  assert.match(html, /該当する登録選手はいません/);
});

test('result navigation and clear control retain existing roster behavior', () => {
  assert.match(html, /onclick="openRosterSheet\('\$\{player\.teamId\}'\)"/);
  assert.match(html, /onclick="clearPlayerDirectorySearch\(\)"/);
  assert.match(html, /window\.clearPlayerDirectorySearch[\s\S]*?input\.value = ''[\s\S]*?renderPlayerDirectory\(\)/);
});

test('search UI has an iPhone-width layout rule and synchronized entry points', () => {
  assert.match(html, /@media \(max-width:420px\)[\s\S]*?\.player-search-input \{ font-size:16px; \}/);
  assert.match(html, /\.player-search-result \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto/);
  assert.equal(rootHtml, html);
});
