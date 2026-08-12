import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} was not found in index.html`);
  const candidates = [
    html.indexOf('\n        function ', start + 1),
    html.indexOf('\n        window.', start + 1)
  ].filter(index => index > start);
  return html.slice(start, Math.min(...candidates));
}

const teams = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' }
];
const normal = (id, name = id) => ({ id, name, cardType: 'normal', status: 'active' });
const special = (id, name = id) => ({ id, name, cardType: 'special', status: 'active' });
const sevenNormals = prefix => Array.from({ length: 7 }, (_, index) => normal(`${prefix}${index}`, `${prefix} Player ${index}`));

const context = vm.createContext({
  RAW_TEAMS: teams,
  state: { rosters: { a: sevenNormals('A'), b: sevenNormals('B') } },
  cloneTransferData: value => JSON.parse(JSON.stringify(value)),
  console
});

for (const name of [
  'normalizePlayerIdentity',
  'activePlayersFromRoster',
  'validateRoster',
  'inspectRosterIntegrity',
  'previewRosterMoves'
]) vm.runInContext(functionSource(name), context);

const call = (name, ...args) => vm.runInContext(name, context)(...args);

assert.equal(call('normalizePlayerIdentity', ' Ｌ. Messi '), 'lmessi');
assert.equal(call('validateRoster', 'a', [...sevenNormals('A'), ...Array.from({ length: 19 }, (_, index) => special(`S${index}`))]).valid, false);
assert.match(call('validateRoster', 'a', Array.from({ length: 26 }, (_, index) => normal(`N${index}`))).errors.join(' '), /25名/);
assert.match(call('validateRoster', 'a', Array.from({ length: 6 }, (_, index) => normal(`N${index}`))).errors.join(' '), /7名未満/);

context.state.rosters = {
  a: [...sevenNormals('A'), normal('dup-a', 'Same Player')],
  b: [...sevenNormals('B'), normal('dup-b', 'Ｓａｍｅ　Ｐｌａｙｅｒ')]
};
assert.match(call('inspectRosterIntegrity').issues.map(issue => issue.message).join(' '), /重複登録/);

context.state.rosters = {
  a: [...sevenNormals('A'), special('trade-a', 'Trade A')],
  b: [...sevenNormals('B'), special('trade-b', 'Trade B')]
};
const validTrade = call('previewRosterMoves', [
  { sourceTeamId: 'a', playerId: 'trade-a', targetTeamId: 'b' },
  { sourceTeamId: 'b', playerId: 'trade-b', targetTeamId: 'a' }
]);
assert.equal(validTrade.valid, true, validTrade.errors?.join('\n'));

context.state.rosters = { a: sevenNormals('A'), b: sevenNormals('B') };
const invalidTrade = call('previewRosterMoves', [
  { sourceTeamId: 'a', playerId: 'A0', targetTeamId: 'b' }
]);
assert.equal(invalidTrade.valid, false);
assert.match(invalidTrade.errors.join(' '), /ノーマルカードが7名未満/);

console.log('transfer rule tests passed');
