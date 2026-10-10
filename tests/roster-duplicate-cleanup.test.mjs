import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const rootHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const normalizeStart = html.indexOf('function normalizePlayerIdentity(name = \'\')');
const normalizeEnd = html.indexOf('\n\n        function findPlayerOwnership', normalizeStart);
const normalizeSource = html.slice(normalizeStart, normalizeEnd);
const validateStart = html.indexOf('function validateRoster(teamId, roster, allowIncomplete = false)');
const validateEnd = html.indexOf('\n\n        function getPlayerSeasonAppearances', validateStart);
const validateSource = html.slice(validateStart, validateEnd);
const context = {};
vm.runInNewContext(`${normalizeSource}\n${validateSource}\nthis.normalizePlayerIdentity = normalizePlayerIdentity; this.validateRoster = validateRoster;`, context);

const legacyRoster = [
  { id: 'reus-dot', name: 'マルコ・ロイス', cardType: 'special', status: 'active' },
  { id: 'reus-space', name: 'マルコ　ロイス', cardType: 'special', status: 'active' },
  { id: 'saibari-dot', name: 'イスマイラ・サイバリ', cardType: 'normal', status: 'active' },
  { id: 'saibari-space', name: 'イスマイラ　サイバリ', cardType: 'normal', status: 'active' }
];

test('legacy punctuation and spacing variants remain correctly identified as duplicates', () => {
  assert.equal(context.normalizePlayerIdentity('マルコ・ロイス'), context.normalizePlayerIdentity('マルコ　ロイス'));
  assert.equal(context.normalizePlayerIdentity('イスマイラ・サイバリ'), context.normalizePlayerIdentity('イスマイラ　サイバリ'));
});

test('removing one legacy duplicate can leave another unrelated duplicate', () => {
  const proposed = legacyRoster.filter(player => player.id !== 'reus-dot');
  const validation = context.validateRoster('kasuga', proposed, true);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /イスマイラ　サイバリ が重複しています/);
});

test('roster deletion permits cleanup while registration still validates duplicates', () => {
  const removeBody = html.match(/window\.removePlayer = function\(teamId, playerId\) \{([\s\S]*?)\n        \};/)?.[1] || '';
  const saveBody = html.match(/window\.savePlayerToRoster = function\(\) \{([\s\S]*?)\n        \};/)?.[1] || '';
  assert.match(removeBody, /filter\(item => item\.id !== playerId\)/);
  assert.match(removeBody, /state\.rosters\[teamId\] = proposed/);
  assert.doesNotMatch(removeBody, /validateRoster/);
  assert.match(saveBody, /validateRoster\(teamId, proposed/);
  assert.match(saveBody, /findPlayerOwnership\(name\)/);
});

test('root and public roster cleanup behavior remain synchronized', () => {
  assert.equal(rootHtml, html);
});
