const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function runHeadlessChromeTest() {
  console.log('Running Headless Chrome E2E Test on simulated Instagram Profile DOM...');

  const corePath = path.resolve(__dirname, '../src/core.js').replace(/\\/g, '/');
  const contentPath = path.resolve(__dirname, '../src/content.js').replace(/\\/g, '/');
  const cssPath = path.resolve(__dirname, '../src/content.css').replace(/\\/g, '/');

  // Create a realistic Instagram profile page with:
  // - <header> containing <h2>mmd.fate<svg aria-label="Verified"><title>Verified</title></svg></h2>
  // - Adjacent spaceless follower spans: <li><span title="373,760">373K</span><span>followers</span></li>
  // - <main> containing 3 PINNED posts:
  //   1) Pin icon as a sibling inside the tile wrapper <div> (outside <a>)
  //   2) Pushpin SVG <path d="m22.707 7.583..."> without English aria-label
  //   3) Localized aria-label="پست سنجاق‌شده"
  // - 6 Recent Non-Pinned Reels/posts with view counts (120,000 avg views -> V.R. 32.11% High):
  //   - Combined child aria-label="120,000 views, 78,010 likes, 876 comments"
  //   - Hover-populated post tile (view badge present before hover, likes/comments injected on mouseenter)
  // - 2 Older posts #7 and #8 (must be ignored)
  const testHtmlPath = path.join(__dirname, 'mock_ig_profile.html');
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>@mmd.fate • Instagram photos and videos</title>
  <link rel="stylesheet" href="file:///${cssPath}" />
</head>
<body>
  <header>
    <section>
      <div id="header-row" style="display: flex; align-items: center;">
        <h2>mmd.fate<svg aria-label="Verified"><title>Verified</title></svg></h2>
        <button type="button">Follow</button>
      </div>
      <ul>
        <li><span>142</span> posts</li>
        <li><span title="373,760">373K</span><span>followers</span></li>
        <li><span>120</span> following</li>
      </ul>
    </section>
  </header>

  <main>
    <article>
      <div class="modern-grid">
        <!-- 3 Pinned Posts (MUST BE IGNORED!) -->
        <div class="tile-wrapper">
          <a href="/mmd.fate/p/PINNED_1/">
            <ul><li>999,999</li><li>50,000</li></ul>
          </a>
          <div class="pin-overlay"><svg aria-label="Pinned post icon"><title>Pinned post icon</title></svg></div>
        </div>
        <div class="tile-wrapper">
          <a href="/p/PINNED_2/">
            <svg viewBox="0 0 24 24"><path d="m22.707 7.583-6.29-6.29a1 1 0 0 0-1.414 0"></path></svg>
            <ul><li>888,888</li><li>40,000</li></ul>
          </a>
        </div>
        <div class="tile-wrapper">
          <a href="/reel/PINNED_3/">
            <svg aria-label="پست سنجاق‌شده"></svg>
            <ul><li>777,777</li><li>30,000</li></ul>
          </a>
        </div>

        <!-- 2 Non-Pinned Photo Tiles Before Reels (MUST BE SKIPPED IN REELS-ONLY MODE & NOT CROWD OUT HOVER SLICE!) -->
        <div class="tile-wrapper"><a href="/p/NON_REEL_PHOTO_1/"><ul><li>500,000</li><li>10,000</li></ul></a></div>
        <div class="tile-wrapper"><a href="/p/NON_REEL_PHOTO_2/"><ul><li>400,000</li><li>9,000</li></ul></a></div>

        <!-- 6 Recent Non-Pinned Reels/Posts (MUST BE USED!) -->
        <div class="tile-wrapper"><a href="/reel/RECENT_1/" data-views="120,000"><ul><li>78,000</li><li>880</li></ul></a></div>
        <div class="tile-wrapper"><a href="/reel/RECENT_2/"><div aria-label="120K views, 78,010 likes, 876 comments"></div></a></div>
        <div class="tile-wrapper"><a href="/reel/RECENT_3/"><span class="view-count">120,000</span><ul><li>78,005</li><li>879</li></ul></a></div>
        <div class="tile-wrapper"><a href="/reel/RECENT_4/" data-view-count="120000"><ul><li>78,009</li><li>877</li></ul></a></div>
        <div class="tile-wrapper"><a href="/reel/RECENT_5/"><span>120K</span><ul><li>78,008</li><li>878</li></ul></a></div>
        <div class="tile-wrapper"><a href="/reel/RECENT_6/" id="hover-post"><span>120K</span></a></div>

        <!-- Older Posts #7 and #8 (MUST BE IGNORED!) -->
        <div class="tile-wrapper"><a href="/reel/OLDER_7/" data-views="10,000"><ul><li>1,000</li><li>10</li></ul></a></div>
        <div class="tile-wrapper"><a href="/reel/OLDER_8/" data-views="5,000"><ul><li>500</li><li>5</li></ul></a></div>
      </div>
    </article>
  </main>

  <script id="ssr-json" type="application/json">
    {"require":[["PolarisProfileStore",{"user":{"username":"ssr_user","follower_count":250000,"xdt_api__v1__clips__user__connection_v2":{"edges":[{"node":{"code":"SSR1","play_count":80000,"like_count":25000,"comment_count":500,"media_type":2,"product_type":"clips"}}]}}}]]}
  </script>

  <script>
    // Simulate React hover overlay rendering on #hover-post when hovered
    document.addEventListener('DOMContentLoaded', () => {
      const hoverPost = document.getElementById('hover-post');
      if (hoverPost) {
        hoverPost.addEventListener('mouseenter', () => {
          if (!hoverPost.querySelector('ul')) {
            hoverPost.innerHTML = '<ul><li>78,010</li><li>878</li></ul>';
          }
        });
      }
    });
  </script>
  <script src="file:///${corePath}"></script>
  <script src="file:///${contentPath}"></script>
  <script>
    window.addEventListener('load', async () => {
      try {
        const btn = document.getElementById('ig-scraper-profile-btn');
        if (!btn) {
          document.body.setAttribute('data-test-result', JSON.stringify({ ok: false, error: 'Button not injected' }));
          return;
        }
        // Verify button is placed right after <h2>mmd.fate...</h2>
        const h2 = document.querySelector('header h2');
        const isNextToName = h2 && h2.nextElementSibling === btn;

        // Click the button to trigger scraping
        await window.InstaScraperContent.handleScrapeButtonClick(btn, document);

        // Verify white crow logo is STILL present and decoded on the button immediately after scraping (before SPA navigation)
        const btnCrowAfterScrape = btn.querySelector('img.ig-scraper-crow-logo');
        const hasBtnCrowAfterScrape = Boolean(
          btnCrowAfterScrape &&
          btnCrowAfterScrape.getAttribute('src') &&
          btnCrowAfterScrape.complete &&
          btnCrowAfterScrape.naturalWidth > 0
        );

        // Verify clicking the "by @mhrshadfm" owner pill in the panel header does NOT collapse the expanded panel
        // and does NOT bubble up to document-level SPA click interceptors
        const panelEl = document.getElementById('ig-scraper-panel');
        const ownerPillInitial = document.querySelector('#ig-scraper-panel a.ig-scraper-owner-pill');
        const wasExpandedBeforeOwnerClick = Boolean(panelEl && !panelEl.classList.contains('ig-scraper-panel-collapsed'));
        let ownerClickBubbledToDoc = false;
        const docClickSpy = () => { ownerClickBubbledToDoc = true; };
        document.addEventListener('click', docClickSpy);
        if (ownerPillInitial) {
          const synthClick = new MouseEvent('click', { bubbles: true, cancelable: true });
          synthClick.preventDefault(); // prevent actual navigation in headless test while testing propagation & toggle
          ownerPillInitial.dispatchEvent(synthClick);
        }
        document.removeEventListener('click', docClickSpy);
        const remainedExpandedAfterOwnerClick = Boolean(panelEl && !panelEl.classList.contains('ig-scraper-panel-collapsed'));

        // Upsert duplicate with different casing to verify strict deduplication in storage
        await window.InstaScraperContent.upsertProfileRecord({
          ...(await window.InstaScraperContent.getStoredProfiles())[0],
          username: '@MMD.FATE'
        });

        const stored = await window.InstaScraperContent.getStoredProfiles();
        const linkEl = document.querySelector('#ig-scraper-tbody a.ig-scraper-user-link');
        const avViewCellEl = document.querySelector('#ig-scraper-tbody tr td:nth-child(5)');
        const tableHeaders = Array.from(document.querySelectorAll('#ig-scraper-table thead th'))
          .slice(0, 9)
          .map((th) => th.textContent.trim());
        const priceInput = document.querySelector('#ig-scraper-tbody input.ig-scraper-price-input');

        // Verify extractCountsFromDomPostTile with Million-viewed Reel tiles:
        // Case A: Reel with /p/ href, Unicode BiDi marks around "1.5M", and SVG sibling inside span before hover
        const millionTile1 = document.createElement('a');
        millionTile1.setAttribute('href', '/mmd.fate/p/MILLION_REEL_1/');
        millionTile1.innerHTML = '<span><svg aria-label="Clip"></svg>\u20661.5M\u2069</span>';
        const mCounts1 = window.InstaScraperContent.extractCountsFromDomPostTile(millionTile1);

        // Case B: Hovered Reel where thumbnail view badge "2.4M" appears BEFORE hover overlay spans "45K" (likes) and "800" (comments) without <ul>
        const millionTile2 = document.createElement('a');
        millionTile2.setAttribute('href', '/reel/MILLION_REEL_2/');
        millionTile2.innerHTML = '<div class="thumb-badge"><span>\u200e2.4M\u200f</span></div><div class="hover-overlay"><span>45K</span><span>800</span></div>';
        const mCounts2 = window.InstaScraperContent.extractCountsFromDomPostTile(millionTile2);

        // Case C: Hovered Comet Reel where <svg aria-label="Like">, <svg aria-label="Comment">, and <svg aria-label="Play"> precede sibling <span> counts
        const millionTile3 = document.createElement('a');
        millionTile3.setAttribute('href', '/p/MILLION_REEL_3/');
        millionTile3.innerHTML = '<div class="hover-overlay"><div><svg aria-label="Like"></svg><span>45K</span></div><div><svg aria-label="Comment"></svg><span>800</span></div></div><div class="view-badge"><svg aria-label="Play"></svg><span>1.5M</span></div>';
        const mCounts3 = window.InstaScraperContent.extractCountsFromDomPostTile(millionTile3);

        // Verify SSR JSON script extraction
        const ssrExtracted = window.InstaScraperContent.extractDataFromEmbeddedScripts('ssr_user', document);

        // Verify fetchFromInstagramApi when web_profile_info has 6 Reels with legacy thousand-level video_view_count (184,392)
        // and clips/user fails -> MUST still fetch /api/v1/feed/user/ to get true Million play_count (1,542,891 -> 1.5M)!
        const origFetch = window.fetch;
        window.fetch = async (url) => {
          if (String(url).includes('web_profile_info')) {
            return {
              ok: true,
              json: async () => ({
                data: {
                  user: {
                    id: '111222333',
                    follower_count: 500000,
                    edge_owner_to_timeline_media: {
                      edges: Array.from({ length: 6 }, (_, idx) => ({
                        node: {
                          shortcode: 'M_REEL_' + idx,
                          is_video: true,
                          product_type: 'clips',
                          video_view_count: 184392, // Legacy thousand-level feed view count!
                          edge_media_preview_like: { count: 85000 },
                          edge_media_to_comment: { count: 1200 }
                        }
                      }))
                    }
                  }
                }
              })
            };
          }
          if (String(url).includes('/api/v1/clips/user/')) {
            return { ok: false, status: 400 };
          }
          if (String(url).includes('/api/v1/feed/user/')) {
            return {
              ok: true,
              json: async () => ({
                items: Array.from({ length: 6 }, (_, idx) => ({
                  code: 'M_REEL_' + idx,
                  play_count: 1542891, // True Million play_count (1.5M)!
                  video_view_count: 184392,
                  like_count: 85000,
                  comment_count: 1200,
                  media_type: 2,
                  product_type: 'clips'
                }))
              })
            };
          }
          return { ok: false };
        };
        const millionApiFetched = await window.InstaScraperContent.fetchFromInstagramApi('million_api_user', new Set());
        const millionApiMetrics = window.InstaScraperCore.calculateProfileMetrics({
          username: 'million_api_user',
          followers: millionApiFetched.followers,
          posts: millionApiFetched.posts
        });

        // Verify scrapeProfileData auto-clicking the Reels tab when web_profile_info only has legacy video_view_count
        // and both /api/v1/clips/user/ and /api/v1/feed/user/ fail while starting on the main Posts tab:
        window.fetch = async (url) => {
          if (String(url).includes('web_profile_info')) {
            return {
              ok: true,
              json: async () => ({
                data: {
                  user: {
                    id: '444555666',
                    follower_count: 600000,
                    edge_owner_to_timeline_media: {
                      edges: Array.from({ length: 6 }, (_, idx) => ({
                        node: {
                          shortcode: 'TAB_REEL_' + idx,
                          is_video: true,
                          product_type: 'clips',
                          video_view_count: 184392, // Thousand-level legacy feed view count
                          edge_media_preview_like: { count: 90000 },
                          edge_media_to_comment: { count: 1500 }
                        }
                      }))
                    }
                  }
                }
              })
            };
          }
          return { ok: false, status: 429 };
        };
        const mockRootDoc = document.createElement('div');
        mockRootDoc.innerHTML = \`
          <header><h2>reels_tab_user</h2></header>
          <main>
            <div role="tablist"><a id="mock-reels-tab" href="/reels_tab_user/reels/">Reels</a></div>
            <div id="mock-grid">
              \${Array.from({ length: 6 }, (_, idx) => \`<a href="/p/TAB_REEL_\${idx}/"><svg aria-label="Clip"></svg></a>\`).join('')}
            </div>
          </main>
        \`;
        let reelsTabClicked = false;
        mockRootDoc.querySelector('#mock-reels-tab').addEventListener('click', (ev) => {
          ev.preventDefault();
          reelsTabClicked = true;
          mockRootDoc.querySelector('#mock-grid').innerHTML = Array.from(
            { length: 6 },
            (_, idx) => \`<a href="/reels_tab_user/reel/TAB_REEL_\${idx}/"><div><svg aria-label="Play"></svg><span>1.8M</span></div></a>\`
          ).join('');
        });
        const reelsTabMetrics = await window.InstaScraperContent.scrapeProfileData('reels_tab_user', mockRootDoc, { excludeMostRecent: false });

        // Verify fetchFromInstagramApi with web_profile_info + POST /api/v1/clips/user/ + GET /api/v1/feed/user/
        let clipsPostBody = '';
        window.fetch = async (url, init) => {
          if (String(url).includes('web_profile_info')) {
            return {
              ok: true,
              json: async () => ({
                data: {
                  user: {
                    id: '987654321',
                    follower_count: 50000,
                    edge_owner_to_timeline_media: {
                      edges: [{ node: { shortcode: 'MAIN_PIN', pinned_for_users: [{ id: '1' }] } }]
                    }
                  }
                }
              })
            };
          }
          if (String(url).includes('/api/v1/clips/user/')) {
            clipsPostBody = init && init.body ? String(init.body) : '';
            return {
              ok: true,
              json: async () => ({
                items: [
                  { media: { code: 'CLIP_PIN', play_count: 500000, like_count: 40000, comment_count: 900, clips_tab_pinned_user_ids: ['987654321'], media_type: 2, product_type: 'clips' } },
                  { media: { code: 'R1', play_count: 20000, like_count: 2000, comment_count: 100, media_type: 2, product_type: 'clips' } },
                  { media: { code: 'R2', play_count: 20000, like_count: 2000, comment_count: 100, media_type: 2, product_type: 'clips' } }
                ]
              })
            };
          }
          if (String(url).includes('/api/v1/feed/user/')) {
            return {
              ok: true,
              json: async () => ({
                items: [
                  { code: 'FEED_PHOTO_1', like_count: 99999, comment_count: 999, media_type: 1 },
                  { code: 'FEED_PHOTO_2', like_count: 88888, comment_count: 888, media_type: 1 },
                  { code: 'R1', play_count: 20000, like_count: 2000, comment_count: 100, media_type: 2, product_type: 'clips' },
                  { code: 'R3', play_count: 20000, like_count: 2000, comment_count: 100, media_type: 2, product_type: 'clips' }
                ]
              })
            };
          }
          return { ok: false };
        };
        const apiPinSet = new Set();
        const apiFetched = await window.InstaScraperContent.fetchFromInstagramApi('clips_api_user', apiPinSet);
        window.fetch = origFetch;

        // Simulate SPA header re-render where React replaces <h2> with a new <h2>gallery_mahshid</h2>
        const headerRow = document.getElementById('header-row');
        const newH2 = document.createElement('h2');
        newH2.textContent = 'gallery_mahshid';
        headerRow.insertBefore(newH2, h2);
        h2.remove();
        const updatedBtn = window.InstaScraperContent.ensureProfileScrapeButton(document);
        const reanchoredNextToNewH2 = updatedBtn && newH2.nextElementSibling === updatedBtn && updatedBtn.getAttribute('data-username') === 'gallery_mahshid';
        const btnCrowImg = updatedBtn ? updatedBtn.querySelector('img.ig-scraper-crow-logo') : null;
        const panelCrowImg = document.querySelector('#ig-scraper-panel img.ig-scraper-crow-logo');
        const brandNameEl = document.querySelector('#ig-scraper-panel .ig-scraper-brand-name');
        const ownerPillEl = document.querySelector('#ig-scraper-panel a.ig-scraper-owner-pill');
        const footerOwnerLinkEl = document.querySelector('#ig-scraper-panel a.ig-scraper-footer-owner-link');

        const summary = {
          ok: true,
          isNextToName,
          reanchoredNextToNewH2,
          hasBtnCrowAfterScrape,
          wasExpandedBeforeOwnerClick,
          remainedExpandedAfterOwnerClick,
          ownerClickBubbledToDoc,
          hasBtnCrowLogo: Boolean(btnCrowImg && btnCrowImg.getAttribute('src') && btnCrowImg.complete && btnCrowImg.naturalWidth > 0),
          hasPanelCrowLogo: Boolean(panelCrowImg && panelCrowImg.getAttribute('src') && panelCrowImg.complete && panelCrowImg.naturalWidth > 0),
          brandName: brandNameEl ? brandNameEl.textContent.trim() : '',
          ownerPillText: ownerPillEl ? ownerPillEl.textContent.trim() : '',
          ownerPillHref: ownerPillEl ? ownerPillEl.getAttribute('href') : '',
          footerOwnerText: footerOwnerLinkEl ? footerOwnerLinkEl.textContent.trim() : '',
          footerOwnerHref: footerOwnerLinkEl ? footerOwnerLinkEl.getAttribute('href') : '',
          ssrFollowers: ssrExtracted.followers,
          ssrPostsCount: ssrExtracted.posts.length,
          mCounts1,
          mCounts2,
          mCounts3,
          millionApiAvgViews: millionApiMetrics.avgViews,
          millionApiAvgViewsFormatted: millionApiMetrics.avgViewsFormatted,
          millionApiVrFormatted: millionApiMetrics.vrFormatted,
          reelsTabClicked,
          reelsTabAvgViews: reelsTabMetrics.avgViews,
          reelsTabAvgViewsFormatted: reelsTabMetrics.avgViewsFormatted,
          clipsPostBody,
          apiFollowers: apiFetched ? apiFetched.followers : 0,
          apiPostsCount: apiFetched ? apiFetched.posts.length : 0,
          apiMainPinRecorded: apiPinSet.has('MAIN_PIN'),
          btnTextAfterClick: btn.textContent.trim(),
          storedCount: stored.length,
          firstRecord: stored[0] || null,
          avViewCellText: avViewCellEl ? avViewCellEl.textContent.trim() : null,
          tableHeaders,
          priceInputValue: priceInput ? priceInput.value : null,
          linkHref: linkEl ? linkEl.getAttribute('href') : null,
          linkText: linkEl ? linkEl.textContent.trim() : null,
          linkTarget: linkEl ? linkEl.getAttribute('target') : null
        };
        document.body.setAttribute('data-test-result', JSON.stringify(summary));
      } catch (err) {
        document.body.setAttribute('data-test-result', JSON.stringify({ ok: false, error: err.message }));
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(testHtmlPath, html, 'utf8');

  try {
    const fileUrl = 'file:///' + testHtmlPath.replace(/\\/g, '/');
    const dumpedDom = execFileSync(
      CHROME_PATH,
      [
        '--headless=new',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--virtual-time-budget=3000',
        '--dump-dom',
        fileUrl
      ],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    const match = dumpedDom.match(/data-test-result="([^"]+)"/);
    assert.ok(match, 'Could not find data-test-result attribute in dumped DOM');

    const jsonStr = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const result = JSON.parse(jsonStr);
    assert.equal(result.ok, true, `Browser test failed: ${result.error}`);
    assert.equal(result.isNextToName, true, 'Scrape button must be injected right next to Verified <h2>mmd.fate</h2>');
    assert.equal(result.hasBtnCrowAfterScrape, true, 'White crow logo must remain inside #ig-scraper-profile-btn after scraping');
    assert.equal(result.wasExpandedBeforeOwnerClick, true, 'Panel must expand after scraping');
    assert.equal(result.remainedExpandedAfterOwnerClick, true, 'Clicking by @mhrshadfm in panel header must not collapse the panel');
    assert.equal(result.ownerClickBubbledToDoc, false, 'Clicking by @mhrshadfm must stop propagation to document-level SPA listeners');
    assert.equal(result.reanchoredNextToNewH2, true, 'Scrape button must re-anchor next to new <h2> on SPA navigation');
    assert.equal(result.hasBtnCrowLogo, true, 'Profile header Scrape button must render & decode the white crow logo');
    assert.equal(result.hasPanelCrowLogo, true, 'In-page panel header must render & decode the white crow logo');
    assert.equal(result.brandName, 'Crow Scrapper', 'In-page panel must display Crow Scrapper brand name');
    assert.equal(result.ownerPillText, 'by @mhrshadfm', 'In-page panel header must display by @mhrshadfm badge');
    assert.equal(result.ownerPillHref, 'https://www.instagram.com/mhrshadfm/');
    assert.equal(result.footerOwnerText, '@mhrshadfm', 'In-page panel footer must display @mhrshadfm owner link');
    assert.equal(result.footerOwnerHref, 'https://www.instagram.com/mhrshadfm/');
    assert.equal(result.ssrFollowers, 250000, 'Must extract followers from embedded SSR JSON script');
    assert.equal(result.ssrPostsCount, 1, 'Must extract clips edges from embedded SSR JSON script');
    assert.equal(result.mCounts1.views, 1500000, 'Must extract 1.5M (1,500,000) views from /p/ Reel tile with BiDi marks and nested SVG');
    assert.equal(result.mCounts2.views, 2400000, 'Must extract 2.4M (2,400,000) views when thumbnail badge comes before [45K, 800] hover spans');
    assert.equal(result.mCounts2.likes, 45000, 'Must extract 45K likes from 3-span hovered Reel tile');
    assert.equal(result.mCounts2.comments, 800, 'Must extract 800 comments from 3-span hovered Reel tile');
    assert.equal(result.mCounts3.views, 1500000, 'Must extract 1.5M views when <svg aria-label="Play"> precedes sibling <span>1.5M</span>');
    assert.equal(result.mCounts3.likes, 45000, 'Must extract 45K likes when <svg aria-label="Like"> precedes sibling <span>45K</span>');
    assert.equal(result.mCounts3.comments, 800, 'Must extract 800 comments when <svg aria-label="Comment"> precedes sibling <span>800</span>');
    assert.equal(result.millionApiAvgViews, 1500000, 'Must upgrade thousand-level web_profile_info video_view_count (184,392) to Million play_count (1.5M = 1,500,000) via /api/v1/feed/user/');
    assert.equal(result.millionApiAvgViewsFormatted, '1.5M', 'Million-viewed Reel average must be formatted as 1.5M');
    assert.equal(result.millionApiVrFormatted, '300.00%', 'Million-viewed Reel V.R. must be 300.00% (1.5M / 500K)');
    assert.equal(result.reelsTabClicked, true, 'Must auto-click Reels tab link when web_profile_info only has legacy video_view_count and clips/feed APIs fail');
    assert.equal(result.reelsTabAvgViews, 1800000, 'Must upgrade legacy video_view_count (184K) to written 1.8M (1,800,000) from Reels tab DOM');
    assert.equal(result.reelsTabAvgViewsFormatted, '1.8M');
    assert.ok(result.clipsPostBody.includes('target_user_id=987654321'), 'Must POST target_user_id to /api/v1/clips/user/');
    assert.equal(result.apiFollowers, 50000);
    assert.equal(result.apiPostsCount, 4, 'Must combine Clips API reels (CLIP_PIN, R1, R2) with additional Feed API reel (R3) while ignoring Feed photos');
    assert.equal(result.apiMainPinRecorded, true);
    assert.equal(result.storedCount, 1, 'Duplicate profile upsert must not create a second entry');
    assert.deepEqual(
      result.tableHeaders,
      ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL'],
      'In-page table must render all 9 columns in exact order'
    );
    assert.equal(result.priceInputValue, '', 'Price/REEL cell at end of row must be empty by default');
    assert.equal(result.firstRecord.username, 'mmd.fate');
    assert.equal(result.firstRecord.followers, 373760);
    assert.equal(result.firstRecord.avgViews, 120000);
    assert.equal(result.firstRecord.avgViewsFormatted, '120K');
    assert.equal(result.avViewCellText, '120K', 'In-page table AV VIEW column must display written K/M format (120K)');
    assert.equal(result.firstRecord.vrFormatted, '32.11%');
    assert.equal(result.firstRecord.vrBand, 'High');
    assert.equal(result.firstRecord.avgLikes, 78007);
    assert.equal(result.firstRecord.avgComments, 878);
    assert.equal(result.firstRecord.erFormatted, '21.11%');
    assert.equal(result.firstRecord.erBenchmarkFormatted, '1.7%');
    assert.equal(result.firstRecord.erAboveBenchmark, true);
    assert.equal(result.firstRecord.postsAnalyzed, 6);
    assert.equal(result.firstRecord.pinnedSkipped, 3);
    assert.equal(result.linkHref, 'https://www.instagram.com/mmd.fate/');
    assert.equal(result.linkText, 'mmd.fate');
    assert.equal(result.linkTarget, '_blank');

    console.log('   [OK] Headless Chrome Content Script E2E test passed!');
    console.log('        - Crow Scrapper by @mhrshadfm branding + white crow logo verified in button (before & after scrape) & panel');
    console.log('        - Clicking by @mhrshadfm in panel header verified not to collapse panel or bubble to SPA router');
    console.log('        - Button injected next to Verified <h2>mmd.fate</h2> and re-anchored on SPA navigation');
    console.log('        - 3 pinned posts skipped, 6 recent Reels scraped (including view counts before/after hover)');
    console.log('        - Million-viewed Reels (1.5M / 2.4M) verified in DOM (with BiDi marks & /p/ hrefs) and API fallback');
    console.log('        - Followers: 373,760 | ER: 21.11% (≥1.7%) | V.R.: 32.11% (High) | AV VIEW: 120K | AV LIKE: 78,007 | AV COMMENTS: 878');
    console.log('        - 9 columns rendered with empty Price/REEL at the end and strict deduplication verified');
  } finally {
    if (fs.existsSync(testHtmlPath)) {
      fs.unlinkSync(testHtmlPath);
    }
  }
}

function runHeadlessPopupTest() {
  console.log('Running Headless Chrome E2E Test on Extension Popup UI (src/popup.html + src/popup.js)...');
  const popupHtmlPath = path.resolve(__dirname, '../src/popup.html');
  const testPopupPath = path.resolve(__dirname, '../src/test_popup_e2e.html');

  const rawPopupHtml = fs.readFileSync(popupHtmlPath, 'utf8');
  const injectedPopupHtml = rawPopupHtml.replace(
    '<script src="core.js"></script>',
    `<script>
      localStorage.setItem('ig_scraped_profiles', JSON.stringify([{
        username: 'mmd.fate',
        profileUrl: 'https://www.instagram.com/mmd.fate/',
        followers: 373760,
        er: 21.11,
        erFormatted: '21.11%',
        vr: 32.11,
        vrFormatted: '32.11%',
        avgViews: 120000,
        avgViewsFormatted: '120K',
        avgLikes: 78007,
        avgComments: 878,
        likesPerComment: 88.8,
        pricePerReel: ''
      }]));
    </script>
    <script src="core.js"></script>`
  ).replace(
    '</body>',
    `<script>
      window.addEventListener('load', () => {
        setTimeout(() => {
          const logoImg = document.querySelector('.brand-logo-img');
          const h1 = document.querySelector('.brand h1');
          const ownerLink = document.querySelector('.owner-link');
          const footerLink = document.querySelector('.owner-footer-link');
          const countEl = document.getElementById('profile-count');
          const rowLink = document.querySelector('#results-tbody a.user-profile-link');
          const popupAvViewCell = document.querySelector('#results-tbody tr td:nth-child(5)');
          const headers = Array.from(document.querySelectorAll('#results-table thead th'))
            .slice(0, 9)
            .map((th) => th.textContent.trim());
          document.body.setAttribute('data-popup-result', JSON.stringify({
            title: document.title,
            h1Text: h1 ? h1.textContent.trim() : '',
            logoLoaded: Boolean(logoImg && logoImg.complete && logoImg.naturalWidth === 256),
            ownerLinkText: ownerLink ? ownerLink.textContent.trim() : '',
            ownerLinkHref: ownerLink ? ownerLink.getAttribute('href') : '',
            footerLinkText: footerLink ? footerLink.textContent.trim() : '',
            footerLinkHref: footerLink ? footerLink.getAttribute('href') : '',
            profileCount: countEl ? countEl.textContent.trim() : '',
            rowUsername: rowLink ? rowLink.textContent.trim() : '',
            popupAvViewText: popupAvViewCell ? popupAvViewCell.textContent.trim() : '',
            headers
          }));
        }, 150);
      });
    </script>
    </body>`
  );

  fs.writeFileSync(testPopupPath, injectedPopupHtml, 'utf8');
  try {
    const popupUrl = 'file:///' + testPopupPath.replace(/\\/g, '/');
    const dumpedPopup = execFileSync(
      CHROME_PATH,
      [
        '--headless=new',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--virtual-time-budget=2000',
        '--dump-dom',
        popupUrl
      ],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    const match = dumpedPopup.match(/data-popup-result="([^"]+)"/);
    assert.ok(match, 'Could not find data-popup-result attribute in dumped Popup DOM');
    const popupRes = JSON.parse(
      match[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
    );

    assert.equal(popupRes.title, 'Crow Scrapper by @mhrshadfm');
    assert.equal(popupRes.h1Text, 'Crow Scrapper');
    assert.equal(popupRes.logoLoaded, true, 'Popup white crow logo (../icons/crow-white.png) must load & decode at 256x256');
    assert.equal(popupRes.ownerLinkText, '@mhrshadfm');
    assert.equal(popupRes.ownerLinkHref, 'https://www.instagram.com/mhrshadfm/');
    assert.equal(popupRes.footerLinkText, '@mhrshadfm');
    assert.equal(popupRes.footerLinkHref, 'https://www.instagram.com/mhrshadfm/');
    assert.equal(popupRes.profileCount, '1');
    assert.equal(popupRes.rowUsername, 'mmd.fate');
    assert.equal(popupRes.popupAvViewText, '120K', 'Popup table AV VIEW cell must display K/M format (120K)');
    assert.deepEqual(
      popupRes.headers,
      ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL']
    );
    console.log('   [OK] Headless Chrome Popup UI E2E test passed!');
  } finally {
    if (fs.existsSync(testPopupPath)) {
      fs.unlinkSync(testPopupPath);
    }
  }
}

runHeadlessChromeTest();
runHeadlessPopupTest();

