const assert = require('node:assert/strict');
const Core = require('../src/core.js');

async function runTests() {
  console.log('=== Running Instagram Profile Engagement Scraper Tests ===\n');

  // 1. Test parseCount
  console.log('1. Testing parseCount with various Instagram formats (including views & plays)...');
  assert.equal(Core.parseCount(373760), 373760);
  assert.equal(Core.parseCount('373,760'), 373760);
  assert.equal(Core.parseCount('373 760'), 373760);
  assert.equal(Core.parseCount('373.760'), 373760);
  assert.equal(Core.parseCount('71.9K'), 71900);
  assert.equal(Core.parseCount('1.25M'), 1250000);
  assert.equal(Core.parseCount('1,5M'), 1500000);
  assert.equal(Core.parseCount('2B'), 2000000000);
  assert.equal(Core.parseCount('78,007 likes'), 78007);
  assert.equal(Core.parseCount('78,007, 878'), 78007, 'Must not merge comma-space separated numbers');
  assert.equal(Core.parseCount('373Kfollowers'), 373000, 'Must parse K suffix immediately followed by followers');
  assert.equal(Core.parseCount('120Kviews'), 120000, 'Must parse K suffix immediately followed by views');
  assert.equal(Core.parseCount('1.5M plays'), 1500000, 'Must parse M suffix followed by plays');
  assert.equal(Core.parseCount('1.5Mplays'), 1500000, 'Must parse M suffix immediately followed by plays');
  assert.equal(Core.parseCount('\u20661.5M\u2069'), 1500000, 'Must strip Unicode BiDi isolate marks around 1.5M');
  assert.equal(Core.parseCount('1.5\u200eM'), 1500000, 'Must strip Unicode LRM between number and M suffix');
  assert.equal(Core.parseCount('\u200f2,4M\u200f'), 2400000, 'Must strip Unicode RLM around 2,4M');
  assert.equal(Core.parseCount('۱٫۵ میلیون'), 1500000, 'Must parse Persian digits and million suffix');
  assert.equal(Core.parseCount('۱۲۰ هزار'), 120000, 'Must parse Persian digits and thousand suffix');
  assert.equal(Core.parseCount('1.8 mio'), 1800000, 'Must parse localized mio suffix as million');
  assert.equal(Core.parseCount('1.5mio'), 1500000, 'Must parse localized mio suffix without space as million');
  assert.equal(Core.parseCount('2.4mln'), 2400000, 'Must parse localized mln suffix without space as million');
  assert.equal(Core.parseCount('1.5million'), 1500000, 'Must parse million suffix without space as million');
  assert.equal(Core.parseCount('850,400 views'), 850400);
  assert.equal(Core.parseCount('78,007 members'), 78007, 'Must not treat m in members as Million suffix');
  assert.equal(Core.parseCount('-1'), 0, 'Hidden like count (-1) must clamp to 0');
  assert.equal(Core.parseCount(-1), 0);
  assert.equal(Core.parseCount(''), 0);
  assert.equal(Core.parseCount(null), 0);
  assert.equal(Core.parseCount(undefined), 0);

  // Test formatCompactCount & roundToWrittenCount
  assert.equal(Core.formatCompactCount(0), '0');
  assert.equal(Core.formatCompactCount(850), '850');
  assert.equal(Core.formatCompactCount(14532), '14.5K');
  assert.equal(Core.formatCompactCount(120000), '120K');
  assert.equal(Core.formatCompactCount(452891), '453K');
  assert.equal(Core.formatCompactCount(1500000), '1.5M');
  assert.equal(Core.formatCompactCount(1542891), '1.5M');
  assert.equal(Core.formatCompactCount(2000000), '2M');
  assert.equal(Core.roundToWrittenCount('1.5M'), 1500000);
  assert.equal(Core.roundToWrittenCount(1542891), 1500000, 'Specific API play_count must round to written 1.5M (1,500,000)');
  assert.equal(Core.roundToWrittenCount('1,542,891 media views'), 1500000, 'Words containing m/k/b must not bypass compact rounding');
  assert.equal(Core.roundToWrittenCount(452891), 453000, 'Specific API play_count in 100K..999K must round to written 453K (453,000)');

  // Test normalizePost hasReliableViews preservation across re-normalization
  const legacyOnlyNode = Core.normalizePost({ shortcode: 'LEGACY1', is_video: true, product_type: 'clips', video_view_count: 184392 });
  assert.equal(legacyOnlyNode.hasReliableViews, false, 'Post with only legacy video_view_count must have hasReliableViews = false');
  const reNormalizedLegacy = Core.normalizePost(legacyOnlyNode);
  assert.equal(reNormalizedLegacy.hasReliableViews, false, 'Re-normalizing a post with hasReliableViews=false must preserve hasReliableViews=false');
  const unhoveredDomNode = Core.normalizePost({ shortcode: 'DOM0', views: 0, hasViews: false, isReel: true });
  assert.equal(unhoveredDomNode.hasReliableViews, false, 'Unhovered DOM post with views=0 and hasViews=false must have hasReliableViews=false');
  console.log('   ✓ parseCount, formatCompactCount, & roundToWrittenCount passed');

  // 1b. Test View Rate Bands (getViewRateBand) & E.R. Follower Benchmarks (getErBenchmark)
  console.log('1b. Testing View Rate (V.R.) Bands & E.R. Follower Benchmarks...');
  assert.equal(Core.getViewRateBand(0).band, 'Very low');
  assert.equal(Core.getViewRateBand(10).band, 'Very low');
  assert.equal(Core.getViewRateBand(10).range, '≤ 10%');
  assert.equal(Core.getViewRateBand(10.01).band, 'Low');
  assert.equal(Core.getViewRateBand(15).band, 'Low');
  assert.equal(Core.getViewRateBand(15).range, '10%-15%');
  assert.equal(Core.getViewRateBand(15.01).band, 'Medium');
  assert.equal(Core.getViewRateBand(30).band, 'Medium');
  assert.equal(Core.getViewRateBand(30).range, '15%-30%');
  assert.equal(Core.getViewRateBand(30.01).band, 'High');
  assert.equal(Core.getViewRateBand(49.99).band, 'High');
  assert.equal(Core.getViewRateBand(49.99).range, '30%-50%');
  assert.equal(Core.getViewRateBand(50).band, 'Very high');
  assert.equal(Core.getViewRateBand(125).band, 'Very high');
  assert.equal(Core.getViewRateBand(50).range, '≥ 50%');

  assert.deepEqual(
    { b: Core.getErBenchmark(800, 9.2).benchmark, t: Core.getErBenchmark(800, 9.2).tier, ok: Core.getErBenchmark(800, 9.2).aboveBenchmark },
    { b: 8, t: '≤ 1,000', ok: true }
  );
  assert.deepEqual(
    { b: Core.getErBenchmark(1000, 7.9).benchmark, t: Core.getErBenchmark(1000, 7.9).tier, ok: Core.getErBenchmark(1000, 7.9).aboveBenchmark },
    { b: 8, t: '≤ 1,000', ok: false }
  );
  assert.deepEqual(
    { b: Core.getErBenchmark(3500, 5.7).benchmark, t: Core.getErBenchmark(3500, 5.7).tier, ok: Core.getErBenchmark(3500, 5.7).aboveBenchmark },
    { b: 5.7, t: '1,000 - 5,000', ok: true }
  );
  assert.deepEqual(
    { b: Core.getErBenchmark(7500, 4.1).benchmark, t: Core.getErBenchmark(7500, 4.1).tier, ok: Core.getErBenchmark(7500, 4.1).aboveBenchmark },
    { b: 4, t: '5,000 - 10,000', ok: true }
  );
  assert.deepEqual(
    { b: Core.getErBenchmark(50000, 2.1).benchmark, t: Core.getErBenchmark(50000, 2.1).tier, ok: Core.getErBenchmark(50000, 2.1).aboveBenchmark },
    { b: 2.4, t: '10,000 - 100,000', ok: false }
  );
  assert.deepEqual(
    { b: Core.getErBenchmark(373760, 21.11).benchmark, t: Core.getErBenchmark(373760, 21.11).tier, ok: Core.getErBenchmark(373760, 21.11).aboveBenchmark },
    { b: 1.7, t: '≥ 100,000', ok: true }
  );
  console.log('   ✓ V.R. Bands & E.R. Benchmarks passed');

  // 2. Test Pinned Post Exclusion & 6-Recent-Post Selection
  console.log('2. Testing exclusion of 3 pinned posts and selection of 6 recent posts...');
  const samplePostsWith3Pinned = [
    // 3 Pinned posts (e.g. old viral posts that must be ignored!)
    { shortcode: 'PIN1', likes: 999999, comments: 50000, pinned_for_users: [{ id: '1' }], taken_at_timestamp: 1600000000 },
    { shortcode: 'PIN2', likes: 888888, comments: 40000, timeline_pinned_user_ids: ['1'], taken_at_timestamp: 1610000000 },
    { shortcode: 'PIN3', likes: 777777, comments: 30000, shortcode_only_dom_pin: true, taken_at_timestamp: 1620000000 },
    // 8 Non-pinned chronological posts (only first 6 most recent should be used)
    { shortcode: 'RECENT1', views: 150000, likes: 78000, comments: 880, taken_at_timestamp: 1700000006 },
    { shortcode: 'RECENT2', views: 150000, likes: 78010, comments: 876, taken_at_timestamp: 1700000005 },
    { shortcode: 'RECENT3', views: 150000, likes: 78005, comments: 879, taken_at_timestamp: 1700000004 },
    { shortcode: 'RECENT4', views: 150000, likes: 78009, comments: 877, taken_at_timestamp: 1700000003 },
    { shortcode: 'RECENT5', views: 150000, likes: 78008, comments: 878, taken_at_timestamp: 1700000002 },
    { shortcode: 'RECENT6', views: 150000, likes: 78010, comments: 878, taken_at_timestamp: 1700000001 },
    // Older posts #7 and #8 (must NOT be included in the 6 recent average)
    { shortcode: 'OLD7', views: 10000, likes: 1000, comments: 10, taken_at_timestamp: 1690000000 },
    { shortcode: 'OLD8', views: 5000, likes: 500, comments: 5, taken_at_timestamp: 1680000000 }
  ];

  const domPinned = new Set(['PIN3']);
  const selected = Core.selectRecentNonPinnedPosts(samplePostsWith3Pinned, domPinned);
  assert.equal(selected.length, 6, 'Must select exactly 6 non-pinned posts');
  assert.deepEqual(
    selected.map((p) => p.shortcode),
    ['RECENT1', 'RECENT2', 'RECENT3', 'RECENT4', 'RECENT5', 'RECENT6'],
    'Must skip all 3 pinned posts and exclude older posts beyond 6'
  );

  const metrics = Core.calculateProfileMetrics({
    username: 'mmd.fate',
    followers: 373760,
    posts: samplePostsWith3Pinned,
    domPinnedShortcodes: domPinned
  });

  assert.equal(metrics.username, 'mmd.fate');
  assert.equal(metrics.profileUrl, 'https://www.instagram.com/mmd.fate/');
  assert.equal(metrics.followers, 373760);
  assert.equal(metrics.avgViews, 150000);
  assert.equal(metrics.avgViewsFormatted, '150K');
  assert.equal(metrics.vr, 40.13);
  assert.equal(metrics.vrFormatted, '40.13%');
  assert.equal(metrics.vrBand, 'High');
  assert.equal(metrics.vrBandRange, '30%-50%');
  assert.equal(metrics.avgLikes, 78007);
  assert.equal(metrics.avgComments, 878);
  assert.equal(metrics.er, 21.11);
  assert.equal(metrics.erFormatted, '21.11%');
  assert.equal(metrics.erBenchmark, 1.7);
  assert.equal(metrics.erBenchmarkFormatted, '1.7%');
  assert.equal(metrics.erBenchmarkTier, '≥ 100,000');
  assert.equal(metrics.erAboveBenchmark, true);
  assert.equal(metrics.pricePerReel, '');
  assert.equal(metrics.postsAnalyzed, 6);
  assert.equal(metrics.pinnedSkipped, 3);

  // 2a-bis. Test Million-viewed Reels (written "1.5M", "2.1M", or play_count: 1542891 vs legacy video_view_count: 184392)
  const millionViewedReels = [
    { shortcode: 'M1', views: '1.5M', video_view_count: 184392, likes: 80000, comments: 1200 },
    { shortcode: 'M2', play_count: 2143920, video_view_count: 210400, likes: 110000, comments: 1800 },
    { shortcode: 'M3', views: '\u20661.2M\u2069', video_view_count: 125000, likes: 60000, comments: 900 },
    { shortcode: 'M4', views: '1,8M', video_view_count: 190000, likes: 95000, comments: 1500 },
    { shortcode: 'M5', play_count: 1412345, video_view_count: 140000, likes: 70000, comments: 1100 },
    { shortcode: 'M6', views: '1.6M', video_view_count: 160000, likes: 85000, comments: 1300 }
  ];
  const millionMetrics = Core.calculateProfileMetrics({
    username: 'million_creator',
    followers: 500000,
    posts: millionViewedReels
  });
  assert.equal(millionMetrics.avgViews, 1600000, 'Million-viewed Reels must average to 1,600,000 (1.6M), never thousands');
  assert.equal(millionMetrics.avgViewsFormatted, '1.6M', 'AV VIEW must be formatted as 1.6M');
  assert.equal(millionMetrics.vr, 320);
  assert.equal(millionMetrics.vrFormatted, '320.00%');
  assert.equal(millionMetrics.vrBand, 'Very high');

  // 2b. Test unflagged old pinned posts in slots 0..1 detected via timestamp inversion
  const unflaggedOldPins = [
    { shortcode: 'UNFLAGGED_OLD_PIN_1', likes: 500000, comments: 10000, taken_at_timestamp: 1600000000 },
    { shortcode: 'UNFLAGGED_OLD_PIN_2', likes: 400000, comments: 9000, taken_at_timestamp: 1610000000 },
    { shortcode: 'NEW_1', likes: 1000, comments: 50, taken_at_timestamp: 1700000004 },
    { shortcode: 'NEW_2', likes: 1000, comments: 50, taken_at_timestamp: 1700000003 },
    { shortcode: 'NEW_3', likes: 1000, comments: 50, taken_at_timestamp: 1700000002 },
    { shortcode: 'NEW_4', likes: 1000, comments: 50, taken_at_timestamp: 1700000001 }
  ];
  const unflaggedMetrics = Core.calculateProfileMetrics({
    username: 'timestamp_pin_test',
    followers: 10000,
    posts: unflaggedOldPins
  });
  assert.equal(unflaggedMetrics.pinnedSkipped, 2, 'Old posts in slots 0..1 with timestamps older than slot 2 must be detected as pinned');
  assert.equal(unflaggedMetrics.postsAnalyzed, 4, 'Must only analyze the 4 non-pinned posts and not include the 2 old pins');
  assert.equal(unflaggedMetrics.avgLikes, 1000);

  // 2c. Test Clips API media unwrapping, non-reel photo exclusion, clips_tab_pinned_user_ids, and excludeMostRecent option
  console.log('2c. Testing Reels-only filtering, clips_tab_pinned_user_ids, and excludeMostRecent option...');
  const mixedClipsAndPhotos = [
    { media: { code: 'PINNED_CLIP', play_count: 900000, like_count: 80000, comment_count: 2000, media_type: 2, product_type: 'clips', clips_tab_pinned_user_ids: ['999'] } },
    { node: { shortcode: 'PHOTO_POST', like_count: 50000, comment_count: 1000, media_type: 1, __typename: 'GraphImage' } },
    { media: { code: 'MOST_RECENT_REEL', play_count: 1000, like_count: 100, comment_count: 10, media_type: 2, product_type: 'clips', taken_at: 1700000010 } },
    { media: { code: 'REEL_2', play_count: 60000, like_count: 3000, comment_count: 150, media_type: 2, product_type: 'clips', taken_at: 1700000009 } },
    { media: { code: 'REEL_3', play_count: 60000, like_count: 3000, comment_count: 150, media_type: 2, product_type: 'clips', taken_at: 1700000008 } },
    { media: { code: 'REEL_4', play_count: 60000, like_count: 3000, comment_count: 150, media_type: 2, product_type: 'clips', taken_at: 1700000007 } },
    { media: { code: 'REEL_5', play_count: 60000, like_count: 3000, comment_count: 150, media_type: 2, product_type: 'clips', taken_at: 1700000006 } },
    { media: { code: 'REEL_6', play_count: 60000, like_count: 3000, comment_count: 150, media_type: 2, product_type: 'clips', taken_at: 1700000005 } },
    { media: { code: 'REEL_7', play_count: 60000, like_count: 3000, comment_count: 150, media_type: 2, product_type: 'clips', taken_at: 1700000004 } }
  ];

  const skipMostRecentMetrics = Core.calculateProfileMetrics({
    username: 'reels_creator',
    followers: 100000,
    posts: mixedClipsAndPhotos,
    excludeMostRecent: true
  });
  assert.equal(skipMostRecentMetrics.postsAnalyzed, 6);
  assert.equal(skipMostRecentMetrics.pinnedSkipped, 1);
  assert.equal(skipMostRecentMetrics.mostRecentSkipped, 1);
  assert.equal(skipMostRecentMetrics.avgViews, 60000, 'Must skip PINNED_CLIP, PHOTO_POST, and MOST_RECENT_REEL');
  assert.equal(skipMostRecentMetrics.avgViewsFormatted, '60K');
  assert.equal(skipMostRecentMetrics.vrFormatted, '60.00%');
  assert.equal(skipMostRecentMetrics.vrBand, 'Very high');
  assert.equal(skipMostRecentMetrics.avgLikes, 3000);
  assert.equal(skipMostRecentMetrics.avgComments, 150);
  assert.equal(skipMostRecentMetrics.erFormatted, '3.15%');
  assert.equal(skipMostRecentMetrics.erBenchmark, 2.4);
  assert.equal(skipMostRecentMetrics.erAboveBenchmark, true);

  // Test < 6 Reels mixed with unflagged non-reels (e.g. DOM photo tiles where isExplicitNonReel is false)
  const fewerThan6ReelsWithPhotos = [
    { shortcode: 'DOM_PHOTO_1', views: 0, likes: 50000, comments: 500, isReel: false, isExplicitNonReel: false },
    { shortcode: 'DOM_PHOTO_2', views: 0, likes: 40000, comments: 400, isReel: false, isExplicitNonReel: false },
    { shortcode: 'DOM_REEL_1', views: 80000, likes: 4000, comments: 200, isReel: true, isExplicitNonReel: false },
    { shortcode: 'DOM_REEL_2', views: 100000, likes: 6000, comments: 300, isReel: true, isExplicitNonReel: false }
  ];
  const fewerThan6Metrics = Core.calculateProfileMetrics({
    username: 'partial_reels_user',
    followers: 100000,
    posts: fewerThan6ReelsWithPhotos
  });
  assert.equal(fewerThan6Metrics.postsAnalyzed, 2, 'Must analyze only the 2 Reels and exclude the 2 non-reels even when < 6 Reels exist');
  assert.equal(fewerThan6Metrics.avgViews, 90000, 'Non-reel 0-view photos must not drag down avgViews');
  assert.equal(fewerThan6Metrics.avgViewsFormatted, '90K');
  assert.equal(fewerThan6Metrics.avgLikes, 5000);
  assert.equal(fewerThan6Metrics.avgComments, 250);
  console.log('   ✓ 3 pinned posts excluded, Reels-only filtering, & excludeMostRecent passed');

  // 3. Verify all 8 rows from user's uploaded reference image
  console.log('3. Verifying ER formula against all 8 rows of reference screenshot...');
  const referenceRows = [
    { username: 'mmd.fate', followers: 373760, avgViews: 120000, avgLikes: 78007, avgComments: 878, expectedEr: '21.11%' },
    { username: 'gallery_mahshid', followers: 109928, avgViews: 45000, avgLikes: 18361, avgComments: 417, expectedEr: '17.08%' },
    { username: 'sarrftm', followers: 150099, avgViews: 90000, avgLikes: 45580, avgComments: 239, expectedEr: '30.53%' },
    { username: 'nadia_fitnesss', followers: 199755, avgViews: 55000, avgLikes: 20354, avgComments: 304, expectedEr: '10.34%' },
    { username: 'sarah.chishiro', followers: 71949, avgViews: 110000, avgLikes: 56550, avgComments: 1361, expectedEr: '80.49%' },
    { username: 'mehdiiak47', followers: 726273, avgViews: 310000, avgLikes: 129770, avgComments: 2794, expectedEr: '18.25%' },
    { username: 'saalaarthepusher', followers: 536090, avgViews: 60000, avgLikes: 11943, avgComments: 250, expectedEr: '2.27%' },
    { username: 'amiriscooking', followers: 139777, avgViews: 42000, avgLikes: 11887, avgComments: 476, expectedEr: '8.84%' }
  ];

  const calculatedProfiles = referenceRows.map((row) => {
    const m = Core.calculateProfileMetrics({
      username: row.username,
      followers: row.followers,
      posts: Array.from({ length: 6 }, (_, i) => ({
        shortcode: `post_${i}`,
        views: row.avgViews,
        likes: row.avgLikes,
        comments: row.avgComments
      }))
    });
    assert.equal(m.erFormatted, row.expectedEr, `ER mismatch for ${row.username}`);
    assert.equal(m.avgViews, row.avgViews, `AV VIEW mismatch for ${row.username}`);
    return m;
  });
  console.log('   ✓ All 8 reference screenshot rows matched 100%');

  // 4. Test Edge Cases (0 followers, 0 posts, only pinned posts, 0 comments, low comments, hidden likes -1 with high views)
  console.log('4. Testing edge cases (empty posts, only pinned posts, 0 followers, 0 comments, low comments, hidden likes)...');
  const emptyMetrics = Core.calculateProfileMetrics({
    username: '@zero_user',
    followers: 0,
    posts: [
      { shortcode: 'PIN_ONLY', likes: 5000, comments: 100, is_pinned: true }
    ]
  });
  assert.equal(emptyMetrics.username, 'zero_user');
  assert.equal(emptyMetrics.followers, 0);
  assert.equal(emptyMetrics.avgViews, 0);
  assert.equal(emptyMetrics.avgViewsFormatted, '0');
  assert.equal(emptyMetrics.avgLikes, 0);
  assert.equal(emptyMetrics.avgComments, 0);
  assert.equal(emptyMetrics.er, 0);
  assert.equal(emptyMetrics.erFormatted, '0.00%');
  assert.equal(emptyMetrics.vr, 0);
  assert.equal(emptyMetrics.vrFormatted, '0.00%');
  assert.equal(emptyMetrics.vrBand, 'Very low');
  assert.equal(emptyMetrics.likesPerComment, 0);
  assert.equal(emptyMetrics.postsAnalyzed, 0);
  assert.equal(emptyMetrics.pinnedSkipped, 1);

  const zeroCommentMetrics = Core.calculateProfileMetrics({
    username: 'nocomments_user',
    followers: 1000,
    posts: [{ shortcode: 'P1', views: 500, likes: 250, comments: 0 }]
  });
  assert.equal(zeroCommentMetrics.avgViews, 500);
  assert.equal(zeroCommentMetrics.avgViewsFormatted, '500');
  assert.equal(zeroCommentMetrics.vrFormatted, '50.00%');
  assert.equal(zeroCommentMetrics.vrBand, 'Very high');
  assert.equal(zeroCommentMetrics.avgLikes, 250);
  assert.equal(zeroCommentMetrics.avgComments, 0);
  assert.equal(zeroCommentMetrics.erFormatted, '25.00%');
  assert.equal(zeroCommentMetrics.likesPerComment, 0);

  const lowCommentMetrics = Core.calculateProfileMetrics({
    username: 'lowcomments_user',
    followers: 1000,
    posts: [
      { shortcode: 'L1', likes: 10, comments: 1 },
      { shortcode: 'L2', likes: 10, comments: 1 },
      { shortcode: 'L3', likes: 10, comments: 0 },
      { shortcode: 'L4', likes: 10, comments: 0 },
      { shortcode: 'L5', likes: 10, comments: 0 },
      { shortcode: 'L6', likes: 10, comments: 0 }
    ]
  });
  assert.equal(lowCommentMetrics.avgLikes, 10);
  assert.equal(lowCommentMetrics.avgComments, 0);
  assert.equal(lowCommentMetrics.likesPerComment, 30, 'Should compute 60 totalLikes / 2 totalComments = 30 instead of 0');

  // Hidden likes (-1) on all reels alongside high view counts
  const hiddenLikesMetrics = Core.calculateProfileMetrics({
    username: 'hidden_likes_creator',
    followers: 50000,
    posts: Array.from({ length: 6 }, (_, i) => ({
      media: { code: `HL_${i}`, play_count: 25000, like_count: -1, comment_count: 100, media_type: 2, product_type: 'clips' }
    }))
  });
  assert.equal(hiddenLikesMetrics.avgViews, 25000);
  assert.equal(hiddenLikesMetrics.avgViewsFormatted, '25K');
  assert.equal(hiddenLikesMetrics.vrFormatted, '50.00%');
  assert.equal(hiddenLikesMetrics.vrBand, 'Very high');
  assert.equal(hiddenLikesMetrics.avgLikes, 0);
  assert.equal(hiddenLikesMetrics.avgComments, 100);
  assert.equal(hiddenLikesMetrics.erFormatted, '0.20%');
  assert.equal(hiddenLikesMetrics.likesPerComment, 0);
  console.log('   ✓ Edge cases passed');

  // 5. Test 10-Column CSV Generation (V.R., compact K/M AV VIEW, empty Price/REEL and ID/Phone at the end)
  console.log('5. Testing 10-column CSV export format...');
  const csv = Core.generateCsvContent([...calculatedProfiles, millionMetrics]);
  assert.ok(
    csv.startsWith('\uFEFFUSERNAME,Follower,ER,V.R.,AV VIEW,AV LIKE,AV COMMENTS,LIKES PER COMMENT,Price/REEL,ID/Phone\r\n'),
    'CSV header must match all 10 columns in exact order'
  );
  assert.ok(
    csv.includes('mmd.fate,"373,760",21.11%,32.11%,120K,"78,007",878,88.8,,\r\n'),
    'CSV row must include V.R., compact K/M AV VIEW (120K), and end with empty Price/REEL + ID/Phone cells'
  );
  assert.ok(
    csv.includes('million_creator,"500,000",16.93%,320.00%,1.6M,"83,333","1,300",64.1,,\r\n'),
    'CSV row for million-viewed creator must display 1.6M in AV VIEW column'
  );
  console.log('   ✓ CSV export passed');

  // 6. Test XLSX Binary Generation
  console.log('6. Testing XLSX binary generation and structure...');
  const xlsxBytes = Core.generateXlsxBytes(calculatedProfiles);
  assert.ok(xlsxBytes instanceof Uint8Array);
  assert.ok(xlsxBytes.length > 1000);
  assert.equal(xlsxBytes[0], 0x50);
  assert.equal(xlsxBytes[1], 0x4b);
  assert.equal(xlsxBytes[2], 0x03);
  assert.equal(xlsxBytes[3], 0x04);
  console.log(`   ✓ XLSX binary generated (${xlsxBytes.length} bytes)`);

  // 7. Test URL Username Extraction
  console.log('7. Testing Instagram URL profile username detection...');
  assert.equal(Core.extractProfileUsernameFromPath('/mmd.fate/'), 'mmd.fate');
  assert.equal(Core.extractProfileUsernameFromPath('/gallery_mahshid/reels/'), 'gallery_mahshid');
  assert.equal(Core.extractProfileUsernameFromPath('/p/ABC123xyz/'), null);
  assert.equal(Core.extractProfileUsernameFromPath('/reel/ABC123xyz/'), null);
  assert.equal(Core.extractProfileUsernameFromPath('/explore/'), null);
  assert.equal(Core.extractProfileUsernameFromPath('/direct/inbox/'), null);
  assert.equal(Core.extractProfileUsernameFromPath('/stories/mmd.fate/12345/'), null);
  assert.equal(Core.extractProfileUsernameFromPath('/'), null);
  console.log('   ✓ URL username extraction passed');

  // 8. Test Shared Google Sheet Deduplication & Sync Planning
  console.log('8. Testing Google Sheet strict deduplication & sync planning...');
  assert.equal(Core.normalizeUsernameKey('@MMD.Fate'), 'mmd.fate');
  assert.equal(Core.normalizeUsernameKey('https://www.instagram.com/MMD.Fate/'), 'mmd.fate');
  assert.equal(Core.normalizeUsernameKey('https://www.instagram.com/@MMD.Fate/'), 'mmd.fate');
  assert.equal(Core.normalizeUsernameKey('instagram.com/MMD.Fate/'), 'mmd.fate');
  assert.equal(Core.normalizeUsernameKey('www.instagram.com/@MMD.Fate/'), 'mmd.fate');
  assert.equal(
    Core.normalizeUsernameKey('=HYPERLINK("https://www.instagram.com/mmd.fate/", "mmd.fate")'),
    'mmd.fate'
  );
  assert.equal(
    Core.normalizeUsernameKey('=HYPERLINK("https://www.instagram.com/mmd.fate/"; "@MMD.Fate")'),
    'mmd.fate'
  );
  assert.equal(
    Core.normalizeUsernameKey('=HYPERLINK("https://www.instagram.com/mmd.fate/")'),
    'mmd.fate'
  );

  const dupList = [
    { ...calculatedProfiles[0], followers: 370000, pricePerReel: '$450' },
    { ...calculatedProfiles[1] },
    { ...calculatedProfiles[0], username: '@MMD.FATE', followers: 373760, pricePerReel: '' }
  ];
  const deduped = Core.deduplicateProfiles(dupList);
  assert.equal(deduped.length, 2, 'Duplicate @MMD.FATE must be merged in place');
  assert.equal(deduped[0].followers, 373760, 'Updated metrics must replace older metrics');
  assert.equal(deduped[0].pricePerReel, '$450', 'Existing non-empty Price/REEL must be preserved on re-scrape');

  // Simulate existing Google Sheet with header row, 2 existing profiles (one as =HYPERLINK, one duplicate row)
  const existingSheetRows = [
    ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL', 'ID/Phone'],
    ['=HYPERLINK("https://www.instagram.com/mmd.fate/", "mmd.fate")', 350000, '19.00%', '30.00%', 100000, 70000, 800, 87.5, '$500'],
    ['gallery_mahshid', 100000, '15.00%', '35.00%', 40000, 15000, 300, 50, ''],
    ['@MMD.FATE', 350000, '19.00%', '30.00%', 100000, 70000, 800, 87.5, ''] // pre-existing duplicate row 4
  ];

  const syncPlan = Core.planGoogleSheetSync(existingSheetRows, [
    calculatedProfiles[0], // mmd.fate (already in sheet at row 2)
    calculatedProfiles[1], // gallery_mahshid (already in sheet at row 3)
    calculatedProfiles[2], // sarrftm (NEW profile -> must append)
    { ...calculatedProfiles[2], username: 'SARRFTM' } // duplicate in input -> must NOT append twice
  ]);

  assert.equal(syncPlan.updates.length, 2, 'Must update the 2 existing profiles in place');
  assert.equal(syncPlan.updates[0].rowIndex, 2);
  assert.equal(syncPlan.updates[0].range, 'A2:J2');
  assert.equal(syncPlan.updates[0].values[4], '120K', 'AV VIEW in Google Sheet must be formatted in K/M notation');
  assert.equal(syncPlan.updates[0].values[8], '$500', 'Must preserve existing $500 Price/REEL in Google Sheet');
  assert.equal(syncPlan.updates[1].rowIndex, 3);
  assert.equal(syncPlan.updates[1].range, 'A3:J3');
  assert.equal(syncPlan.updates[1].values[4], '45K', 'AV VIEW in Google Sheet must be formatted in K/M notation');
  assert.equal(syncPlan.updates[1].values[8], '', 'Empty Price/REEL stays empty');
  assert.equal(syncPlan.appends.length, 1, 'Must append only the 1 new deduplicated profile (sarrftm)');
  assert.equal(syncPlan.appends[0][0], '=HYPERLINK("https://www.instagram.com/sarrftm/", "sarrftm")');
  assert.equal(syncPlan.appends[0][4], '90K', 'Appended AV VIEW in Google Sheet must be formatted in K/M notation');
  assert.equal(syncPlan.appends[0][8], '');
  assert.deepEqual(syncPlan.duplicateSheetRowIndices, [4], 'Must identify pre-existing duplicate row 4 in sheet');

  // Test Mode 2: Google Sheets REST API v4 sync with mock fetch
  const apiCalls = [];
  const mockFetch = async (url, init) => {
    apiCalls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    if (!init || init.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ values: existingSheetRows }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const syncRes = await Core.syncProfilesToGoogleSheet(
    [calculatedProfiles[0], calculatedProfiles[2]],
    {
      sheetUrl: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
      accessToken: 'ya29.mock_token'
    },
    mockFetch
  );
  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.mode, 'sheets_api');
  assert.equal(syncRes.updatedCount, 1);
  assert.equal(syncRes.appendedCount, 1);
  assert.equal(apiCalls.length, 3, 'Must perform GET values, POST batchUpdate, and POST append');

  // Test Mode 2 when Row 1 already contains profile data (no header row) -> must not clobber A1:I1 with headers
  const headerlessCalls = [];
  const headerlessRes = await Core.syncProfilesToGoogleSheet(
    [calculatedProfiles[0]],
    {
      sheetUrl: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      accessToken: 'ya29.mock_token'
    },
    async (url, init) => {
      headerlessCalls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
      if (!init || init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            values: [['mmd.fate', 300000, '15.00%', '25.00%', 90000, 50000, 500, 100, '$600']]
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  );
  assert.equal(headerlessRes.ok, true);
  assert.equal(headerlessRes.updatedCount, 1);
  assert.equal(headerlessCalls[1].body.data.length, 1, 'Must only write the updated profile at A1:I1 without clobbering it with a duplicate A1:I1 header entry');
  assert.equal(headerlessCalls[1].body.data[0].values[0][8], '$600', 'Must preserve $600 price on Row 1 profile');

  // Test Mode 1: Apps Script Web App sync with mock fetch
  const webAppRes = await Core.syncProfilesToGoogleSheet(
    [calculatedProfiles[0], calculatedProfiles[0]],
    {
      sheetUrl: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
      webAppUrl: 'https://script.google.com/macros/s/AKfycbx_mock/exec'
    },
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, updatedCount: 1, appendedCount: 0, duplicateRowsRemoved: 0 })
    })
  );
  assert.equal(webAppRes.ok, true);
  assert.equal(webAppRes.mode, 'webapp');
  assert.equal(webAppRes.totalSynced, 1, 'Must deduplicate before sending to Web App');
  console.log('   ✓ Google Sheet deduplication & sync tests passed');

  // 9. Execute generated Google Apps Script (doPost + doGet) in a sandboxed VM
  console.log('9. Executing generated Google Apps Script (doPost + doGet) against mock SpreadsheetApp...');
  const vm = require('node:vm');
  const scriptCode = Core.generateGoogleAppsScriptCode('https://docs.google.com/spreadsheets/d/mock_id/edit');
  const mockSheetRows = [
    ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL', 'ID/Phone'],
    ['=HYPERLINK("https://www.instagram.com/mmd.fate/"; "@mmd.fate")', 300000, '10.00%', '20.00%', 80000, 30000, 500, 60, '$750'],
    ['=HYPERLINK("https://www.instagram.com/mmd.fate/")', 300000, '10.00%', '20.00%', 80000, 30000, 500, 60, ''], // single-arg HYPERLINK duplicate
    ['instagram.com/MMD.FATE/', 300000, '10.00%', '20.00%', 80000, 30000, 500, 60, ''] // protocol-less URL duplicate
  ];

  const mockSheet = {
    getLastRow() {
      return mockSheetRows.length;
    },
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        setValues(vals) {
          for (let r = 0; r < numRows; r++) {
            const targetIdx = row - 1 + r;
            if (!mockSheetRows[targetIdx]) mockSheetRows[targetIdx] = [];
            for (let c = 0; c < numCols; c++) {
              mockSheetRows[targetIdx][col - 1 + c] = vals[r][c];
            }
          }
          return this;
        },
        setFontWeight() { return this; },
        setHorizontalAlignment() { return this; },
        setBackground() { return this; },
        getFormulas() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowArr = mockSheetRows[row - 1 + r] || [];
            out.push(rowArr.slice(col - 1, col - 1 + numCols).map((v) => (String(v || '').startsWith('=') ? v : '')));
          }
          return out;
        },
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowArr = mockSheetRows[row - 1 + r] || [];
            out.push(rowArr.slice(col - 1, col - 1 + numCols));
          }
          return out;
        }
      };
    },
    deleteRow(rowNum) {
      mockSheetRows.splice(rowNum - 1, 1);
    },
    appendRow(rowVals) {
      mockSheetRows.push(rowVals.slice());
    }
  };

  const sandbox = {
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    SpreadsheetApp: {
      openByUrl: () => ({ getSheets: () => [mockSheet], getSheetByName: () => mockSheet }),
      getActiveSpreadsheet: () => ({ getSheets: () => [mockSheet] })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(str) {
        return {
          _text: str,
          setMimeType() { return this; }
        };
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox);

  const doPostOutput = sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        profiles: [
          calculatedProfiles[0], // mmd.fate (updates row 2, preserves $750 price)
          calculatedProfiles[1], // gallery_mahshid (appends row 3)
          { ...calculatedProfiles[1], username: '@GALLERY_MAHSHID' } // duplicate in payload (ignored)
        ]
      })
    }
  });
  const doPostJson = JSON.parse(doPostOutput._text);
  assert.equal(doPostJson.ok, true);
  assert.equal(doPostJson.duplicateRowsRemoved, 2, 'Apps Script must delete both pre-existing duplicate rows (single-arg HYPERLINK + protocol-less URL)');
  assert.equal(doPostJson.updatedCount, 1, 'Apps Script must update mmd.fate in place');
  assert.equal(doPostJson.appendedCount, 1, 'Apps Script must append gallery_mahshid once');
  assert.equal(mockSheetRows.length, 3, 'Sheet must have 1 header row + 2 unique profile rows');
  assert.equal(mockSheetRows[1][4], '120K', 'Apps Script must write AV VIEW in K/M format (120K) in Column E');
  assert.equal(mockSheetRows[2][4], '45K', 'Apps Script must write AV VIEW in K/M format (45K) in Column E');
  assert.equal(mockSheetRows[1][8], '$750', 'Apps Script must preserve manual $750 Price/REEL in Column I');
  console.log('   ✓ Generated Google Apps Script VM execution passed');

  // 10. Verify Crow Scrapper Branding, @mhrshadfm Owner Attribution, and White Crow Logo Assets
  console.log('10. Verifying Crow Scrapper branding, @mhrshadfm owner attribution, and white crow logo assets...');
  const fs = require('node:fs');
  const path = require('node:path');
  assert.equal(Core.EXTENSION_NAME, 'Crow Scrapper');
  assert.equal(Core.EXTENSION_OWNER, '@mhrshadfm');
  assert.equal(Core.EXTENSION_OWNER_URL, 'https://www.instagram.com/mhrshadfm/');
  assert.ok(Core.CROW_WHITE_DATA_URI.startsWith('data:image/png;base64,'));

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Crow Scrapper');
  assert.equal(manifest.author, '@mhrshadfm');
  assert.ok(manifest.description.includes('Crow Scrapper by @mhrshadfm'));
  assert.equal(manifest.action.default_title, 'Crow Scrapper by @mhrshadfm');
  assert.ok(Array.isArray(manifest.web_accessible_resources) && manifest.web_accessible_resources.length > 0);
  assert.ok(manifest.web_accessible_resources[0].resources.includes('icons/*'));

  for (const iconFile of ['crow-white.png', 'icon16.png', 'icon48.png', 'icon128.png']) {
    const iconBuf = fs.readFileSync(path.join(__dirname, '../icons', iconFile));
    assert.ok(iconBuf.length > 200, `${iconFile} must be non-empty`);
    assert.deepEqual(Array.from(iconBuf.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${iconFile} must have valid PNG signature`);
  }
  console.log('   ✓ Crow Scrapper branding, @mhrshadfm attribution, and white crow PNG icons passed');

  console.log('\n=== All Node.js Core Tests Passed! ===');
}

runTests();
