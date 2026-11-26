/**
 * Tests for the Crow Scrapper v1.2.0 features: ID/Phone column, manual edits with live
 * recalculation, per-reel data, data-quality flags and the 10-column exports / sheet sync.
 * Run: node tests/v1.2-features.test.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Core = require('../src/core.js');

function reelPosts(list) {
  return list.map(([views, likes, comments], i) => ({
    code: `CODE${i}abcde`,
    play_count: views,
    like_count: likes,
    comment_count: comments,
    media_type: 2,
    product_type: 'clips',
    taken_at: 1700000000 - i * 86400
  }));
}

function makeSheet(rows) {
  return {
    getLastRow: () => rows.length,
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        setValues(vals) {
          for (let r = 0; r < numRows; r++) {
            const idx = row - 1 + r;
            if (!rows[idx]) rows[idx] = [];
            for (let c = 0; c < numCols; c++) rows[idx][col - 1 + c] = vals[r][c];
          }
          return this;
        },
        setFontWeight() { return this; },
        setHorizontalAlignment() { return this; },
        setBackground() { return this; },
        getFormulas() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const a = rows[row - 1 + r] || [];
            out.push(a.slice(col - 1, col - 1 + numCols).map((v) => (String(v || '').startsWith('=') ? v : '')));
          }
          return out;
        },
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) out.push((rows[row - 1 + r] || []).slice(col - 1, col - 1 + numCols));
          return out;
        }
      };
    },
    deleteRow(n) { rows.splice(n - 1, 1); },
    appendRow(v) { rows.push(v.slice()); }
  };
}

function run() {
  console.log('Crow Scrapper v1.2.0 feature tests');

  // 1. Scrape result keeps the analyzed reels, the data source and ignores impossible view counts
  const metrics = Core.calculateProfileMetrics({
    username: 'gallery_mahshid',
    followers: 166676,
    dataSource: 'tiles',
    posts: reelPosts([[308, 24000, 308], [150000, 20000, 300], [160000, 22000, 310]])
  });
  assert.equal(metrics.dataSource, 'tiles');
  assert.equal(metrics.reels.length, 3);
  assert.equal(metrics.reels[0].viewsSuspect, true, '308 views with 24,000 likes must be flagged');
  assert.equal(metrics.reels[0].views, 0, 'a misread view count must not be averaged in');
  assert.equal(metrics.avgViews, 155000, 'AV VIEW must use only the plausible reels');
  assert.equal(metrics.reels[1].url, 'https://www.instagram.com/reel/CODE1abcde/');
  assert.equal(metrics.contactInfo, '');
  assert.equal(metrics.manuallyEdited, false);
  console.log('   ✓ per-reel data, data source and impossible-views guard');

  // 2. Quality flags
  const q = Core.assessProfileQuality(metrics);
  assert.equal(q.level, 'warn');
  assert.ok(q.issues.some((i) => /looked wrong/.test(i)));
  assert.ok(q.issues.some((i) => /page tiles/.test(i)));
  const crazy = Core.calculateProfileMetrics({
    username: 'viral', followers: 11528, dataSource: 'api',
    posts: reelPosts(Array.from({ length: 6 }, () => [2200000, 11486, 123]))
  });
  assert.equal(Core.assessProfileQuality(crazy).level, 'warn', 'V.R. of 19,000% must be flagged');
  const fine = Core.calculateProfileMetrics({
    username: 'normal', followers: 373760, dataSource: 'api',
    posts: reelPosts(Array.from({ length: 6 }, () => [120000, 78000, 870]))
  });
  assert.equal(Core.assessProfileQuality(fine).level, 'ok');
  console.log('   ✓ data-quality flags');

  // 3. Manual edit: per-reel corrections + exclusion recompute everything
  const edited = Core.recalculateProfileMetrics(metrics, {
    followers: '166,676',
    reels: metrics.reels.map((r, i) => (i === 0 ? { ...r, views: '180K' } : i === 2 ? { ...r, excluded: true } : r)),
    pricePerReel: '20M',
    contactInfo: '+98 912 000 0000'
  });
  assert.equal(edited.avgViews, 165000, '(180K + 150K) / 2 with reel 3 excluded');
  assert.equal(edited.avgLikes, 22000);
  assert.equal(edited.postsAnalyzed, 2);
  assert.equal(edited.vrFormatted, '98.99%');
  assert.equal(edited.contactInfo, '+98 912 000 0000');
  assert.equal(edited.pricePerReel, '20M');
  assert.equal(edited.manuallyEdited, true);
  assert.equal(Core.assessProfileQuality(edited).level, 'ok', 'an edited row is no longer flagged');

  // Direct averages win over reels; legacy rows without reels still edit fine
  const legacy = { username: 'old_row', followers: 1000, avgViews: 0, avgLikes: 0, avgComments: 0 };
  const legacyEdited = Core.recalculateProfileMetrics(legacy, { avgViews: '1.2K', avgLikes: '100', avgComments: '10' });
  assert.equal(legacyEdited.avgViews, 1200);
  assert.equal(legacyEdited.erFormatted, '11.00%');
  assert.equal(legacyEdited.vrFormatted, '120.00%');
  assert.equal(legacyEdited.likesPerComment, 10);
  console.log('   ✓ manual edits recalculate ER / V.R. / LPC');

  // 4. A fresh re-scrape replaces metrics but keeps Price/REEL and ID/Phone
  const merged = Core.deduplicateProfiles([edited, { ...fine, username: 'gallery_mahshid', pricePerReel: '', contactInfo: '' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].contactInfo, '+98 912 000 0000');
  assert.equal(merged[0].pricePerReel, '20M');
  assert.equal(merged[0].manuallyEdited, false, 'a re-scrape clears the edited flag');
  assert.equal(merged[0].avgViews, fine.avgViews);
  console.log('   ✓ re-scrape keeps Price/REEL + ID/Phone');

  // 5. Exports & sheet rows carry the ID/Phone column
  const csv = Core.generateCsvContent([edited]);
  assert.ok(csv.split('\r\n')[0].endsWith('Price/REEL,ID/Phone'));
  assert.ok(csv.includes(',20M,"=""+98 912 000 0000"""'), 'phone must be exported as a text literal (no formula, no lost +)');
  const row = Core.formatProfileForSheetRow(edited, '', '');
  assert.equal(row.length, 10);
  assert.equal(row[9], "'+98 912 000 0000", 'leading apostrophe keeps Google Sheets from evaluating +98...');
  assert.equal(Core.formatProfileForSheetRow(edited, '', 'typed_in_sheet')[9], 'typed_in_sheet', 'sheet value wins');
  const plan = Core.planGoogleSheetSync(
    [Core.SHEET_COLUMNS, ['gallery_mahshid', 1, '', '', '', '', '', '', '$9', '@sheet_id']],
    [edited]
  );
  assert.equal(plan.updates[0].range, 'A2:J2');
  assert.equal(plan.updates[0].values[8], '$9');
  assert.equal(plan.updates[0].values[9], "'@sheet_id");
  console.log('   ✓ CSV / sheet rows include ID/Phone');

  // 6. Apps Script keeps ID/Phone (including from deleted duplicate rows)
  const code = Core.generateGoogleAppsScriptCode('https://docs.google.com/spreadsheets/d/X/edit', 'tok');
  const rows = [
    Core.SHEET_COLUMNS.slice(),
    ['alice', 1, '', '', '', '', '', '', '', ''],
    ['alice', 1, '', '', '', '', '', '', '', '@alice_mgr']
  ];
  const sandbox = {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openByUrl: () => ({ getSheets: () => [makeSheet(rows)], getSheetByName: () => makeSheet(rows) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ _text: t, setMimeType() { return this; } }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const out = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ token: 'tok', profiles: [{ ...fine, username: 'alice' }, { ...edited, username: 'bob' }] }) } })._text);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(rows[0][9], 'ID/Phone');
  const alice = rows.find((r) => String(r[0]).includes('"alice"'));
  const bob = rows.find((r) => String(r[0]).includes('"bob"'));
  assert.equal(alice[9], "'@alice_mgr", 'ID/Phone merged from the deleted duplicate row must be kept');
  assert.equal(bob[9], "'+98 912 000 0000");
  console.log('   ✓ Apps Script writes and preserves ID/Phone');

  console.log('\n=== All v1.2.0 feature tests passed ===');
}

run();
