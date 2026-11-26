/**
 * Headless Chrome test for the v1.2.0 in-page panel: top launcher icon, minimize-to-icon,
 * 11-column table with ID/Phone, inline saving, search, the shared edit dialog and quality flags.
 * Run: node tests/panel-ui-e2e.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Core = require('../src/core.js');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function reelPosts(list, prefix) {
  return list.map(([views, likes, comments], i) => ({
    code: `${prefix}${i}abcde`,
    play_count: views,
    like_count: likes,
    comment_count: comments,
    media_type: 2,
    product_type: 'clips',
    taken_at: 1700000000 - i * 86400
  }));
}

function seedProfiles() {
  return [
    Core.calculateProfileMetrics({
      username: 'mmd.fate',
      followers: 373760,
      dataSource: 'api',
      posts: reelPosts(Array.from({ length: 6 }, () => [120000, 78000, 870]), 'MMD')
    }),
    Core.calculateProfileMetrics({
      username: 'gallery_mahshid',
      followers: 166676,
      dataSource: 'tiles',
      posts: reelPosts([[308, 24000, 308]], 'GAL')
    }),
    { ...Core.calculateProfileMetrics({
      username: 'artin.vah',
      followers: 131840,
      dataSource: 'api',
      posts: reelPosts(Array.from({ length: 6 }, () => [753000, 6587, 139]), 'ART')
    }), pricePerReel: '30M' }
  ];
}

function run() {
  console.log('Running Headless Chrome panel UI test (launcher, minimize, ID/Phone, edit dialog)...');
  const src = (f) => path.resolve(__dirname, '../src', f).replace(/\\/g, '/');
  const testHtmlPath = path.join(__dirname, 'mock_panel_ui.html');
  const seed = JSON.stringify(seedProfiles());

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>panel ui test</title>
  <link rel="stylesheet" href="file:///${src('content.css')}" />
  <link rel="stylesheet" href="file:///${src('editor.css')}" />
  <style>body { margin: 0; width: 1500px; height: 900px; background: #000; } header { margin-bottom: 40px; }</style>
  <script>
    localStorage.clear();
    localStorage.setItem('ig_scraped_profiles', ${JSON.stringify(seed)});
    window.confirm = () => true;
  </script>
</head>
<body>
  <header><section><div id="header-row"><h2>mmd.fate</h2></div></section></header>
  <main><article><div><a href="/mmd.fate/reel/AAAAA1/">.</a></div></article></main>
  <script src="file:///${src('core.js')}"></script>
  <script src="file:///${src('editor.js')}"></script>
  <script src="file:///${src('content.js')}"></script>
  <script>
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.addEventListener('load', async () => {
      const out = { ok: true };
      try {
        await sleep(300);
        const panel = document.getElementById('ig-scraper-panel');
        const card = document.getElementById('ig-scraper-panel-body');
        const launcher = document.getElementById('crow-launcher');
        out.hasLauncher = Boolean(launcher);
        out.startsCollapsed = panel.classList.contains('ig-scraper-panel-collapsed') && getComputedStyle(card).display === 'none';
        const lr = launcher.getBoundingClientRect();
        out.launcherAtTop = lr.top < 80;
        out.launcherSmall = lr.width <= 50 && lr.height <= 50;
        out.launcherBadge = document.getElementById('crow-launcher-badge').textContent;
        out.badgeWarn = document.getElementById('crow-launcher-badge').classList.contains('crow-launcher-badge-warn');

        launcher.click();
        await sleep(250);
        out.expandedAfterClick = !panel.classList.contains('ig-scraper-panel-collapsed') && getComputedStyle(card).display !== 'none';
        const cr = card.getBoundingClientRect();
        out.cardBelowLauncher = cr.top >= lr.bottom;
        out.cardInViewport = cr.left >= 0 && cr.right <= window.innerWidth;
        out.headerGap = Math.round(document.querySelector('.crow-toolbar').getBoundingClientRect().top - document.querySelector('.crow-card-head').getBoundingClientRect().bottom);

        // ---- Resizable window ----
        const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' }));
        const drag = async (el, dx, dy) => {
          const hr = el.getBoundingClientRect();
          const x = hr.left + hr.width / 2;
          const y = hr.top + hr.height / 2;
          fire(el, 'pointerdown', x, y);
          fire(el, 'pointermove', x + dx / 2, y + dy / 2);
          fire(el, 'pointermove', x + dx, y + dy);
          fire(el, 'pointerup', x + dx, y + dy);
          await sleep(20);
        };
        const prefsNow = () => JSON.parse(localStorage.getItem('crow_panel_prefs') || '{}');
        const wHandle = card.querySelector('[data-resize="x"]');
        const hHandle = card.querySelector('[data-resize="y"]');
        const cornerHandle = card.querySelector('[data-resize="xy"]');
        out.hasResizeHandles = Boolean(wHandle && hHandle && cornerHandle);
        const r0 = card.getBoundingClientRect();
        out.defaultWidth = Math.round(r0.width);
        out.handleOnLeftEdge = Math.abs(wHandle.getBoundingClientRect().left - r0.left) <= 1;
        out.handleOnBottomEdge = Math.abs(hHandle.getBoundingClientRect().bottom - r0.bottom) <= 1;

        // Icon is top-right: dragging the left edge to the right makes the window narrower; its right edge stays put.
        await drag(wHandle, 600, 0);
        const r1 = card.getBoundingClientRect();
        out.widthAfterDrag = Math.round(r1.width);
        out.rightEdgeKept = Math.abs(r1.right - r0.right) <= 1;
        out.narrowClass = card.classList.contains('crow-card-narrow');
        out.narrowHeadWraps = getComputedStyle(document.querySelector('.crow-card-head')).flexWrap;
        out.tableScrollsInside = getComputedStyle(document.querySelector('.crow-table-wrap')).overflowX;
        out.cardStillInViewport = r1.left >= 0 && r1.right <= window.innerWidth;

        // Bottom edge up by 120px → shorter window that keeps its top under the icon.
        await drag(hHandle, 0, -120);
        const r2 = card.getBoundingClientRect();
        out.heightShrunkBy = Math.round(r1.height - r2.height);
        out.topKept = Math.abs(r2.top - r1.top) <= 1;
        out.sizedClass = card.classList.contains('crow-card-sized');
        await sleep(350);
        out.savedSize = { width: prefsNow().width, height: prefsNow().height };
        out.savedHeightMatches = prefsNow().height === Math.round(r2.height);

        // Corner dragged far past the screen edges → clamped to the screen, and the clamped size is stored.
        await drag(cornerHandle, -3000, 3000);
        const r3 = card.getBoundingClientRect();
        out.clampedWidth = Math.round(r3.width);
        out.viewportWidth = window.innerWidth;
        out.clampedInViewport = r3.left >= 0 && r3.right <= window.innerWidth && r3.bottom <= window.innerHeight;
        out.clampedHeightIsMax = Math.round(r3.height) === Math.round(parseFloat(card.style.maxHeight));
        await sleep(350);
        out.savedClampedWidth = prefsNow().width;

        // Double-click resets to the automatic size.
        wHandle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        hHandle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        await sleep(350);
        out.widthAfterReset = Math.round(card.getBoundingClientRect().width);
        out.heightStyleAfterReset = card.style.height;
        out.savedAfterReset = { width: prefsNow().width, height: prefsNow().height };

        // Keyboard: arrow away from the icon grows the window, Enter resets.
        wHandle.focus();
        wHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        wHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        wHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        out.widthAfterKeys = Math.round(card.getBoundingClientRect().width);
        wHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        out.widthAfterEnter = Math.round(card.getBoundingClientRect().width);

        // Placement rules (pure function): icon on the left half → window lines up with its left edge; low icon → opens upward.
        const geo = window.InstaScraperContent.computeCardGeometry;
        const g1 = geo({ left: 40, right: 86, top: 16, bottom: 62, width: 46, height: 46 }, 1500, 900, { width: 700, height: 0 });
        out.leftAnchored = { anchorRight: g1.anchorRight, left: g1.left, width: g1.width };
        const g2 = geo({ left: 1400, right: 1446, top: 800, bottom: 846, width: 46, height: 46 }, 1500, 900, { width: 9999, height: 9999 });
        out.lowIcon = { openUp: g2.openUp, width: g2.width, heightIsMax: g2.height === g2.maxHeight, bottom: g2.bottom };
        const g3 = geo({ left: 1400, right: 1446, top: 16, bottom: 62, width: 46, height: 46 }, 1500, 900, { width: 50, height: 20 });
        out.minSize = { width: g3.width, height: g3.height };
        out.headers = Array.from(document.querySelectorAll('#ig-scraper-table thead th')).map((th) => th.textContent.trim());
        out.warnRows = Array.from(document.querySelectorAll('#ig-scraper-tbody tr.crow-row-warn a.ig-scraper-user-link')).map((a) => a.textContent);
        out.hasCheckButton = Boolean(document.querySelector('#ig-scraper-tbody [data-action="check"]'));
        out.summary = document.getElementById('crow-foot-summary').textContent;

        // Inline ID/Phone save + search
        const contact = document.querySelector('input[aria-label="ID or phone number for artin.vah"]');
        contact.focus();
        contact.value = '+98 912 555 0000';
        contact.dispatchEvent(new Event('input', { bubbles: true }));
        contact.dispatchEvent(new Event('change', { bubbles: true }));
        contact.blur();
        await sleep(300);
        out.storedContact = JSON.parse(localStorage.getItem('ig_scraped_profiles')).find((p) => p.username === 'artin.vah').contactInfo;
        const search = document.getElementById('crow-search');
        search.value = '555';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(50);
        out.searchHits = Array.from(document.querySelectorAll('#ig-scraper-tbody a.ig-scraper-user-link')).map((a) => a.textContent);
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(50);

        // Edit dialog: fix the suspicious row through its reel
        document.querySelector('#ig-scraper-tbody [data-action="edit"][data-username="gallery_mahshid"]').click();
        await sleep(250);
        const overlay = document.querySelector('.crow-ed-overlay');
        out.editorOpened = Boolean(overlay);
        out.editorWarnings = overlay ? overlay.querySelectorAll('.crow-ed-warn li').length : 0;
        const reelViews = overlay.querySelector('input[aria-label="Reel 1 views"]');
        reelViews.value = '180K';
        reelViews.dispatchEvent(new Event('input', { bubbles: true }));
        out.previewVr = Array.from(overlay.querySelectorAll('.crow-ed-chip')).map((c) => c.textContent)[1];
        Array.from(overlay.querySelectorAll('button')).find((b) => b.textContent === 'Save changes').click();
        await sleep(400);
        out.editorClosed = !document.querySelector('.crow-ed-overlay');
        const saved = JSON.parse(localStorage.getItem('ig_scraped_profiles')).find((p) => p.username === 'gallery_mahshid');
        out.savedAvgViews = saved.avgViews;
        out.savedVr = saved.vrFormatted;
        out.savedEdited = saved.manuallyEdited;
        out.editedBadge = Boolean(Array.from(document.querySelectorAll('#ig-scraper-tbody .crow-flag-edited')).length);
        out.warnRowsAfterEdit = document.querySelectorAll('#ig-scraper-tbody tr.crow-row-warn').length;

        // Minimize back to the icon (button + Escape)
        document.getElementById('ig-scraper-expand-btn').click();
        await sleep(400);
        out.collapsedAfterMinimize = panel.classList.contains('ig-scraper-panel-collapsed');
        out.prefsExpanded = JSON.parse(localStorage.getItem('crow_panel_prefs') || '{}').expanded;
        launcher.click();
        await sleep(100);
        document.getElementById('crow-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(100);
        out.collapsedAfterEscape = panel.classList.contains('ig-scraper-panel-collapsed');

        // A pending fresh re-scrape for ANOTHER profile is discarded, not run here
        localStorage.setItem('crow_pending_rescrape', JSON.stringify({ username: 'someone_else', at: Date.now() }));
        await window.InstaScraperContent.runPendingRescrapeIfAny(document);
        out.pendingCleared = localStorage.getItem('crow_pending_rescrape') === 'null';
      } catch (err) {
        out.ok = false;
        out.error = err && err.stack ? err.stack : String(err);
      }
      document.body.setAttribute('data-test-result', JSON.stringify(out));
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(testHtmlPath, html, 'utf8');
  try {
    const fileUrl = 'file:///' + testHtmlPath.replace(/\\/g, '/');
    const dumped = execFileSync(
      CHROME_PATH,
      ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1500,900', '--virtual-time-budget=8000', '--dump-dom', fileUrl],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    const match = dumped.match(/data-test-result="([^"]+)"/);
    assert.ok(match, 'Could not find data-test-result in dumped DOM');
    const result = JSON.parse(
      match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    );
    assert.equal(result.ok, true, `Panel test failed: ${result.error}`);
    assert.equal(result.hasLauncher, true);
    assert.equal(result.startsCollapsed, true, 'Panel must start minimized as just the icon');
    assert.equal(result.launcherAtTop, true, 'Launcher icon must sit at the top of the screen');
    assert.equal(result.launcherSmall, true, 'Minimized state must be a small icon, not a bar');
    assert.equal(result.launcherBadge, '3');
    assert.equal(result.badgeWarn, true, 'Badge turns orange when a row needs a check');
    assert.equal(result.expandedAfterClick, true);
    assert.equal(result.cardBelowLauncher, true, 'List must open below the top icon');
    assert.equal(result.cardInViewport, true);
    assert.ok(Math.abs(result.headerGap) <= 1, `No gap between header and toolbar even with page CSS on <header> (got ${result.headerGap}px)`);
    // Resizable window
    assert.equal(result.hasResizeHandles, true, 'Edge + corner resize handles exist');
    assert.equal(result.defaultWidth, 1280, 'Automatic width is unchanged (min(1280, screen))');
    assert.equal(result.handleOnLeftEdge, true, 'Width handle sits on the edge away from the icon');
    assert.equal(result.handleOnBottomEdge, true, 'Height handle sits on the bottom edge when the list opens downward');
    assert.equal(result.widthAfterDrag, 680, `Dragging the left edge 600px right gives 680px (got ${result.widthAfterDrag})`);
    assert.equal(result.rightEdgeKept, true, 'The window stays attached to the icon while resizing');
    assert.equal(result.narrowClass, true);
    assert.equal(result.narrowHeadWraps, 'wrap', 'Header wraps in a narrow window');
    assert.equal(result.tableScrollsInside, 'auto');
    assert.equal(result.cardStillInViewport, true);
    assert.equal(result.heightShrunkBy, 120, `Bottom edge drag (got ${result.heightShrunkBy})`);
    assert.equal(result.topKept, true);
    assert.equal(result.sizedClass, true);
    assert.equal(result.savedSize.width, 680, 'Width is remembered');
    assert.equal(result.savedHeightMatches, true, `Height is remembered (${JSON.stringify(result.savedSize)})`);
    assert.equal(result.clampedWidth, result.viewportWidth - 24, `Width clamps to the screen (got ${result.clampedWidth}, screen ${result.viewportWidth})`);
    assert.equal(result.clampedInViewport, true);
    assert.equal(result.clampedHeightIsMax, true);
    assert.equal(result.savedClampedWidth, result.viewportWidth - 24, 'The clamped (shown) size is what gets stored');
    assert.equal(result.widthAfterReset, 1280, 'Double-click resets the width');
    assert.equal(result.heightStyleAfterReset, '', 'Double-click resets the height to automatic');
    assert.deepEqual(result.savedAfterReset, { width: 0, height: 0 });
    assert.equal(result.widthAfterKeys, 1256, `Arrow keys resize by 24px (got ${result.widthAfterKeys})`);
    assert.equal(result.widthAfterEnter, 1280, 'Enter resets');
    assert.deepEqual(result.leftAnchored, { anchorRight: false, left: 40, width: 700 });
    assert.deepEqual(result.lowIcon, { openUp: true, width: 1476, heightIsMax: true, bottom: 110 });
    assert.deepEqual(result.minSize, { width: 420, height: 220 });
    assert.deepEqual(result.headers.slice(0, 10), [
      'USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL', 'ID/Phone'
    ]);
    assert.deepEqual(result.warnRows, ['gallery_mahshid']);
    assert.equal(result.hasCheckButton, true);
    assert.ok(result.summary.includes('3 profiles') && result.summary.includes('1 to check'), result.summary);
    assert.equal(result.storedContact, '+98 912 555 0000');
    assert.deepEqual(result.searchHits, ['artin.vah'], 'Search must find the ID/Phone typed a moment ago');
    assert.equal(result.editorOpened, true);
    assert.ok(result.editorWarnings >= 2);
    assert.ok(result.previewVr.includes('107.99%'), `Live preview V.R. (got ${result.previewVr})`);
    assert.equal(result.editorClosed, true);
    assert.equal(result.savedAvgViews, 180000);
    assert.equal(result.savedVr, '107.99%');
    assert.equal(result.savedEdited, true);
    assert.equal(result.editedBadge, true);
    assert.equal(result.warnRowsAfterEdit, 0);
    assert.equal(result.collapsedAfterMinimize, true);
    assert.equal(result.prefsExpanded, false, 'Minimized state must be remembered');
    assert.equal(result.collapsedAfterEscape, true, 'Esc must minimize the panel');
    assert.equal(result.pendingCleared, true);
    console.log('   [OK] Panel UI test passed (top icon, resizable window, minimize, 11 columns + ID/Phone, search, edit dialog, Esc).');
  } finally {
    if (fs.existsSync(testHtmlPath)) fs.unlinkSync(testHtmlPath);
  }
}

run();
