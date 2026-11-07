/**
 * Core logic for Crow Scrapper (by @mhrshadfm) Extension.
 * Handles count parsing, pinned post & most-recent post exclusion, 6-recent-reel
 * engagement & view rate metrics (ER + benchmarks, V.R. + bands, AV VIEW, AV LIKE,
 * AV COMMENTS, LIKES PER COMMENT, Price/REEL), CSV generation, native OpenXML (.xlsx)
 * generation with clickable hyperlinks, and Google Sheets sync & deduplication.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.InstaScraperCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXTENSION_NAME = 'Crow Scrapper';
  const EXTENSION_OWNER = '@mhrshadfm';
  const EXTENSION_OWNER_URL = 'https://www.instagram.com/mhrshadfm/';
  const CROW_WHITE_DATA_URI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAF2ElEQVR42u1baWwVVRR+paAFCiJLCYLaiEUDLkWB9A/GpWqCa7QSiyYkaGLU5w8IamKUkFjcYzRqEDSVxSWWihWDC0ZF0YpARFHBiEWRgNVi6wMqRXgdv5N8E09uZl5nmHm8O6Yn+dK+mbed7557z/pSqV7plVjEcZx+wA3AKuBpoBwo+r8rPRiYAswHfgMOAGuBF4E64HXgKeBl4GohKekKDwXOB9LAQ8Ay4KDznwgJ20jCZuAb4BdgB8lZB0xOksIjgXE07xLgLOAu4CXgDeCwUr4b2AVsBbJ8LPffBZ4nCQ6fU2a74iOASvOL4vEE4HYqtBB4ElgKdFFplwhXZPW/JCk/qeuNQF9blS/myk8HFgGrgQ+5koJXgeXACiov+/xPQ3Et2/m6emC3un6PrQTIKj8HtBgm7id/57h3BOgEfgVeAzaoe0LaGTZvgyJgEDBavihQy9P9PWATsN/Y/34WIAS0Aj/wkNSyRT4jqR5hAHAH0BHASrLGXy0Lk+4aLzZcoStCzB+GlfiRc0XSSZjjodh+7vMst0FXDgsRb3Fi0sPgr3Kstih/qIdt8kjSreA2dfK3cuWzDHy2+8QJWvYBFUkmYKzyBh1UWtzpM0yQ2gMcls8mmYA+wB4S0MUVlSRoJd3dkRyr74rEHZclmYQNSkkhYQ1XPqsU7EnagJqkErDeUOYveoCsSpCCyD8SYySRgM+Ubw+qbK7gSeoMY5KifAVrAVFkLy1mKUPnr1lQqUgCAZcD30ZQXg7KjTT/Dm6fLA9W8SbjbSegkodc5igJmA1MBSYBVcDDDK520ZNIHWK4zQQcb8T+YaWdtYYZstrMREeyHtFNAuZaW0jJkROEkYw6AB9lCe5sXtvIM+Z021PkzU58IlughtUnkd+BxbafBbcymIlLtrIwu07lEpNsJuAEWSUnXtlGl+hGlE22W8FM9gHyJWIFZ9pMwEU8tPIlB1ll7mdzZtiURwLeB9603QquzCMBnSzHL7CZgAt9qsBxyvdAf5sbqZ15JkDabtfYSkAJW2rdefAArkjtsdpWAo4DboyYIfrVCfYqb1Bp8znwFvB4gJJ4WGlhye1n5h9VthLwMfAR8HnMBDSqQEsy0FuAWTYScC+/ZH3AgmjQeuF3wAfq2gK23qttI2AlFT9kdJOjyioWYN12206ggd3nQTYRsIIprMMZgbjOgjZuq3ZuBek53M0plGk2EdDk0f6KQ/axaCpDWJ8y3ljEPsRj1oznsZgZt+xQ7lAiwRe4HdpYRxQrmyeBmA0E3JkHAsw2+zucWBMSlqjnXGVLPqBP76kcrJQhyrdZ+nZCRIsZ7neTkB+5JT5hFdlhOX1CoQk41Wh69FH3BhotdSdA43S9YQEZKu4OazXTGnQlqazQ4bAbsHT4jORdxy5yA7/wGpq1KxLtPcjrdYwtljDKbDWsR0rnZRzkdDPR5oJOn9A83S0wsIfn9mcxZbxSYLEiq56Tao1c/S1cebeLdL96r0s5zeZwsq24UAR8oVbopICvGa22RaO6fhqDoJ0koJsEZFglmu1hgWm22l4BhhWCgLWKgPIQM8quBaz2mErbQxfYYvQWa71WWhTnAOgFhSCgWWVwfY/idQ943Eur0pgWGcmdnrJwakTk2pCvm8cTv9pninW5j7dYZk21WE5fhsM3hT2EqKT49bE+94ewJOZVMZprCwF1UZIThrYTc9wfY5wDekg7XdCcAB9+Lle/KOLsYXUPzylnE/WwR/NkZiH7gxKojIv4PucBNwesQG/ysIQDBdkONP10TD/ZmRPwuaM8Sm9iBU8Edb9xdoRk9UtjeK+Tw8wDcD5hvhq02M1KVO2xPPUbWKMbHsMA9gy2xSeHfO0o/kxvALdjWb4SnaH8EHFZpUxEpAx+X5SWFXOBU6hEXdgY4lhleYM5yDSCsfv1bItX8f+KCL9Ym0Xla/j4EuYBE2VGCDhHhrJSFk6JFasgZkiEnuIUklpCEx5Gwkt1Cz7VK70SWf4FtvDgfcaciTAAAAAASUVORK5CYII=';

  const RECENT_POSTS_LIMIT = 6;

  const SHEET_COLUMNS = [
    'USERNAME',
    'Follower',
    'ER',
    'V.R.',
    'AV VIEW',
    'AV LIKE',
    'AV COMMENTS',
    'LIKES PER COMMENT',
    'Price/REEL'
  ];

  /**
   * Parses human-formatted or raw counts from Instagram (e.g., "373,760", "71.9K", "1.2M", "1,5M", "120Kviews", "\u20661.5M\u2069", 878).
   * Clamps negative numbers (such as -1 for hidden like counts) to 0.
   * @param {string|number|null|undefined} raw
   * @returns {number}
   */
  function parseCount(raw) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
    }
    if (typeof raw !== 'string') return 0;

    // Strip invisible Unicode directional/zero-width marks and normalize Persian/Arabic digits & suffixes
    const str = raw
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u066B٫]/g, '.')
      .replace(/[\u066C٬]/g, ',')
      .replace(/میلیارد|ملیارد/g, 'B')
      .replace(/میلیون|ملیون|ملین/g, 'M')
      .replace(/([\d\s.,]|^)(?:mio|mln|mill(?:ion)?s?)\.?(?=$|[^a-zA-Z0-9])/gi, '$1M')
      .replace(/هزار/g, 'K')
      .trim();
    if (!str) return 0;

    // Extract the first number-like token with optional K/M/B suffix
    // Handles: "373,760 followers", "373Kfollowers", "120Kviews", "1.5M plays", "78,007 likes", "71.9K", "1,25M", "-1"
    const match = str.match(
      /(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d{1,3}(?:[ \u00A0\u202F]\d{3})+|-?\d+(?:[.,]\d+)?)\s*([kmbKMB])?(?=$|[^a-zA-Z0-9]|followers?|likes?|comments?|views?|plays?|reels?|posts?)/i
    );
    if (!match) return 0;

    let numPart = match[1].replace(/[\s\u00A0\u202F]+/g, '');
    const suffix = match[2] ? match[2].toUpperCase() : '';

    if (numPart.startsWith('-')) return 0;

    if (suffix) {
      // With suffix (e.g., "71.9K" or "1,5M" or "1,234.5K")
      if (numPart.includes(',') && numPart.includes('.')) {
        numPart = numPart.replace(/,/g, '');
      } else if (numPart.includes(',')) {
        // In "1,5M", comma is a decimal separator
        numPart = numPart.replace(',', '.');
      }
      const base = parseFloat(numPart);
      if (!Number.isFinite(base) || base < 0) return 0;
      const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
      return Math.round(base * mult);
    }

    // No suffix: commas and dots followed by 3 digits are thousand separators
    // e.g., "373,760" -> 373760, "1.234.567" -> 1234567
    if (/^\d{1,3}(,\d{3})+$/.test(numPart)) {
      numPart = numPart.replace(/,/g, '');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(numPart)) {
      numPart = numPart.replace(/\./g, '');
    } else {
      numPart = numPart.replace(/,/g, '');
    }

    const parsed = parseFloat(numPart);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  }

  /**
   * Formats a number into Instagram's compact written K/M/B notation (e.g. 120000 -> "120K", 1500000 -> "1.5M", 850 -> "850").
   * @param {number|string|null|undefined} num
   * @returns {string}
   */
  function formatCompactCount(num) {
    if (typeof num === 'string') {
      const parsedFromStr = parseCount(num);
      if (parsedFromStr <= 0) return '0';
      return formatCompactCount(parsedFromStr);
    }
    const n = Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
    if (n <= 0) return '0';

    if (n >= 1e9) {
      const b = Math.round((n / 1e9) * 10) / 10;
      return (Number.isInteger(b) ? String(b) : b.toFixed(1)) + 'B';
    }

    if (n >= 1e6) {
      const m = Math.round((n / 1e6) * 10) / 10;
      if (m >= 1000) {
        const b = Math.round((n / 1e9) * 10) / 10;
        return (Number.isInteger(b) ? String(b) : b.toFixed(1)) + 'B';
      }
      return (Number.isInteger(m) ? String(m) : m.toFixed(1)) + 'M';
    }

    if (n >= 1e3) {
      const k = (n >= 1e5 && n % 100 !== 0)
        ? Math.round(n / 1e3)
        : Math.round((n / 1e3) * 10) / 10;
      if (k >= 1000) {
        return '1M';
      }
      return (Number.isInteger(k) ? String(k) : k.toFixed(1)) + 'K';
    }

    return String(n);
  }

  /**
   * Converts a raw or written count into the numeric value corresponding to Instagram's written K/M/B badge.
   * For example, "1.5M" -> 1,500,000; 1,542,891 -> 1,500,000 ("1.5M"); "120K" -> 120,000; 452,891 -> 453,000 ("453K").
   * @param {string|number|null|undefined} raw
   * @returns {number}
   */
  function roundToWrittenCount(raw) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'string') {
      const cleaned = raw.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();
      if (
        /\d\s*(?:[kmbKMB]|هزار|میلیون|ملیون|ملین|میلیارد|ملیارد|mio|mln|mill(?:ion)?s?)\.?(?=$|[^a-zA-Z0-9]|followers?|likes?|comments?|views?|plays?|reels?|posts?)/i.test(
          cleaned
        )
      ) {
        return parseCount(cleaned);
      }
    }
    const parsed = parseCount(raw);
    if (parsed <= 0) return 0;
    return parseCount(formatCompactCount(parsed));
  }

  /**
   * Returns the View Rate (V.R.) band classification for a given V.R. percentage:
   * - Very low: ≤ 10%
   * - Low: 10%-15%
   * - Medium: 15%-30%
   * - High: 30%-50%
   * - Very high: ≥ 50%
   *
   * @param {number|string} vrPercent
   * @returns {{ band: string, range: string, label: string, vrBand: string, vrBandRange: string }}
   */
  function getViewRateBand(vrPercent) {
    const raw = typeof vrPercent === 'string' ? parseFloat(vrPercent.replace('%', '')) : Number(vrPercent);
    const vr = Number.isFinite(raw) && raw > 0 ? raw : 0;

    let band = 'Very low';
    let range = '≤ 10%';

    if (vr <= 10) {
      band = 'Very low';
      range = '≤ 10%';
    } else if (vr <= 15) {
      band = 'Low';
      range = '10%-15%';
    } else if (vr <= 30) {
      band = 'Medium';
      range = '15%-30%';
    } else if (vr < 50) {
      band = 'High';
      range = '30%-50%';
    } else {
      band = 'Very high';
      range = '≥ 50%';
    }

    return {
      band,
      range,
      label: band,
      vrBand: band,
      vrBandRange: range
    };
  }

  /**
   * Returns the Engagement Rate (E.R.) benchmark for a profile based on follower count:
   * - ≤ 1,000 followers: 8%
   * - 1,000 - 5,000 followers: 5.7%
   * - 5,000 - 10,000 followers: 4%
   * - 10,000 - 100,000 followers: 2.4%
   * - ≥ 100,000 followers: 1.7%
   *
   * @param {number|string} followers
   * @param {number|string} [erPercent=0]
   * @returns {{
   *   benchmark: number,
   *   formatted: string,
   *   tier: string,
   *   aboveBenchmark: boolean,
   *   erBenchmark: number,
   *   erBenchmarkFormatted: string,
   *   erBenchmarkTier: string,
   *   erAboveBenchmark: boolean
   * }}
   */
  function getErBenchmark(followers, erPercent = 0) {
    const f = typeof followers === 'number' ? Math.max(0, followers) : parseCount(followers);
    const rawEr = typeof erPercent === 'string' ? parseFloat(erPercent.replace('%', '')) : Number(erPercent);
    const er = Number.isFinite(rawEr) ? rawEr : 0;

    let benchmark = 8;
    let formatted = '8%';
    let tier = '≤ 1,000';

    if (f <= 1000) {
      benchmark = 8;
      formatted = '8%';
      tier = '≤ 1,000';
    } else if (f <= 5000) {
      benchmark = 5.7;
      formatted = '5.7%';
      tier = '1,000 - 5,000';
    } else if (f <= 10000) {
      benchmark = 4;
      formatted = '4%';
      tier = '5,000 - 10,000';
    } else if (f <= 100000) {
      benchmark = 2.4;
      formatted = '2.4%';
      tier = '10,000 - 100,000';
    } else {
      benchmark = 1.7;
      formatted = '1.7%';
      tier = '≥ 100,000';
    }

    const aboveBenchmark = er >= benchmark;

    return {
      benchmark,
      formatted,
      tier,
      aboveBenchmark,
      erBenchmark: benchmark,
      erBenchmarkFormatted: formatted,
      erBenchmarkTier: tier,
      erAboveBenchmark: aboveBenchmark
    };
  }

  /**
   * Determines whether a normalized or raw API/DOM post object represents a pinned post.
   * @param {object} post
   * @param {Set<string>} [domPinnedShortcodes]
   * @returns {boolean}
   */
  function isPostPinned(post, domPinnedShortcodes) {
    if (!post || typeof post !== 'object') return false;

    if (post.isPinned === true || post.is_pinned === true || post.pinned === true) {
      return true;
    }

    if (Array.isArray(post.pinned_for_users) && post.pinned_for_users.length > 0) {
      return true;
    }

    if (Array.isArray(post.timeline_pinned_user_ids) && post.timeline_pinned_user_ids.length > 0) {
      return true;
    }

    if (Array.isArray(post.clips_tab_pinned_user_ids) && post.clips_tab_pinned_user_ids.length > 0) {
      return true;
    }

    if (
      post.clips_metadata &&
      Array.isArray(post.clips_metadata.clips_tab_pinned_user_ids) &&
      post.clips_metadata.clips_tab_pinned_user_ids.length > 0
    ) {
      return true;
    }

    const shortcode = post.shortcode || post.code || '';
    if (shortcode && domPinnedShortcodes && domPinnedShortcodes.has(shortcode)) {
      return true;
    }

    return false;
  }

  /**
   * Normalizes a post/reel from Instagram Clips API (`rawPost.media`), GraphQL (`rawPost.node`),
   * v1 feed (`rawPost`), or DOM object.
   * @param {object} rawPost
   * @param {Set<string>} [domPinnedShortcodes]
   * @param {number} [index]
   * @returns {{
   *   shortcode: string,
   *   views: number,
   *   likes: number,
   *   comments: number,
   *   isPinned: boolean,
   *   isReel: boolean,
   *   isExplicitNonReel: boolean,
   *   timestamp: number,
   *   index: number
   * }}
   */
  function normalizePost(rawPost, domPinnedShortcodes, index = 0) {
    const base = rawPost && typeof rawPost === 'object' ? rawPost : {};
    const node = base.media && typeof base.media === 'object'
      ? base.media
      : base.node && typeof base.node === 'object'
        ? base.node
        : base;

    const shortcode = String(
      node.shortcode || node.code || node.id || base.shortcode || base.code || base.id || ''
    );

    const viewCandidates = [
      node.views,
      node.plays,
      node.play_count,
      node.ig_play_count,
      node.fb_play_count,
      node.view_count,
      node.video_view_count,
      node.video_play_count,
      node.clips_metadata?.play_count,
      node.clips_metadata?.ig_play_count,
      node.clips_metadata?.view_count,
      base.views,
      base.plays,
      base.play_count,
      base.ig_play_count,
      base.fb_play_count,
      base.view_count,
      base.video_view_count,
      base.video_play_count
    ].filter((v) => v !== undefined && v !== null);

    const hasViewField = viewCandidates.length > 0;
    const hasReliableSource = Boolean(
      (node.views !== undefined && node.views !== null && node.hasViews !== false && parseCount(node.views) > 0) ||
      (node.plays !== undefined && node.plays !== null && parseCount(node.plays) > 0) ||
      (node.play_count !== undefined && node.play_count !== null && parseCount(node.play_count) > 0) ||
      (node.ig_play_count !== undefined && node.ig_play_count !== null && parseCount(node.ig_play_count) > 0) ||
      (node.fb_play_count !== undefined && node.fb_play_count !== null && parseCount(node.fb_play_count) > 0) ||
      (node.video_play_count !== undefined && node.video_play_count !== null && parseCount(node.video_play_count) > 0) ||
      (node.clips_metadata?.play_count !== undefined && node.clips_metadata?.play_count !== null && parseCount(node.clips_metadata.play_count) > 0) ||
      (node.clips_metadata?.ig_play_count !== undefined && node.clips_metadata?.ig_play_count !== null && parseCount(node.clips_metadata.ig_play_count) > 0) ||
      (base.views !== undefined && base.views !== null && base.hasViews !== false && parseCount(base.views) > 0) ||
      (base.plays !== undefined && base.plays !== null && parseCount(base.plays) > 0) ||
      (base.play_count !== undefined && base.play_count !== null && parseCount(base.play_count) > 0) ||
      (base.ig_play_count !== undefined && base.ig_play_count !== null && parseCount(base.ig_play_count) > 0) ||
      (base.fb_play_count !== undefined && base.fb_play_count !== null && parseCount(base.fb_play_count) > 0) ||
      (base.video_play_count !== undefined && base.video_play_count !== null && parseCount(base.video_play_count) > 0)
    );
    const hasReliableViews =
      node.hasReliableViews === false || base.hasReliableViews === false
        ? false
        : Boolean(node.hasReliableViews === true || base.hasReliableViews === true || hasReliableSource);

    let rawLikes = 0;
    if (node.likes !== undefined) {
      rawLikes = node.likes;
    } else if (node.like_count !== undefined) {
      rawLikes = node.like_count;
    } else if (node.edge_media_preview_like && node.edge_media_preview_like.count !== undefined) {
      rawLikes = node.edge_media_preview_like.count;
    } else if (node.edge_liked_by && node.edge_liked_by.count !== undefined) {
      rawLikes = node.edge_liked_by.count;
    } else if (base.likes !== undefined) {
      rawLikes = base.likes;
    }

    let rawComments = 0;
    if (node.comments !== undefined) {
      rawComments = node.comments;
    } else if (node.comment_count !== undefined) {
      rawComments = node.comment_count;
    } else if (node.edge_media_to_comment && node.edge_media_to_comment.count !== undefined) {
      rawComments = node.edge_media_to_comment.count;
    } else if (node.edge_media_preview_comment && node.edge_media_preview_comment.count !== undefined) {
      rawComments = node.edge_media_preview_comment.count;
    } else if (base.comments !== undefined) {
      rawComments = base.comments;
    }

    const timestamp = Number(
      node.timestamp ?? node.taken_at_timestamp ?? node.taken_at ?? base.timestamp ?? base.taken_at_timestamp ?? 0
    );

    const pinned =
      isPostPinned(node, domPinnedShortcodes) ||
      (base !== node && isPostPinned(base, domPinnedShortcodes));

    const explicitFalseFlag = Boolean(
      node.isReel === false ||
      node.is_reel === false ||
      base.isReel === false ||
      base.is_reel === false
    );

    const isPhotoOrCarouselType =
      node.media_type === 1 ||
      node.media_type === 8 ||
      node.__typename === 'GraphImage' ||
      node.__typename === 'XDTGraphImage' ||
      node.__typename === 'GraphSidecar' ||
      node.__typename === 'XDTGraphSidecar' ||
      (node.is_video === false && node.product_type !== 'clips' && node.isReel !== true);

    const isExplicitNonReel = Boolean(
      node.isExplicitNonReel === true ||
      base.isExplicitNonReel === true ||
      isPhotoOrCarouselType ||
      explicitFalseFlag
    );

    const parsedViews = viewCandidates.length > 0
      ? Math.max(0, ...viewCandidates.map((v) => roundToWrittenCount(v)))
      : 0;
    const hasReelIndicator = Boolean(
      node.isReel === true ||
      node.is_reel === true ||
      base.isReel === true ||
      base.is_reel === true ||
      node.is_video === true ||
      node.media_type === 2 ||
      node.product_type === 'clips' ||
      node.__typename === 'GraphVideo' ||
      node.__typename === 'XDTGraphVideo' ||
      Array.isArray(node.video_versions) ||
      Boolean(node.video_url) ||
      Boolean(base.media && typeof base.media === 'object') ||
      (hasViewField && (parsedViews > 0 || node.hasViews !== false))
    );

    const isReel = isExplicitNonReel ? false : hasReelIndicator;

    return {
      shortcode,
      views: parsedViews,
      viewsFormatted: formatCompactCount(parsedViews),
      hasReliableViews,
      likes: parseCount(rawLikes),
      comments: parseCount(rawComments),
      isPinned: Boolean(pinned),
      isReel: Boolean(isReel),
      isExplicitNonReel,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      index
    };
  }

  /**
   * Marks any top-3 grid items (index 0..2) whose timestamps are older than
   * subsequent chronological items as pinned.
   * @param {Array<object>} list
   */
  function markTimestampInvertedPins(list) {
    for (let i = 0; i < Math.min(3, list.length); i++) {
      const candidate = list[i];
      if (!candidate.isPinned && candidate.timestamp > 0) {
        const hasNewerSubsequentPost = list
          .slice(i + 1)
          .some((later) => later.timestamp > candidate.timestamp);
        if (hasNewerSubsequentPost) {
          candidate.isPinned = true;
        }
      }
    }
  }

  /**
   * Normalizes an array of raw posts and marks any top-3 grid posts (index 0..2)
   * whose timestamps are older than subsequent chronological posts as pinned.
   * @param {Array<object>} rawPosts
   * @param {Set<string>} [domPinnedShortcodes]
   * @returns {Array<object>}
   */
  function normalizeAndDetectPinnedPosts(rawPosts, domPinnedShortcodes) {
    if (!Array.isArray(rawPosts) || rawPosts.length === 0) return [];
    const normalized = rawPosts.map((p, idx) => normalizePost(p, domPinnedShortcodes, idx));
    markTimestampInvertedPins(normalized);

    const reelsOnly = normalized.filter((p) => p.isReel === true);
    if (reelsOnly.length > 0 && reelsOnly.length < normalized.length) {
      markTimestampInvertedPins(reelsOnly);
    }

    return normalized;
  }

  /**
   * Filters out all pinned posts (and optionally the single most recent post/reel)
   * and selects up to 6 recent non-pinned reels/posts.
   * - If the list contains both explicit reels (`isReel === true`) and non-reels (`isReel === false`),
   *   filters to `isReel === true` first.
   * - If no items have `isReel === true` (e.g. legacy test inputs with only `{ likes, comments }`),
   *   keeps all items for backward compatibility.
   * - Supports `options.excludeMostRecent === true` to skip the #1 newest non-pinned post/reel.
   *
   * @param {Array<object>} rawPosts
   * @param {Set<string>} [domPinnedShortcodes]
   * @param {number|object} [limit=6]
   * @param {{ excludeMostRecent?: boolean, limit?: number }} [options={}]
   * @returns {Array<object>}
   */
  function selectRecentNonPinnedPosts(rawPosts, domPinnedShortcodes, limit = RECENT_POSTS_LIMIT, options = {}) {
    let opts = options || {};
    let effectiveLimit = RECENT_POSTS_LIMIT;
    if (limit && typeof limit === 'object') {
      opts = limit;
      effectiveLimit = typeof opts.limit === 'number' ? opts.limit : RECENT_POSTS_LIMIT;
    } else if (typeof limit === 'number') {
      effectiveLimit = limit;
    }
    effectiveLimit = Math.max(0, effectiveLimit);

    const normalized = normalizeAndDetectPinnedPosts(rawPosts, domPinnedShortcodes);
    if (normalized.length === 0) return [];

    const skipCount = opts && opts.excludeMostRecent === true ? 1 : 0;
    const hasReels = normalized.some((p) => p.isReel === true);
    const pool = hasReels ? normalized.filter((p) => p.isReel === true) : normalized;

    const nonPinned = pool.filter((p) => !p.isPinned);

    // If all posts carry valid positive timestamps, sort descending by timestamp (most recent first)
    const allHaveTimestamps = nonPinned.length > 1 && nonPinned.every((p) => p.timestamp > 0);
    if (allHaveTimestamps) {
      nonPinned.sort((a, b) => b.timestamp - a.timestamp || a.index - b.index);
    }

    return nonPinned.slice(skipCount, skipCount + effectiveLimit);
  }

  /**
   * Calculates engagement & view rate metrics for a profile based on up to 6 recent non-pinned reels/posts.
   * Formulas:
   * - AV VIEW = Math.round(sum(views) / count), formatted in K/M style via formatCompactCount
   * - AV LIKE = Math.round(sum(likes) / count)
   * - AV COMMENTS = Math.round(sum(comments) / count)
   * - ER (%) = ((AV LIKE + AV COMMENTS) / followers) * 100, rounded to 2 decimal places
   * - V.R. (%) = (AV VIEW / followers) * 100, rounded to 2 decimal places
   * - LIKES PER COMMENT = AV LIKE / AV COMMENTS, rounded to 1 decimal place
   *
   * @param {{
   *   username: string,
   *   followers: number|string,
   *   posts: Array<object>,
   *   domPinnedShortcodes?: Set<string>|Array<string>,
   *   excludeMostRecent?: boolean,
   *   pricePerReel?: string|number
   * }} input
   * @returns {object}
   */
  function calculateProfileMetrics(input) {
    const safeInput = input && typeof input === 'object' ? input : {};
    const cleanUsername = extractCleanUsername(safeInput.username);

    const followers = parseCount(safeInput.followers);
    const rawPosts = Array.isArray(safeInput.posts) ? safeInput.posts : [];
    const domPinned = safeInput.domPinnedShortcodes instanceof Set
      ? safeInput.domPinnedShortcodes
      : new Set(Array.isArray(safeInput.domPinnedShortcodes) ? safeInput.domPinnedShortcodes : []);
    const excludeMostRecent = Boolean(safeInput.excludeMostRecent);

    const normalizedAll = normalizeAndDetectPinnedPosts(rawPosts, domPinned);
    const hasReels = normalizedAll.some((p) => p.isReel === true);
    const pool = hasReels
      ? normalizedAll.filter((p) => p.isReel === true)
      : normalizedAll;

    const pinnedSkipped = normalizedAll.filter((p) => p.isPinned).length;
    const nonPinnedPoolCount = pool.filter((p) => !p.isPinned).length;
    const mostRecentSkipped = excludeMostRecent && nonPinnedPoolCount > 0 ? 1 : 0;

    const recentPosts = selectRecentNonPinnedPosts(rawPosts, domPinned, RECENT_POSTS_LIMIT, {
      excludeMostRecent
    });
    const count = recentPosts.length;

    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let avgViews = 0;
    let avgLikes = 0;
    let avgComments = 0;

    if (count > 0) {
      totalViews = recentPosts.reduce((acc, p) => acc + (p.views || 0), 0);
      totalLikes = recentPosts.reduce((acc, p) => acc + (p.likes || 0), 0);
      totalComments = recentPosts.reduce((acc, p) => acc + (p.comments || 0), 0);
      avgViews = Math.round(totalViews / count);
      avgLikes = Math.round(totalLikes / count);
      avgComments = Math.round(totalComments / count);
    }

    const avgViewsFormatted = formatCompactCount(avgViews);

    const erRaw = followers > 0 ? ((avgLikes + avgComments) / followers) * 100 : 0;
    const er = Number.isFinite(erRaw) ? Number(erRaw.toFixed(2)) : 0;
    const erFormatted = er.toFixed(2) + '%';
    const erBench = getErBenchmark(followers, er);

    const vrRaw = followers > 0 ? (avgViews / followers) * 100 : 0;
    const vr = Number.isFinite(vrRaw) ? Number(vrRaw.toFixed(2)) : 0;
    const vrFormatted = vr.toFixed(2) + '%';
    const vrBandInfo = getViewRateBand(vr);

    const lpcRaw = avgComments > 0
      ? avgLikes / avgComments
      : totalComments > 0
        ? totalLikes / totalComments
        : 0;
    const likesPerComment = Number.isFinite(lpcRaw) ? Math.round(lpcRaw * 10) / 10 : 0;

    const pricePerReel =
      safeInput.pricePerReel !== undefined && safeInput.pricePerReel !== null
        ? String(safeInput.pricePerReel).trim()
        : '';

    return {
      username: cleanUsername,
      profileUrl: cleanUsername ? `https://www.instagram.com/${cleanUsername}/` : 'https://www.instagram.com/',
      followers,
      er,
      erFormatted,
      erBenchmark: erBench.benchmark,
      erBenchmarkFormatted: erBench.formatted,
      erBenchmarkTier: erBench.tier,
      erAboveBenchmark: erBench.aboveBenchmark,
      vr,
      vrFormatted,
      vrBand: vrBandInfo.band,
      vrBandRange: vrBandInfo.range,
      avgViews,
      avgViewsFormatted,
      avgLikes,
      avgComments,
      likesPerComment,
      pricePerReel,
      postsAnalyzed: count,
      pinnedSkipped,
      mostRecentSkipped,
      excludeMostRecent,
      scrapedAt: new Date().toISOString()
    };
  }

  /**
   * Formats an integer with thousand commas (e.g. 373760 -> "373,760").
   * @param {number} num
   * @returns {string}
   */
  function formatNumberWithCommas(num) {
    const n = Number(num) || 0;
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Formats Likes Per Comment (e.g. 88.7 -> "88.7", 185 -> "185").
   * @param {number} num
   * @returns {string}
   */
  function formatLikesPerComment(num) {
    const n = Number(num) || 0;
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  /**
   * Escapes a CSV cell value.
   * @param {string|number} val
   * @returns {string}
   */
  function escapeCsvCell(val) {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * Generates a UTF-8 CSV string matching the 9 columns:
   * USERNAME, Follower, ER, V.R., AV VIEW, AV LIKE, AV COMMENTS, LIKES PER COMMENT, Price/REEL
   * Includes UTF-8 BOM so Microsoft Excel opens it with proper encoding.
   * @param {Array<object>} profiles
   * @returns {string}
   */
  function generateCsvContent(profiles) {
    const headers = SHEET_COLUMNS.slice();
    const rows = [headers.map(escapeCsvCell).join(',')];

    const list = Array.isArray(profiles) ? profiles : [];
    for (const item of list) {
      const username = String(item.username || '').trim();
      const followersStr = formatNumberWithCommas(item.followers);
      const erStr = typeof item.erFormatted === 'string'
        ? item.erFormatted
        : Number(item.er || 0).toFixed(2) + '%';
      const vrStr = typeof item.vrFormatted === 'string'
        ? item.vrFormatted
        : Number(item.vr || 0).toFixed(2) + '%';
      const avgViewsStr = (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
        ? item.avgViewsFormatted
        : formatCompactCount(item.avgViews);
      const avgLikesStr = formatNumberWithCommas(item.avgLikes);
      const avgCommentsStr = formatNumberWithCommas(item.avgComments);
      const lpcStr = formatLikesPerComment(item.likesPerComment);
      const priceStr = item.pricePerReel !== undefined && item.pricePerReel !== null
        ? String(item.pricePerReel).trim()
        : '';

      rows.push(
        [username, followersStr, erStr, vrStr, avgViewsStr, avgLikesStr, avgCommentsStr, lpcStr, priceStr]
          .map(escapeCsvCell)
          .join(',')
      );
    }

    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  // ============================================================================
  // Native OpenXML (.xlsx) Generator with Clickable Username Hyperlinks & Styling
  // ============================================================================

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Precomputed CRC32 table for ZIP archive creation
  const CRC32_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function stringToUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }

  /**
   * Packs an array of { name: string, data: Uint8Array } into a valid ZIP Uint8Array (Store method).
   * @param {Array<{ name: string, data: Uint8Array }>} files
   * @returns {Uint8Array}
   */
  function createZipArchive(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = stringToUtf8Bytes(file.name);
      const dataBytes = file.data;
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + file name)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true); // signature
      lv.setUint16(4, 20, true);         // version needed (2.0)
      lv.setUint16(6, 0x0800, true);     // general purpose bit flag (UTF-8)
      lv.setUint16(8, 0, true);          // compression method (0 = Store)
      lv.setUint16(10, 0, true);         // last mod file time
      lv.setUint16(12, 0x5421, true);    // last mod file date
      lv.setUint32(14, crc, true);       // crc-32
      lv.setUint32(18, size, true);      // compressed size
      lv.setUint32(22, size, true);      // uncompressed size
      lv.setUint16(26, nameBytes.length, true); // file name length
      lv.setUint16(28, 0, true);         // extra field length
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, dataBytes);

      // Central directory file header (46 bytes + file name)
      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(centralHeader.buffer);
      cv.setUint32(0, 0x02014b50, true); // signature
      cv.setUint16(4, 20, true);         // version made by
      cv.setUint16(6, 20, true);         // version needed
      cv.setUint16(8, 0x0800, true);     // general purpose bit flag (UTF-8)
      cv.setUint16(10, 0, true);         // compression method (0 = Store)
      cv.setUint16(12, 0, true);         // last mod time
      cv.setUint16(14, 0x5421, true);    // last mod date
      cv.setUint32(16, crc, true);       // crc-32
      cv.setUint32(20, size, true);      // compressed size
      cv.setUint32(24, size, true);      // uncompressed size
      cv.setUint16(28, nameBytes.length, true); // file name length
      cv.setUint16(30, 0, true);         // extra field length
      cv.setUint16(32, 0, true);         // file comment length
      cv.setUint16(34, 0, true);         // disk number start
      cv.setUint16(36, 0, true);         // internal file attributes
      cv.setUint32(38, 0, true);         // external file attributes
      cv.setUint32(42, offset, true);    // relative offset of local header
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);
      offset += localHeader.length + size;
    }

    const centralSize = centralParts.reduce((acc, arr) => acc + arr.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);          // EOCD signature
    ev.setUint16(4, 0, true);                   // disk number
    ev.setUint16(6, 0, true);                   // central dir start disk
    ev.setUint16(8, files.length, true);        // entries on disk
    ev.setUint16(10, files.length, true);       // total entries
    ev.setUint32(12, centralSize, true);        // size of central directory
    ev.setUint32(16, offset, true);             // offset of central directory
    ev.setUint16(20, 0, true);                  // comment length

    const totalLength = offset + centralSize + eocd.length;
    const out = new Uint8Array(totalLength);
    let pos = 0;
    for (const part of localParts) {
      out.set(part, pos);
      pos += part.length;
    }
    for (const part of centralParts) {
      out.set(part, pos);
      pos += part.length;
    }
    out.set(eocd, pos);
    return out;
  }

  /**
   * Generates a complete, valid OpenXML (.xlsx) binary file (as Uint8Array) with 9 columns:
   * - USERNAME: Sky Blue (#78C8F0), clickable hyperlink to https://www.instagram.com/<username>/
   * - Follower: Green (#92D050), #,##0
   * - ER: Purple/Pink (#D878D8), 0.00%
   * - V.R.: Purple/Pink (#D878D8), 0.00%
   * - AV VIEW, AV LIKE, AV COMMENTS: Orange/Peach (#F4B084), #,##0
   * - LIKES PER COMMENT: Orange/Peach (#F4B084), numeric
   * - Price/REEL: Orange/Peach (#F4B084), empty cell at end of row by default (or shared string if set)
   *
   * @param {Array<object>} profiles
   * @returns {Uint8Array}
   */
  function generateXlsxBytes(profiles) {
    const list = Array.isArray(profiles) ? profiles : [];

    // Build shared strings table
    const sharedStrings = [];
    const sharedStringMap = new Map();
    function getSharedStringIndex(text) {
      const str = String(text ?? '');
      if (sharedStringMap.has(str)) {
        return sharedStringMap.get(str);
      }
      const idx = sharedStrings.length;
      sharedStrings.push(str);
      sharedStringMap.set(str, idx);
      return idx;
    }

    const headers = SHEET_COLUMNS.slice();
    // Header style IDs: 1=Blue, 2=Green, 3=Purple, 4=Orange
    const headerStyles = [1, 2, 3, 3, 4, 4, 4, 4, 4];
    const colLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

    const sheetRowsXml = [];

    // Row 1: Header row
    const headerCellsXml = headers.map((h, cIdx) => {
      const sIdx = getSharedStringIndex(h);
      const ref = `${colLetters[cIdx]}1`;
      const styleId = headerStyles[cIdx];
      return `<c r="${ref}" t="s" s="${styleId}"><v>${sIdx}</v></c>`;
    });
    sheetRowsXml.push(`<row r="1" ht="22" customHeight="1">${headerCellsXml.join('')}</row>`);

    const hyperlinksXml = [];
    const sheetRelsXml = [];

    // Data rows (2 .. list.length + 1)
    list.forEach((item, idx) => {
      const rowNum = idx + 2;
      const rId = `rId${idx + 1}`;
      const username = String(item.username || '').trim();
      const profileUrl = item.profileUrl || (username ? `https://www.instagram.com/${username}/` : 'https://www.instagram.com/');
      const followers = Number(item.followers) || 0;
      const erDecimal = Number(((Number(item.er) || 0) / 100).toFixed(6));
      const vrDecimal = Number(((Number(item.vr) || 0) / 100).toFixed(6));
      const avgViewsText = (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
        ? item.avgViewsFormatted
        : formatCompactCount(item.avgViews);
      const avgLikes = Number(item.avgLikes) || 0;
      const avgComments = Number(item.avgComments) || 0;
      const lpc = Math.round((Number(item.likesPerComment) || 0) * 10) / 10;
      const priceText = item.pricePerReel !== undefined && item.pricePerReel !== null
        ? String(item.pricePerReel).trim()
        : '';

      const uStrIdx = getSharedStringIndex(username);
      const avgViewsStrIdx = getSharedStringIndex(avgViewsText);
      const priceCellXml = priceText
        ? `<c r="I${rowNum}" t="s" s="8"><v>${getSharedStringIndex(priceText)}</v></c>`
        : `<c r="I${rowNum}" s="8"/>`;

      const cells = [
        // Col A: USERNAME (shared string + hyperlink style 5)
        `<c r="A${rowNum}" t="s" s="5"><v>${uStrIdx}</v></c>`,
        // Col B: Follower (integer format #,##0 style 6)
        `<c r="B${rowNum}" s="6"><v>${Math.round(followers)}</v></c>`,
        // Col C: ER (percentage format 0.00% style 7)
        `<c r="C${rowNum}" s="7"><v>${erDecimal}</v></c>`,
        // Col D: V.R. (percentage format 0.00% style 7)
        `<c r="D${rowNum}" s="7"><v>${vrDecimal}</v></c>`,
        // Col E: AV VIEW (compact K/M shared string style 8)
        `<c r="E${rowNum}" t="s" s="8"><v>${avgViewsStrIdx}</v></c>`,
        // Col F: AV LIKE (integer format #,##0 style 6)
        `<c r="F${rowNum}" s="6"><v>${Math.round(avgLikes)}</v></c>`,
        // Col G: AV COMMENTS (integer format #,##0 style 6)
        `<c r="G${rowNum}" s="6"><v>${Math.round(avgComments)}</v></c>`,
        // Col H: LIKES PER COMMENT (general numeric style 8)
        `<c r="H${rowNum}" s="8"><v>${lpc}</v></c>`,
        // Col I: Price/REEL (empty cell by default at the end of the row)
        priceCellXml
      ];

      sheetRowsXml.push(`<row r="${rowNum}" ht="19" customHeight="1">${cells.join('')}</row>`);

      hyperlinksXml.push(
        `<hyperlink ref="A${rowNum}" r:id="${rId}" display="${escapeXml(username)}" tooltip="Open @${escapeXml(username)} on Instagram"/>`
      );
      sheetRelsXml.push(
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(profileUrl)}" TargetMode="External"/>`
      );
    });

    const lastRow = Math.max(1, list.length + 1);
    const dimensionRef = `A1:I${lastRow}`;

    const contentTypesXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '  <Default Extension="xml" ContentType="application/xml"/>',
      '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
      '</Types>'
    ].join('\n');

    const rootRelsXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '</Relationships>'
    ].join('\n');

    const workbookXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '  <sheets>',
      '    <sheet name="Crow Scrapper" sheetId="1" r:id="rId1"/>',
      '  </sheets>',
      '</workbook>'
    ].join('\n');

    const workbookRelsXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>',
      '</Relationships>'
    ].join('\n');

    const stylesXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '  <numFmts count="2">',
      '    <numFmt numFmtId="164" formatCode="#,##0"/>',
      '    <numFmt numFmtId="165" formatCode="0.00%"/>',
      '  </numFmts>',
      '  <fonts count="3">',
      '    <font><sz val="11"/><color rgb="FF000000"/><name val="Arial"/><family val="2"/></font>',
      '    <font><b/><sz val="11"/><color rgb="FF000000"/><name val="Arial"/><family val="2"/></font>',
      '    <font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Arial"/><family val="2"/></font>',
      '  </fonts>',
      '  <fills count="6">',
      '    <fill><patternFill patternType="none"/></fill>',
      '    <fill><patternFill patternType="gray125"/></fill>',
      '    <fill><patternFill patternType="solid"><fgColor rgb="FF78C8F0"/><bgColor indexed="64"/></patternFill></fill>',
      '    <fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>',
      '    <fill><patternFill patternType="solid"><fgColor rgb="FFD878D8"/><bgColor indexed="64"/></patternFill></fill>',
      '    <fill><patternFill patternType="solid"><fgColor rgb="FFF4B084"/><bgColor indexed="64"/></patternFill></fill>',
      '  </fills>',
      '  <borders count="2">',
      '    <border><left/><right/><top/><bottom/><diagonal/></border>',
      '    <border>',
      '      <left style="thin"><color rgb="FF000000"/></left>',
      '      <right style="thin"><color rgb="FF000000"/></right>',
      '      <top style="thin"><color rgb="FF000000"/></top>',
      '      <bottom style="thin"><color rgb="FF000000"/></bottom>',
      '      <diagonal/>',
      '    </border>',
      '  </borders>',
      '  <cellStyleXfs count="1">',
      '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
      '  </cellStyleXfs>',
      '  <cellXfs count="9">',
      '    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
      '    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
      '  </cellXfs>',
      '</styleSheet>'
    ].join('\n');

    const sharedStringsXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`,
      ...sharedStrings.map((s) => `  <si><t>${escapeXml(s)}</t></si>`),
      '</sst>'
    ].join('\n');

    const hyperlinksSection = hyperlinksXml.length > 0
      ? `  <hyperlinks>\n    ${hyperlinksXml.join('\n    ')}\n  </hyperlinks>\n`
      : '';

    const sheet1Xml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      `  <dimension ref="${dimensionRef}"/>`,
      '  <sheetViews><sheetView workbookViewId="0"/></sheetViews>',
      '  <sheetFormatPr defaultRowHeight="19"/>',
      '  <cols>',
      '    <col min="1" max="1" width="22" customWidth="1"/>',
      '    <col min="2" max="2" width="16" customWidth="1"/>',
      '    <col min="3" max="3" width="14" customWidth="1"/>',
      '    <col min="4" max="4" width="14" customWidth="1"/>',
      '    <col min="5" max="5" width="16" customWidth="1"/>',
      '    <col min="6" max="6" width="16" customWidth="1"/>',
      '    <col min="7" max="7" width="18" customWidth="1"/>',
      '    <col min="8" max="8" width="22" customWidth="1"/>',
      '    <col min="9" max="9" width="16" customWidth="1"/>',
      '  </cols>',
      '  <sheetData>',
      '    ' + sheetRowsXml.join('\n    '),
      '  </sheetData>',
      hyperlinksSection.trimEnd(),
      '</worksheet>'
    ].filter(Boolean).join('\n');

    const zipEntries = [
      { name: '[Content_Types].xml', data: stringToUtf8Bytes(contentTypesXml) },
      { name: '_rels/.rels', data: stringToUtf8Bytes(rootRelsXml) },
      { name: 'xl/workbook.xml', data: stringToUtf8Bytes(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: stringToUtf8Bytes(workbookRelsXml) },
      { name: 'xl/styles.xml', data: stringToUtf8Bytes(stylesXml) },
      { name: 'xl/sharedStrings.xml', data: stringToUtf8Bytes(sharedStringsXml) },
      { name: 'xl/worksheets/sheet1.xml', data: stringToUtf8Bytes(sheet1Xml) }
    ];

    if (sheetRelsXml.length > 0) {
      const sheet1RelsContent = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '  ' + sheetRelsXml.join('\n  '),
        '</Relationships>'
      ].join('\n');
      zipEntries.push({
        name: 'xl/worksheets/_rels/sheet1.xml.rels',
        data: stringToUtf8Bytes(sheet1RelsContent)
      });
    }

    return createZipArchive(zipEntries);
  }

  /**
   * Extracts the Instagram profile username from a URL pathname if it is a profile page.
   * Returns null for non-profile routes (like /p/, /reel/, /reels/, /explore/, /direct/, /stories/, etc.).
   * @param {string} pathname
   * @returns {string|null}
   */
  function extractProfileUsernameFromPath(pathname) {
    if (!pathname || typeof pathname !== 'string') return null;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const reserved = new Set([
      'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'direct',
      'accounts', 'challenges', 'directory', 'about', 'legal',
      'developer', 'privacy', 'terms', 'session', 'api', 'graphql',
      'archive', 'saved', 'settings', 'your_activity', 'nametag'
    ]);

    const first = segments[0].toLowerCase();
    if (reserved.has(first)) return null;

    // Allow /<username>/ or /<username>/tagged/ or /<username>/reels/
    if (segments.length > 2) return null;
    if (segments.length === 2 && !['reels', 'tagged', 'feed', 'channel'].includes(segments[1].toLowerCase())) {
      return null;
    }

    // Valid Instagram username pattern: letters, digits, periods, underscores (1..30 chars)
    const candidate = segments[0];
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(candidate)) return null;

    return candidate;
  }

  // ============================================================================
  // Shared Google Sheet Connection & Strict Profile Deduplication
  // ============================================================================

  /**
   * Extracts a clean username string (preserving original casing) from any username representation:
   * "@MMD.Fate", "https://www.instagram.com/mmd.fate/", "instagram.com/@mmd.fate",
   * '=HYPERLINK("https://www.instagram.com/mmd.fate/", "mmd.fate")', or '=HYPERLINK("https://www.instagram.com/mmd.fate/")'.
   * @param {string|null|undefined} raw
   * @returns {string}
   */
  function extractCleanUsername(raw) {
    if (raw === null || raw === undefined) return '';
    let str = String(raw).trim();
    if (!str) return '';

    // Unwrap Google Sheets =HYPERLINK("url", "label") or =HYPERLINK("url"; "label") or =HYPERLINK("url")
    const hyperlinkLabelMatch = str.match(/^=\s*HYPERLINK\s*\(\s*"[^"]*"\s*[,;]\s*"([^"]+)"\s*\)$/i);
    if (hyperlinkLabelMatch && hyperlinkLabelMatch[1]) {
      str = hyperlinkLabelMatch[1].trim();
    } else {
      const hyperlinkUrlMatch = str.match(/^=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
      if (hyperlinkUrlMatch && hyperlinkUrlMatch[1]) {
        str = hyperlinkUrlMatch[1].trim();
      }
    }

    str = str
      .replace(/^@+/, '')
      .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, '')
      .replace(/^@+/, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@+/, '')
      .trim();

    return str;
  }

  /**
   * Normalizes any username representation (e.g. "@MMD.Fate", "https://www.instagram.com/mmd.fate/",
   * '=HYPERLINK("https://www.instagram.com/mmd.fate/", "mmd.fate")') into a canonical lowercase key.
   * @param {string|null|undefined} raw
   * @returns {string}
   */
  function normalizeUsernameKey(raw) {
    return extractCleanUsername(raw).toLowerCase();
  }

  /**
   * Strictly deduplicates an array of profile objects by normalized username key.
   * Preserves order of first appearance, updates metrics with the latest entry,
   * and preserves any non-empty `pricePerReel` if the newer entry has an empty `pricePerReel`.
   * @param {Array<object>} profiles
   * @returns {Array<object>}
   */
  function deduplicateProfiles(profiles) {
    if (!Array.isArray(profiles)) return [];
    const indexByKey = new Map();
    const result = [];

    for (const item of profiles) {
      if (!item || typeof item !== 'object') continue;
      const key = normalizeUsernameKey(item.username || item.profileUrl);
      if (!key) continue;

      const cleanUsername = extractCleanUsername(item.username || item.profileUrl) || key;

      const incomingPrice = item.pricePerReel !== undefined && item.pricePerReel !== null
        ? String(item.pricePerReel).trim()
        : '';

      const avgViewsFormatted = (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
        ? item.avgViewsFormatted
        : formatCompactCount(item.avgViews);

      if (indexByKey.has(key)) {
        const existingIdx = indexByKey.get(key);
        const prev = result[existingIdx];
        const prevPrice = prev.pricePerReel !== undefined && prev.pricePerReel !== null
          ? String(prev.pricePerReel).trim()
          : '';
        const canonicalName = prev.username || cleanUsername.toLowerCase();
        result[existingIdx] = {
          ...prev,
          ...item,
          username: canonicalName,
          profileUrl: prev.profileUrl || item.profileUrl || `https://www.instagram.com/${canonicalName}/`,
          avgViewsFormatted,
          pricePerReel: incomingPrice || prevPrice
        };
      } else {
        indexByKey.set(key, result.length);
        result.push({
          ...item,
          username: cleanUsername,
          profileUrl: item.profileUrl || `https://www.instagram.com/${cleanUsername}/`,
          avgViewsFormatted,
          pricePerReel: incomingPrice
        });
      }
    }

    return result;
  }

  /**
   * Parses a Shared Google Sheet URL or raw spreadsheet ID to extract `spreadsheetId` and `gid`.
   * @param {string} urlOrId
   * @returns {{ spreadsheetId: string, gid: number, isValid: boolean }}
   */
  function parseGoogleSheetUrl(urlOrId) {
    const str = String(urlOrId || '').trim();
    if (!str) {
      return { spreadsheetId: '', gid: 0, isValid: false };
    }

    const urlMatch = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = str.match(/[?#&]gid=(\d+)/);
    const gid = gidMatch ? Number(gidMatch[1]) || 0 : 0;

    if (urlMatch && urlMatch[1]) {
      return {
        spreadsheetId: urlMatch[1],
        gid,
        isValid: true
      };
    }

    if (/^[a-zA-Z0-9-_]{15,120}$/.test(str)) {
      return {
        spreadsheetId: str,
        gid: 0,
        isValid: true
      };
    }

    return { spreadsheetId: '', gid: 0, isValid: false };
  }

  /**
   * Formats a profile record into the 9-column Google Sheet row array:
   * [ '=HYPERLINK("...", "...")', followers, erFormatted, vrFormatted, avgViewsFormatted, avgLikes, avgComments, likesPerComment, pricePerReel ]
   * @param {object} profile
   * @param {string} [fallbackPricePerReel='']
   * @returns {Array<string|number>}
   */
  function formatProfileForSheetRow(profile, fallbackPricePerReel = '') {
    const item = profile && typeof profile === 'object' ? profile : {};
    const cleanUsername = extractCleanUsername(item.username || item.profileUrl);
    const profileUrl = item.profileUrl || (cleanUsername ? `https://www.instagram.com/${cleanUsername}/` : 'https://www.instagram.com/');
    const hyperlinkFormula = `=HYPERLINK("${profileUrl}", "${cleanUsername}")`;

    const followers = Math.round(Number(item.followers) || 0);
    const erFormatted = typeof item.erFormatted === 'string' && item.erFormatted
      ? item.erFormatted
      : Number(item.er || 0).toFixed(2) + '%';
    const vrFormatted = typeof item.vrFormatted === 'string' && item.vrFormatted
      ? item.vrFormatted
      : Number(item.vr || 0).toFixed(2) + '%';
    const avgViewsFormatted = typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted
      ? item.avgViewsFormatted
      : formatCompactCount(item.avgViews);
    const avgLikes = Math.round(Number(item.avgLikes) || 0);
    const avgComments = Math.round(Number(item.avgComments) || 0);
    const likesPerComment = Math.round((Number(item.likesPerComment) || 0) * 10) / 10;

    const ownPrice = item.pricePerReel !== undefined && item.pricePerReel !== null
      ? String(item.pricePerReel).trim()
      : '';
    const existingPrice = fallbackPricePerReel !== undefined && fallbackPricePerReel !== null
      ? String(fallbackPricePerReel).trim()
      : '';
    const pricePerReel = ownPrice || existingPrice || '';

    const row = [
      hyperlinkFormula,
      followers,
      erFormatted,
      vrFormatted,
      avgViewsFormatted,
      avgLikes,
      avgComments,
      likesPerComment,
      pricePerReel
    ];

    Object.defineProperties(row, {
      values: { value: row, enumerable: false },
      row: { value: row, enumerable: false },
      username: { value: cleanUsername, enumerable: false }
    });

    return row;
  }

  /**
   * Plans a Google Sheet sync (upsert without duplicates) given existing sheet rows and scraped profiles.
   * - Deduplicates `profiles` first.
   * - Maps existing Google Sheet usernames (ignoring header row 1) by `normalizeUsernameKey(row[0])`.
   * - Updates existing profiles in place at their exact 1-based `rowIndex` (preserving existing `Price/REEL` in Col I if empty).
   * - Appends only genuinely new profiles that are not yet in the sheet.
   *
   * @param {Array<Array<any>>} existingSheetRows
   * @param {Array<object>} profiles
   * @returns {{
   *   headers: Array<string>,
   *   needsHeader: boolean,
   *   updates: Array<{ rowIndex: number, range: string, username: string, values: Array<any>, row: Array<any> }>,
   *   appends: Array<Array<any>>,
   *   duplicateSheetRowIndices: Array<number>,
   *   totalProfiles: number
   * }}
   */
  function planGoogleSheetSync(existingSheetRows, profiles) {
    const rows = Array.isArray(existingSheetRows) ? existingSheetRows : [];
    const dedupedProfiles = deduplicateProfiles(profiles);

    const existingMap = new Map();
    const duplicateSheetRowIndices = [];

    const firstRowKey = rows.length > 0 && Array.isArray(rows[0]) ? normalizeUsernameKey(rows[0][0]) : '';
    const hasHeaderRow = firstRowKey === 'username';
    const startIdx = hasHeaderRow ? 1 : (rows.length > 0 && !firstRowKey ? 1 : 0);

    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r) || r.length === 0) continue;
      const key = normalizeUsernameKey(r[0]);
      if (!key || key === 'username') continue;

      const rowIndex = i + 1; // 1-based sheet row number
      const cellPrice = r[8] !== undefined && r[8] !== null ? String(r[8]).trim() : '';

      if (!existingMap.has(key)) {
        existingMap.set(key, {
          rowIndex,
          existingPricePerReel: cellPrice
        });
      } else {
        duplicateSheetRowIndices.push(rowIndex);
        const prevEntry = existingMap.get(key);
        if (!prevEntry.existingPricePerReel && cellPrice) {
          prevEntry.existingPricePerReel = cellPrice;
        }
      }
    }

    const updates = [];
    const appends = [];

    for (const profile of dedupedProfiles) {
      const key = normalizeUsernameKey(profile.username);
      if (!key) continue;

      if (existingMap.has(key)) {
        const existing = existingMap.get(key);
        const rowValues = formatProfileForSheetRow(profile, existing.existingPricePerReel);
        updates.push({
          rowIndex: existing.rowIndex,
          range: `A${existing.rowIndex}:I${existing.rowIndex}`,
          username: profile.username,
          values: rowValues,
          row: rowValues
        });
      } else {
        const rowValues = formatProfileForSheetRow(profile, '');
        appends.push(rowValues);
      }
    }

    return {
      headers: SHEET_COLUMNS.slice(),
      needsHeader: !hasHeaderRow,
      updates,
      appends,
      duplicateSheetRowIndices,
      totalProfiles: dedupedProfiles.length
    };
  }

  /**
   * Generates a ready-to-paste Google Apps Script (doPost + doGet) for zero-OAuth shared Google Sheet syncing.
   * Automatically formats the 9 headers, removes duplicate rows in the sheet, updates existing profiles
   * in place (preserving Price/REEL), and appends new profiles.
   * @param {string} [defaultSheetUrl='']
   * @returns {string}
   */
  function generateGoogleAppsScriptCode(defaultSheetUrl = '') {
    const escapedUrl = String(defaultSheetUrl || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return [
      '/**',
      ' * Crow Scrapper (by @mhrshadfm) — Shared Google Sheet Sync Web App Script',
      ' * 1. In your Google Sheet, click Extensions > Apps Script',
      ' * 2. Paste this code and click Deploy > New deployment > Web app',
      ' * 3. Set "Execute as: Me" and "Who has access: Anyone", then copy the Web App URL into the extension.',
      ' */',
      `const DEFAULT_SHEET_URL = '${escapedUrl}';`,
      "const HEADERS = ['USERNAME', 'Follower', 'ER', 'V.R.', 'AV VIEW', 'AV LIKE', 'AV COMMENTS', 'LIKES PER COMMENT', 'Price/REEL'];",
      '',
      'function normalizeKey(val) {',
      "  if (!val) return '';",
      '  var s = String(val).trim();',
      '  var m = s.match(/^=\\s*HYPERLINK\\s*\\(\\s*"[^"]*"\\s*[,;]\\s*"([^"]+)"\\s*\\)$/i);',
      '  if (m && m[1]) {',
      '    s = m[1].trim();',
      '  } else {',
      '    var mu = s.match(/^=\\s*HYPERLINK\\s*\\(\\s*"([^"]+)"/i);',
      '    if (mu && mu[1]) s = mu[1].trim();',
      '  }',
      "  return s.replace(/^@+/, '').replace(/^(?:https?:\\/\\/)?(?:www\\.)?instagram\\.com\\//i, '').replace(/^@+/, '').replace(/[/?#].*$/, '').replace(/^@+/, '').trim().toLowerCase();",
      '}',
      '',
      'function formatCompact(val) {',
      '  if (typeof val === "string" && /[KMB]$/i.test(val.trim())) return val.trim().toUpperCase();',
      '  var n = Math.round(Number(val) || 0);',
      '  if (n <= 0) return "0";',
      '  if (n >= 1e9) {',
      '    var b = Math.round((n / 1e9) * 10) / 10;',
      '    return (b % 1 === 0 ? String(b) : b.toFixed(1)) + "B";',
      '  }',
      '  if (n >= 1e6) {',
      '    var m = Math.round((n / 1e6) * 10) / 10;',
      '    if (m >= 1000) return "1B";',
      '    return (m % 1 === 0 ? String(m) : m.toFixed(1)) + "M";',
      '  }',
      '  if (n >= 1e3) {',
      '    var k = (n >= 1e5 && n % 100 !== 0) ? Math.round(n / 1e3) : Math.round((n / 1e3) * 10) / 10;',
      '    if (k >= 1000) return "1M";',
      '    return (k % 1 === 0 ? String(k) : k.toFixed(1)) + "K";',
      '  }',
      '  return String(n);',
      '}',
      '',
      'function ensureStyledHeaders(sheet) {',
      '  var headerRange = sheet.getRange(1, 1, 1, 9);',
      '  headerRange.setValues([HEADERS]);',
      "  headerRange.setFontWeight('bold').setHorizontalAlignment('center');",
      "  sheet.getRange(1, 1).setBackground('#78C8F0');",
      "  sheet.getRange(1, 2).setBackground('#92D050');",
      "  sheet.getRange(1, 3, 1, 2).setBackground('#D878D8');",
      "  sheet.getRange(1, 5, 1, 5).setBackground('#F4B084');",
      '}',
      '',
      'function doPost(e) {',
      '  var lock = LockService.getScriptLock();',
      '  lock.waitLock(25000);',
      '  try {',
      "    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');",
      '    var sheetUrl = payload.sheetUrl || DEFAULT_SHEET_URL;',
      '    var ss = sheetUrl ? SpreadsheetApp.openByUrl(sheetUrl) : SpreadsheetApp.getActiveSpreadsheet();',
      '    var sheet = payload.sheetName ? (ss.getSheetByName(payload.sheetName) || ss.getSheets()[0]) : ss.getSheets()[0];',
      '',
      '    ensureStyledHeaders(sheet);',
      '',
      '    var lastRow = sheet.getLastRow();',
      '    var existingMap = {};',
      '    var duplicateRows = [];',
      '    if (lastRow >= 2) {',
      '      var formulas = sheet.getRange(2, 1, lastRow - 1, 1).getFormulas();',
      '      var values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();',
      '      for (var i = 0; i < values.length; i++) {',
      '        var rawUser = formulas[i][0] || values[i][0];',
      '        var key = normalizeKey(rawUser);',
      '        if (!key || key === "username") continue;',
      '        var rowNum = i + 2;',
      '        var existingPrice = values[i][8] !== undefined && values[i][8] !== null ? String(values[i][8]).trim() : "";',
      '        if (!existingMap[key]) {',
      '          existingMap[key] = { rowIndex: rowNum, pricePerReel: existingPrice };',
      '        } else {',
      '          duplicateRows.push(rowNum);',
      '          if (!existingMap[key].pricePerReel && existingPrice) existingMap[key].pricePerReel = existingPrice;',
      '        }',
      '      }',
      '    }',
      '',
      '    // Remove any pre-existing duplicate rows from bottom to top',
      '    for (var d = duplicateRows.length - 1; d >= 0; d--) {',
      '      sheet.deleteRow(duplicateRows[d]);',
      '    }',
      '',
      '    // Re-index after deleting duplicates if any were removed',
      '    if (duplicateRows.length > 0) {',
      '      existingMap = {};',
      '      lastRow = sheet.getLastRow();',
      '      if (lastRow >= 2) {',
      '        var f2 = sheet.getRange(2, 1, lastRow - 1, 1).getFormulas();',
      '        var v2 = sheet.getRange(2, 1, lastRow - 1, 9).getValues();',
      '        for (var j = 0; j < v2.length; j++) {',
      '          var k2 = normalizeKey(f2[j][0] || v2[j][0]);',
      '          if (k2 && !existingMap[k2]) {',
      '            existingMap[k2] = { rowIndex: j + 2, pricePerReel: String(v2[j][8] || "").trim() };',
      '          }',
      '        }',
      '      }',
      '    }',
      '',
      '    var profiles = Array.isArray(payload.profiles) ? payload.profiles : [];',
      '    var seenIncoming = {};',
      '    var updatedCount = 0;',
      '    var appendedCount = 0;',
      '',
      '    for (var p = 0; p < profiles.length; p++) {',
      '      var item = profiles[p] || {};',
      '      var uKey = normalizeKey(item.username);',
      '      if (!uKey || seenIncoming[uKey]) continue;',
      '      seenIncoming[uKey] = true;',
      '',
      '      var cleanUser = String(item.username || uKey).trim().replace(/^@+/, "");',
      '      var profileUrl = item.profileUrl || ("https://www.instagram.com/" + cleanUser + "/");',
      '      var prevPrice = existingMap[uKey] ? existingMap[uKey].pricePerReel : "";',
      '      var price = String(item.pricePerReel || prevPrice || "").trim();',
      '',
      '      var rowVals = [',
      '        \'=HYPERLINK("\' + profileUrl + \'", "\' + cleanUser + \'")\',',
      '        Number(item.followers) || 0,',
      '        item.erFormatted || ((Number(item.er) || 0).toFixed(2) + "%"),',
      '        item.vrFormatted || ((Number(item.vr) || 0).toFixed(2) + "%"),',
      '        item.avgViewsFormatted || formatCompact(item.avgViews),',
      '        Number(item.avgLikes) || 0,',
      '        Number(item.avgComments) || 0,',
      '        Math.round((Number(item.likesPerComment) || 0) * 10) / 10,',
      '        price',
      '      ];',
      '',
      '      if (existingMap[uKey]) {',
      '        sheet.getRange(existingMap[uKey].rowIndex, 1, 1, 9).setValues([rowVals]);',
      '        updatedCount++;',
      '      } else {',
      '        sheet.appendRow(rowVals);',
      '        existingMap[uKey] = { rowIndex: sheet.getLastRow(), pricePerReel: price };',
      '        appendedCount++;',
      '      }',
      '    }',
      '',
      '    return ContentService.createTextOutput(JSON.stringify({',
      '      ok: true,',
      '      updatedCount: updatedCount,',
      '      appendedCount: appendedCount,',
      '      duplicateRowsRemoved: duplicateRows.length',
      "    })).setMimeType(ContentService.MimeType.JSON);",
      '  } catch (err) {',
      '    return ContentService.createTextOutput(JSON.stringify({',
      '      ok: false,',
      '      error: String(err && err.message ? err.message : err)',
      "    })).setMimeType(ContentService.MimeType.JSON);",
      '  } finally {',
      '    lock.releaseLock();',
      '  }',
      '}',
      '',
      'function doGet() {',
      '  return ContentService.createTextOutput(JSON.stringify({ ok: true, status: "Crow Scrapper by @mhrshadfm — Google Sheet Connector Ready" }))',
      '    .setMimeType(ContentService.MimeType.JSON);',
      '}'
    ].join('\n');
  }

  /**
   * Synchronizes the scraped profiles list to a shared Google Sheet using either:
   * - Mode 1: Google Apps Script Web App URL (`config.webAppUrl`)
   * - Mode 2: Direct Google Sheets API v4 (`config.sheetUrl` + `config.accessToken` / `config.apiToken`)
   * Strictly deduplicates profiles so existing rows are updated in place and only new profiles are appended.
   *
   * @param {Array<object>} profiles
   * @param {{ sheetUrl?: string, webAppUrl?: string, accessToken?: string, apiToken?: string, sheetName?: string }} config
   * @param {Function} [fetchImpl]
   * @returns {Promise<{ ok: boolean, mode?: string, updatedCount?: number, appendedCount?: number, totalSynced?: number, error?: string }>}
   */
  async function syncProfilesToGoogleSheet(profiles, config, fetchImpl) {
    const fetcher = typeof fetchImpl === 'function'
      ? fetchImpl
      : typeof fetch === 'function'
        ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : this)
        : null;

    if (!fetcher) {
      return { ok: false, error: 'Fetch API is not available in this environment.' };
    }

    const cfg = config && typeof config === 'object' ? config : {};
    const deduped = deduplicateProfiles(profiles);
    if (deduped.length === 0) {
      return { ok: false, error: 'No profiles to sync.' };
    }

    const webAppUrl = String(cfg.webAppUrl || '').trim();
    const sheetUrl = String(cfg.sheetUrl || '').trim();
    const accessToken = String(cfg.accessToken || cfg.apiToken || '').trim();
    const sheetName = String(cfg.sheetName || '').trim();

    // Mode 1: Google Apps Script Web App URL
    if (webAppUrl) {
      const parsedSheet = parseGoogleSheetUrl(sheetUrl);
      const response = await fetcher(webAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          sheetUrl,
          spreadsheetId: parsedSheet.spreadsheetId,
          sheetName,
          profiles: deduped,
          removeSheetDuplicates: true
        })
      });

      if (!response || !response.ok) {
        return {
          ok: false,
          error: `Google Sheet Web App returned HTTP ${response ? response.status : 'error'}.`
        };
      }

      let resultJson = {};
      try {
        resultJson = await response.json();
      } catch (_err) {
        resultJson = { ok: true };
      }

      if (resultJson && resultJson.ok === false) {
        return { ok: false, error: resultJson.error || 'Apps Script reported an error.' };
      }

      return {
        ok: true,
        mode: 'webapp',
        updatedCount: Number(resultJson.updatedCount) || 0,
        appendedCount: Number(resultJson.appendedCount) || 0,
        duplicateRowsRemoved: Number(resultJson.duplicateRowsRemoved) || 0,
        totalSynced: deduped.length
      };
    }

    // Mode 2: Direct Google Sheets v4 REST API (Shared Google Sheet URL + OAuth Access Token)
    const parsed = parseGoogleSheetUrl(sheetUrl);
    if (!parsed.isValid || !parsed.spreadsheetId) {
      return {
        ok: false,
        error: 'Please enter a valid Shared Google Sheet URL or Apps Script Web App URL.'
      };
    }

    if (!accessToken) {
      return {
        ok: false,
        error: 'Please provide either an Apps Script Web App URL (recommended, 1-click setup) or a Google OAuth Access Token.'
      };
    }

    const spreadsheetId = parsed.spreadsheetId;
    const rangePrefix = sheetName ? `'${sheetName.replace(/'/g, "''")}'!` : '';
    const readRange = `${rangePrefix}A1:I10000`;
    const authHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };

    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(readRange)}?valueRenderOption=FORMULA`;
    const getRes = await fetcher(getUrl, {
      method: 'GET',
      headers: authHeaders
    });

    if (!getRes || !getRes.ok) {
      return {
        ok: false,
        error: `Failed to read Google Sheet (HTTP ${getRes ? getRes.status : 'error'}). Verify sheet sharing permissions and token.`
      };
    }

    const getJson = await getRes.json();
    const existingRows = Array.isArray(getJson && getJson.values) ? getJson.values : [];
    const plan = planGoogleSheetSync(existingRows, deduped);

    const firstRowKey = existingRows.length > 0 && Array.isArray(existingRows[0])
      ? normalizeUsernameKey(existingRows[0][0])
      : '';
    const canWriteHeaderAtRow1 =
      (existingRows.length === 0 || !firstRowKey || firstRowKey === 'username') &&
      !plan.updates.some((u) => u.rowIndex === 1);

    const batchData = [
      ...(canWriteHeaderAtRow1
        ? [
            {
              range: `${rangePrefix}A1:I1`,
              values: [plan.headers]
            }
          ]
        : []),
      ...plan.updates.map((u) => ({
        range: `${rangePrefix}${u.range}`,
        values: [u.values]
      }))
    ];

    if (batchData.length > 0) {
      const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
      const batchRes = await fetcher(batchUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: batchData
        })
      });

      if (!batchRes || !batchRes.ok) {
        return {
          ok: false,
          error: `Failed to update existing rows in Google Sheet (HTTP ${batchRes ? batchRes.status : 'error'}).`
        };
      }
    }

    if (plan.appends.length > 0) {
      const appendRange = `${rangePrefix}A1:I1`;
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      const appendRes = await fetcher(appendUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          values: plan.appends
        })
      });

      if (!appendRes || !appendRes.ok) {
        return {
          ok: false,
          error: `Failed to append new rows to Google Sheet (HTTP ${appendRes ? appendRes.status : 'error'}).`
        };
      }
    }

    return {
      ok: true,
      mode: 'sheets_api',
      updatedCount: plan.updates.length,
      appendedCount: plan.appends.length,
      totalSynced: plan.totalProfiles
    };
  }

  return {
    EXTENSION_NAME,
    EXTENSION_OWNER,
    EXTENSION_OWNER_URL,
    CROW_WHITE_DATA_URI,
    RECENT_POSTS_LIMIT,
    SHEET_COLUMNS,
    parseCount,
    formatCompactCount,
    roundToWrittenCount,
    getViewRateBand,
    getErBenchmark,
    isPostPinned,
    normalizePost,
    normalizeAndDetectPinnedPosts,
    selectRecentNonPinnedPosts,
    calculateProfileMetrics,
    formatNumberWithCommas,
    formatLikesPerComment,
    generateCsvContent,
    generateXlsxBytes,
    extractProfileUsernameFromPath,
    normalizeUsernameKey,
    deduplicateProfiles,
    parseGoogleSheetUrl,
    formatProfileForSheetRow,
    planGoogleSheetSync,
    generateGoogleAppsScriptCode,
    syncProfilesToGoogleSheet
  };
});
