/**
 * Headless Chrome test for reading Reel tiles when Instagram's API is unavailable
 * (the "page tiles" fallback). Reproduces the @artin_vah case where every reel's view count was
 * misread as a number smaller than its likes (views showed 0 / V.R. 0.00%).
 * Run: node tests/tile-reading-e2e.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// The 6 newest reels of the screenshot: [badge, likes, comments]
const REELS = [
  ['255K', '20.6K', '853'],
  ['315K', '22.7K', '143'],
  ['263K', '22.7K', '171'],
  ['513K', '32.9K', '218'],
  ['183K', '13K', '136'],
  ['467K', '32.3K', '339']
];

function run() {
  console.log('Running Headless Chrome tile-reading test (views before hover, likes/comments on hover)...');
  const src = (f) => path.resolve(__dirname, '../src', f).replace(/\\/g, '/');
  const testHtmlPath = path.join(__dirname, 'mock_tile_reading.html');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>tile reading test</title>
  <style>
    body { margin: 0; width: 1400px; background: #000; color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(3, 200px); gap: 4px; }
    .grid a { position: relative; display: block; width: 200px; height: 260px; background: #222; color: #fff; }
    .badge { position: absolute; left: 6px; bottom: 6px; display: flex; gap: 4px; }
    .overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 18px; }
    .hidden-until-hover { opacity: 0; }
    a:hover .hidden-until-hover, a.hovered .hidden-until-hover { opacity: 1; }
  </style>
</head>
<body>
  <header><section><h2>artin_vah</h2></section></header>
  <main>
    <div class="grid" id="grid-labeled"></div>
    <div class="grid" id="grid-unlabeled"></div>
    <div class="grid" id="grid-hidden"></div>
    <div class="grid" id="grid-three"></div>
    <div class="grid" id="grid-posts"></div>
  </main>
  <script src="file:///${src('core.js')}"></script>
  <script src="file:///${src('editor.js')}"></script>
  <script src="file:///${src('content.js')}"></script>
  <script>
    const REELS = ${JSON.stringify(REELS)};
    const EYE = '<svg aria-label="View count icon" width="16" height="16"><title>View count icon</title><path d="M0 0h16v16H0z"/></svg>';
    const HEART = '<svg aria-label="Like" width="16" height="16"><title>Like</title><path d="M0 0h16v16H0z"/></svg>';
    const BUBBLE = '<svg aria-label="Comment" width="16" height="16"><title>Comment</title><path d="M0 0h16v16H0z"/></svg>';

    function addTiles(gridId, prefix, build) {
      const grid = document.getElementById(gridId);
      REELS.forEach((r, i) => {
        const a = document.createElement('a');
        a.href = '/artin_vah/reel/' + prefix + i + 'xyzAB/';
        build(a, r);
        grid.appendChild(a);
      });
    }

    // A) Badge with an eye icon; overlay with heart / comment icons is rendered on hover.
    addTiles('grid-labeled', 'LAB', (a, [v, l, c]) => {
      a.innerHTML = '<div class="badge"><span>' + EYE + '</span><span><span>' + v + '</span></span></div>';
      a.addEventListener('mouseenter', () => {
        if (a.querySelector('.overlay')) return;
        a.insertAdjacentHTML('beforeend', '<div class="overlay"><ul style="display:contents"><li>' + HEART + '<span>' + l + '</span></li><li>' + BUBBLE + '<span>' + c + '</span></li></ul></div>');
      });
    });

    // B) No icon labels at all; overlay numbers (likes, comments) appear on hover, BEFORE the badge in DOM order.
    addTiles('grid-unlabeled', 'UNL', (a, [v, l, c]) => {
      a.innerHTML = '<div class="badge"><svg width="16" height="16"></svg><span>' + v + '</span></div>';
      a.addEventListener('mouseenter', () => {
        if (a.querySelector('.overlay')) return;
        a.insertAdjacentHTML('afterbegin', '<div class="overlay"><div><svg width="16" height="16"></svg><span>' + l + '</span></div><div><svg width="16" height="16"></svg><span>' + c + '</span></div></div>');
      });
    });

    // C) Overlay is always in the DOM but invisible until hover (opacity 0).
    addTiles('grid-hidden', 'HID', (a, [v, l, c]) => {
      a.innerHTML = '<div class="overlay hidden-until-hover"><span>' + l + '</span><span>' + c + '</span></div>' +
        '<div class="badge"><svg width="16" height="16"></svg><span>' + v + '</span></div>';
      a.addEventListener('mouseenter', () => a.classList.add('hovered'));
      a.addEventListener('mouseleave', () => a.classList.remove('hovered'));
    });

    // D) Overlay shows all three numbers unlabeled in the order [likes, comments, views].
    addTiles('grid-three', 'THR', (a, [v, l, c]) => {
      a.innerHTML = '<div class="thumb"></div>';
      a.addEventListener('mouseenter', () => {
        if (a.querySelector('.overlay')) return;
        a.insertAdjacentHTML('beforeend', '<div class="overlay"><span>' + l + '</span><span>' + c + '</span><span>' + v + '</span></div>');
      });
    });

    // E) Main POSTS grid (what you see when you open a profile): reel tiles show NO numbers until
    //    hover; a "Clip" icon sits in the corner; the overlay's like icon is a sprite <span> and the
    //    comment icon an unlabeled <svg>. The old reader took the number next to that svg (the
    //    comments) as the view count — exactly the @artin_vah failure.
    addTiles('grid-posts', 'PST', (a, [v, l, c]) => {
      a.innerHTML = '<div class="thumb"></div><div style="position:absolute;top:6px;right:6px"><svg aria-label="Clip" width="16" height="16"><title>Clip</title><path d="M0 0h16v16H0z"/></svg></div>';
      a.addEventListener('mouseover', () => {
        if (a.querySelector('.overlay')) return;
        a.insertAdjacentHTML('beforeend', '<div class="overlay"><div><span class="sprite-heart" style="display:inline-block;width:14px;height:14px"></span><span>' + l + '</span></div><div><svg width="16" height="16"><path d="M0 0h16v16H0z"/></svg><span>' + c + '</span></div></div>');
      });
      a.addEventListener('mouseout', () => { const o = a.querySelector('.overlay'); if (o) o.remove(); });
    });

    window.addEventListener('load', async () => {
      const out = { ok: true };
      try {
        const api = window.InstaScraperContent;
        for (const gridId of ['grid-labeled', 'grid-unlabeled', 'grid-hidden', 'grid-three', 'grid-posts']) {
          const anchors = Array.from(document.querySelectorAll('#' + gridId + ' a'));
          const postElements = anchors.map((el, i) => ({ el, shortcode: gridId + i, isPinned: false, isReel: true, isExplicitNonReel: false }));
          const res = await api.populateDomPostCountsViaHover(postElements, 6);
          out[gridId] = res.map((r) => [r.views, r.likes, r.comments]);
        }

        // Full scrape of the @artin_vah case: start on the POSTS grid, Instagram API rate-limited,
        // Reels tab content arrives 1.5 s after the click.
        window.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
        const mock = document.createElement('div');
        mock.innerHTML = '<header><h2>artin_vah</h2></header><main><div role="tablist"><a id="tab-posts" href="/artin_vah/">Posts</a><a id="tab-reels" href="/artin_vah/reels/">Reels</a></div><div class="grid" id="mock-grid"></div></main>';
        document.body.appendChild(mock);
        const mockGrid = mock.querySelector('#mock-grid');
        REELS.forEach(([v, l, c], i) => {
          const a = document.createElement('a');
          a.href = '/artin_vah/reel/REAL' + i + 'xyzAB/';
          a.innerHTML = '<div class="thumb"></div><div style="position:absolute;top:6px;right:6px"><svg aria-label="Clip" width="16" height="16"><title>Clip</title><path d="M0 0h16v16H0z"/></svg></div>';
          a.addEventListener('mouseover', () => {
            if (a.querySelector('.overlay')) return;
            a.insertAdjacentHTML('beforeend', '<div class="overlay"><div><span class="sprite-heart" style="display:inline-block;width:14px;height:14px"></span><span>' + l + '</span></div><div><svg width="16" height="16"><path d="M0 0h16v16H0z"/></svg><span>' + c + '</span></div></div>');
          });
          a.addEventListener('mouseout', () => { const o = a.querySelector('.overlay'); if (o) o.remove(); });
          mockGrid.appendChild(a);
        });
        mock.querySelector('#tab-reels').addEventListener('click', (ev) => {
          ev.preventDefault();
          out.reelsTabClicked = true;
          setTimeout(() => {
            mockGrid.innerHTML = REELS.map(([v], i) =>
              '<a href="/artin_vah/reel/REAL' + i + 'xyzAB/"><div class="thumb"></div><div class="badge"><svg aria-label="View count icon" width="16" height="16"><title>View count icon</title><path d="M0 0h16v16H0z"/></svg><span>' + v + '</span></div></a>'
            ).join('');
          }, 1500);
        });
        const full = await api.scrapeProfileData('artin_vah', mock, { excludeMostRecent: false });
        out.full = {
          avgViews: full.avgViews, avgLikes: full.avgLikes, avgComments: full.avgComments,
          vr: full.vrFormatted, postsAnalyzed: full.postsAnalyzed, dataSource: full.dataSource,
          apiNote: full.apiNote, suspect: full.reels.filter((r) => r.viewsSuspect).length
        };
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
      ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1400,1200', '--virtual-time-budget=10000', '--dump-dom', fileUrl],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    const match = dumped.match(/data-test-result="([^"]+)"/);
    assert.ok(match, 'Could not find data-test-result in dumped DOM');
    const result = JSON.parse(
      match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    );
    assert.equal(result.ok, true, `Tile test failed: ${result.error}`);

    const Core = require('../src/core.js');
    const expected = REELS.map(([v, l, c]) => [Core.parseCount(v), Core.parseCount(l), Core.parseCount(c)]);
    for (const gridId of ['grid-labeled', 'grid-unlabeled', 'grid-hidden', 'grid-three']) {
      assert.deepEqual(result[gridId], expected, `${gridId}: views must be the tile badge, likes/comments from the hover overlay`);
    }

    // End-to-end metric for the screenshot's profile (166,687 followers)
    // On the Posts grid the view count is simply not shown: it must be "unknown" (0), never the
    // comment count, so the Reels-tab step can fill it in.
    assert.deepEqual(
      result['grid-posts'],
      expected.map(([, l, c]) => [0, l, c]),
      'grid-posts: views must be unknown (0) — never the comment count'
    );

    // Full scrape: views from the Reels-tab badges, likes/comments from the Posts-grid hover.
    assert.equal(result.reelsTabClicked, true);
    assert.equal(result.full.postsAnalyzed, 6);
    assert.equal(result.full.avgLikes, 24033, 'same AV LIKE as the screenshot');
    assert.equal(result.full.avgComments, 310, 'same AV COMMENTS as the screenshot');
    assert.equal(result.full.avgViews, 332667, `AV VIEW must come from the badges (got ${result.full.avgViews})`);
    assert.equal(result.full.suspect, 0);
    assert.equal(result.full.dataSource, 'tiles');
    assert.match(result.full.apiNote, /429/);

    const metrics = Core.calculateProfileMetrics({
      username: 'artin_vah',
      followers: 166687,
      dataSource: 'tiles',
      posts: result['grid-unlabeled'].map(([views, likes, comments], i) => ({
        shortcode: `UNL${i}xyzAB`, views, likes, comments, isReel: true, hasViews: true, index: i
      }))
    });
    assert.ok(metrics.avgViews > 300000, `AV VIEW must come from the badges (got ${metrics.avgViews})`);
    assert.ok(metrics.vr > 100, `V.R. must no longer be 0.00% (got ${metrics.vrFormatted})`);
    assert.equal(metrics.reels.some((r) => r.viewsSuspect), false);
    console.log(`   [OK] Tile reading test passed — 5 tile layouts + full Posts-grid → Reels-tab scrape correct (artin_vah: AV VIEW ${metrics.avgViewsFormatted}, V.R. ${metrics.vrFormatted}).`);
  } finally {
    if (fs.existsSync(testHtmlPath)) fs.unlinkSync(testHtmlPath);
  }
}

run();
