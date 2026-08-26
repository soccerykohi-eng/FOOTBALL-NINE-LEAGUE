import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const firebaseSync = fs.readFileSync(new URL('../public/firebase-sync.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');

assert.doesNotMatch(html, /id="page-cup"|hirabayashiCup|createHirabayashiCupState|renderHirabayashiCup/);
assert.doesNotMatch(html, /第8章 カップ戦・大会特典|第17条（平林杯）/);
assert.doesNotMatch(html, /transferMarket|renderTransferCenter|openRecommendedTransferView/);
assert.doesNotMatch(firebaseSync, /hirabayashiCup|transferMarket|storeCloudRecoverySnapshot|cloudRecoveryKey/);
assert.doesNotMatch(serviceWorker, /hirabayashi-cup\.png/);
assert.doesNotMatch(html, /previousSeasonSnapshot|undoSeasonTransition|restoreRegulationVersion/);
assert.doesNotMatch(firebaseSync, /previousSeasonSnapshot/);
assert.match(firebaseSync, /function mergeRosterMap\(/);
assert.match(firebaseSync, /mergeArrayById\(remoteRoster, localRoster, baseRoster, "id"\)/);
assert.doesNotMatch(firebaseSync, /他の端末で同じクラブの名簿が更新されました/);

assert.match(html, /function getRoster\(teamId\)/);
assert.match(html, /function activeRosterPlayers\(teamId\)/);
assert.match(html, /appearances >= 10 \? '<span class="protection-ready"/);
assert.match(html, /プロテクト可/);
assert.match(html, /window\.removePlayer[\s\S]*?validateRoster\(teamId, proposed, true\)/);

assert.match(html, /const remaining = state\.schedule\.filter\(match => !isMatchCompleted\(match\)\)\.length/);
assert.match(html, /home !== null && home !== '' && away !== null && away !== ''/);
assert.doesNotMatch(html, /終了時移籍市場が完了していないため、次シーズン/);
assert.doesNotMatch(html, /中間移籍市場が完了していないため、MW10/);

assert.match(html, /#page-home\.active \{ display:grid; grid-template-rows:/);
assert.match(html, /@media \(max-height:720px\)[\s\S]*#page-home \.news-item \{ padding:5px 0; \}/);
assert.match(html, /\.roster-team-grid \{ display:grid; grid-template-rows:repeat\(9/);
assert.match(html, /class="roster-team-count"/);
assert.match(html, /#page-news \.news-page-button \{ min-width:44px; height:44px/);
assert.match(html, /class="sheet-toolbar"/);
assert.match(html, /class="sheet-close-button"[\s\S]*aria-label="閉じる"[\s\S]*<svg/);

console.log('FNL roster, season transition and mobile UI tests passed');
