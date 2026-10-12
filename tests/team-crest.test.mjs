import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('FC Koshi uses the refreshed crest and synchronized image assets', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id: 'koshi'.*logo: '\.\/assets\/team-crests\/fc-koshi\.png\?v=20261012'/);
  const image = fs.readFileSync(new URL('../public/assets/team-crests/fc-koshi.png', import.meta.url));
  assert.equal(image.readUInt32BE(16), 1254);
  assert.equal(image.readUInt32BE(20), 1254);
  for (const path of ['../assets/team-crests/fc-koshi.png', '../fc-koshi.png']) {
    assert.deepEqual(fs.readFileSync(new URL(path, import.meta.url)), image);
  }
  assert.equal(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), html);
});
