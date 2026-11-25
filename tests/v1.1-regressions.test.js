/**
 * Regression tests for the Crow Scrapper v1.1.0 bug-fix release.
 * Run: node tests/v1.1-regressions.test.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const Core = require('../src/core.js');

function makeMockSheet(rows) {
  return {
    rows,
    getLastRow() {
      return rows.length;
    },
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
            const rowArr = rows[row - 1 + r] || [];
            out.push(rowArr.slice(col - 1, col - 1 + numCols).map((v) => (String(v || '').startsWith('=') ? v : '')));
          }
          return out;
        },
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowArr = rows[row - 1 + r] || [];
            out.push(rowArr.slice(col - 1, col - 1 + numCols));
          }
          return out;
        }
      };
    },
    deleteRow(n) {
      rows.splice(n - 1, 1);
    },
    appendRow(vals) {
      rows.push(vals.slice());
    }
  };
}

function loadAppsScript(code, sheet, openedUrls) {
  const sandbox = {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      openByUrl: (url) => {
        openedUrls.push(url);
        return { getSheets: () => [sheet], getSheetByName: () => sheet };
      },
      getActiveSpreadsheet: () => ({ getSheets: () => [sheet], getSheetByName: () => sheet })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(str) {
        return { _text: str, setMimeType() { return this; } };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function post(sandbox, payload) {
  return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(payload) } })._text);
}

const profile = (username, extra = {}) => ({
  username,
  followers: 10000,
  er: 5,
  erFormatted: '5.00%',
  vr: 20,
  vrFormatted: '20.00%',
  avgViews: 2000,
  avgViewsFormatted: '2K',
  avgLikes: 450,
  avgComments: 50,
  likesPerComment: 9,
  pricePerReel: '',
  ...extra
});

async function run() {
  console.log('Crow Scrapper v1.1.0 regression tests');

  // 1. Locale number parsing
  const parseCases = [
    ['12,3 mil seguidores', 12300],
    ['1,2 mi', 1200000],
    ['3 millones', 3000000],
    ['١٫٥ مليون', 1500000],
    ['۱۲ هزار', 12000],
    ['2,4 млн', 2400000],
    ['15,6 тыс.', 15600],
    ['12,3 rb', 12300],
    ['1,2 jt', 1200000],
    ['373,760 followers', 373760],
    ['1.5M', 1500000]
  ];
  for (const [input, expected] of parseCases) {
    assert.equal(Core.parseCount(input), expected, `parseCount(${JSON.stringify(input)})`);
  }
  console.log('   ✓ locale count parsing');

  // 2. Average views ignore reels whose view count could not be read (0)
  const posts = Array.from({ length: 6 }, (_, i) => ({
    shortcode: `R${i}`,
    views: i === 5 ? 0 : 10000,
    likes: 1000,
    comments: 50,
    isReel: true,
    timestamp: 1700000000 - i * 1000
  }));
  const metrics = Core.calculateProfileMetrics({ username: 'avg_user', followers: 20000, posts });
  assert.equal(metrics.postsAnalyzed, 6);
  assert.equal(metrics.avgViews, 10000, 'unknown (0) views must not drag the average down');
  console.log('   ✓ AV VIEW excludes unknown view counts');

  // 3. CSV formula injection + XML-illegal characters
  const csv = Core.generateCsvContent([profile('pricey', { pricePerReel: '=HYPERLINK("http://evil","x")' })]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'formula-looking price must be neutralized');
  const xlsx = Core.generateXlsxBytes([profile('ctrl', { pricePerReel: 'a\u0001b\u0008c' })]);
  assert.ok(xlsx && xlsx.length > 0);
  console.log('   ✓ CSV/XLSX export escaping');

  // 4. Sheet rows: HYPERLINK is built from the validated username, sheet price wins
  const row = Core.formatProfileForSheetRow(
    profile('safe.user', { profileUrl: 'https://evil.example/"),HACK("' , pricePerReel: '$100' }),
    '$250'
  );
  assert.equal(row[0], '=HYPERLINK("https://www.instagram.com/safe.user/", "safe.user")');
  assert.equal(row[8], '$250', 'price typed in the sheet must win');
  console.log('   ✓ sheet row formula & price precedence');

  // 5. Apps Script: token required, target sheet fixed, prices kept across duplicate removal
  const TOKEN = 'abc123token';
  const code = Core.generateGoogleAppsScriptCode('https://docs.google.com/spreadsheets/d/OWNER_SHEET/edit', TOKEN);
  const rows = [
    ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL'],
    ['alice', 1, '', '', '', '', '', '', ''],
    ['alice', 1, '', '', '', '', '', '', '$500'],
    ['bob', 1, '', '', '', '', '', '', 0]
  ];
  const opened = [];
  const sandbox = loadAppsScript(code, makeMockSheet(rows), opened);

  const denied = post(sandbox, { token: 'wrong', profiles: [profile('mallory')] });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /Unauthorized/);
  assert.equal(rows.length, 4, 'unauthorized request must not touch the sheet');

  const ok = post(sandbox, {
    token: TOKEN,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SOMEONE_ELSES_SHEET/edit',
    profiles: [profile('alice'), profile('bob'), profile('bad"name')]
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.ok(opened.every((u) => u.includes('OWNER_SHEET')), 'payload.sheetUrl must be ignored');
  assert.equal(ok.duplicateRowsRemoved, 1);
  const alice = rows.find((r) => String(r[0]).includes('"alice"'));
  assert.equal(alice[8], '$500', 'price merged from the deleted duplicate row must be kept');
  const bob = rows.find((r) => String(r[0]).includes('"bob"'));
  assert.equal(bob[8], '0', 'a numeric 0 price must be kept');
  assert.ok(!rows.some((r) => String(r[0]).includes('bad')), 'invalid usernames must be skipped');

  // Row 1 that isn't ours is never overwritten
  const foreignRows = [['Budget', 'Q1'], ['x', 1]];
  const sandbox2 = loadAppsScript(code, makeMockSheet(foreignRows), []);
  const refused = post(sandbox2, { token: TOKEN, profiles: [profile('alice')] });
  assert.equal(refused.ok, false);
  assert.equal(foreignRows[0][0], 'Budget');
  console.log('   ✓ Apps Script token, fixed target, price merge, header guard');

  // 6. Web App mode: token sent; non-JSON (HTML error page) response is a failure
  let sentBody = null;
  const htmlRes = await Core.syncProfilesToGoogleSheet(
    [profile('alice')],
    { webAppUrl: 'https://script.google.com/macros/s/X/exec', syncToken: TOKEN },
    async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    }
  );
  assert.equal(sentBody.token, TOKEN);
  assert.equal(htmlRes.ok, false, 'HTML response must not be reported as a successful sync');
  console.log('   ✓ Web App token + non-JSON response handling');

  // 7. Sheets API mode reports duplicates it found instead of claiming none
  const apiRes = await Core.syncProfilesToGoogleSheet(
    [profile('alice')],
    { sheetUrl: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit', accessToken: 'ya29.x' },
    async (_url, init) => {
      if (!init || init.method === 'GET' || !init.method) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ values: [Core.SHEET_COLUMNS, ['alice', 1], ['ALICE', 1]] })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  );
  assert.equal(apiRes.ok, true);
  assert.equal(apiRes.duplicateRowsFound, 1);
  console.log('   ✓ Sheets API duplicate reporting');

  console.log('\n=== All v1.1.0 regression tests passed ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
