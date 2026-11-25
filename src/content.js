/**
 * Content script for Crow Scrapper (by @mhrshadfm).
 * - Injects a "Scrape Profile" button with the white crow logo next to the username on Instagram profile pages.
 * - Scrapes follower count and the 6 most recent NON-PINNED Reels/posts (skipping pinned posts
 *   and optionally the #1 most recent post).
 * - Calculates ER (with follower benchmarks), V.R. (with View Rate bands), AV VIEW, AV LIKE,
 *   AV COMMENTS, LIKES PER COMMENT, and Price/REEL.
 * - Stores deduplicated profiles in chrome.storage.local (with localStorage fallback).
 * - Connects to Shared Google Sheets to add/update the full list without duplicating profiles.
 */
(function () {
  'use strict';

  const Core = typeof window !== 'undefined' && window.InstaScraperCore
    ? window.InstaScraperCore
    : typeof require === 'function'
      ? require('./core.js')
      : null;

  if (!Core) {
    console.error('[Crow Scrapper] Core module failed to load.');
    return;
  }

  const STORAGE_KEY = 'ig_scraped_profiles';
  const SETTINGS_KEY = 'ig_scraper_settings';
  const SHEET_CONFIG_KEY = 'ig_google_sheet_config';
  const IG_WEB_APP_ID = '936619743392459';

  // ============================================================================
  // Instance Ownership (extension update / re-injection safety)
  // ============================================================================
  // After the extension is updated or reloaded, the content script already running in an open
  // Instagram tab is orphaned (its chrome.* APIs throw "Extension context invalidated"), and the
  // popup may re-inject a fresh copy into the same page. The DOM is shared by both copies, so the
  // newest copy stamps an ownership token on <html> and takes over the button, panel & listeners.
  const INSTANCE_ATTR = 'data-crow-scrapper-instance';
  const INSTANCE_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const RELOAD_REQUIRED_MESSAGE = 'Crow Scrapper was updated or reloaded — refresh this Instagram tab (F5) to continue.';

  function claimInstanceOwnership() {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute(INSTANCE_ATTR, INSTANCE_TOKEN);
    }
  }

  function isCurrentInstance() {
    if (typeof document === 'undefined' || !document.documentElement) return true;
    const owner = document.documentElement.getAttribute(INSTANCE_ATTR);
    return !owner || owner === INSTANCE_TOKEN;
  }

  function isExtensionContextAlive() {
    try {
      if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) return true; // plain page / tests
      return Boolean(chrome.runtime.id);
    } catch (_err) {
      return false;
    }
  }

  function hasChromeStorage() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome && chrome.storage && chrome.storage.local);
    } catch (_err) {
      return false;
    }
  }

  function assertExtensionContextAlive() {
    if (!isExtensionContextAlive()) {
      throw new Error(RELOAD_REQUIRED_MESSAGE);
    }
  }

  claimInstanceOwnership();

  function getWhiteCrowLogoUrl() {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      try {
        if (chrome.runtime.id) {
          const runtimeUrl = chrome.runtime.getURL('icons/crow-white.png');
          if (runtimeUrl && !runtimeUrl.includes('chrome-extension://invalid')) {
            return runtimeUrl;
          }
        }
      } catch (_err) {
        // Fallback to embedded data URI
      }
    }
    return Core.CROW_WHITE_DATA_URI;
  }

  function renderCrowLogoImg(extraClass = '') {
    const cls = ['ig-scraper-crow-logo', extraClass].filter(Boolean).join(' ');
    const src = getWhiteCrowLogoUrl();
    return `<img src="${src}" alt="Crow Scrapper" class="${cls}" />`;
  }

  function bindCrowLogoFallback(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    const imgs = rootEl.querySelectorAll('img.ig-scraper-crow-logo');
    imgs.forEach((img) => {
      img.addEventListener('error', () => {
        if (img.src !== Core.CROW_WHITE_DATA_URI) {
          img.src = Core.CROW_WHITE_DATA_URI;
        }
      });
      if (img.complete && img.naturalWidth === 0 && img.src !== Core.CROW_WHITE_DATA_URI) {
        img.src = Core.CROW_WHITE_DATA_URI;
      }
    });
  }

  // ============================================================================
  // Storage Helpers (chrome.storage.local with localStorage fallback)
  // ============================================================================

  function chromeStorageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        assertExtensionContextAlive();
        chrome.storage.local.get(keys, (res) => {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || String(lastErr)));
            return;
          }
          resolve(res || {});
        });
      } catch (err) {
        reject(isExtensionContextAlive() ? err : new Error(RELOAD_REQUIRED_MESSAGE));
      }
    });
  }

  function chromeStorageSet(items) {
    return new Promise((resolve, reject) => {
      try {
        assertExtensionContextAlive();
        chrome.storage.local.set(items, () => {
          const lastErr = chrome.runtime && chrome.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || String(lastErr)));
            return;
          }
          resolve();
        });
      } catch (err) {
        reject(isExtensionContextAlive() ? err : new Error(RELOAD_REQUIRED_MESSAGE));
      }
    });
  }

  function readLocalStorageJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function writeLocalStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_err) {
      // ignore storage quota errors
    }
  }

  async function getStoredProfiles() {
    if (hasChromeStorage()) {
      const res = await chromeStorageGet([STORAGE_KEY]);
      return Core.deduplicateProfiles(Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : []);
    }
    const parsed = readLocalStorageJson(STORAGE_KEY, []);
    return Core.deduplicateProfiles(Array.isArray(parsed) ? parsed : []);
  }

  async function saveStoredProfiles(profiles) {
    const list = Core.deduplicateProfiles(Array.isArray(profiles) ? profiles : []);
    if (hasChromeStorage()) {
      await chromeStorageSet({ [STORAGE_KEY]: list });
    } else {
      writeLocalStorageJson(STORAGE_KEY, list);
    }
    return list;
  }

  async function getScraperSettings() {
    const defaults = { excludeMostRecent: false };
    let saved;
    if (hasChromeStorage()) {
      const res = await chromeStorageGet([SETTINGS_KEY]);
      saved = res[SETTINGS_KEY];
    } else {
      saved = readLocalStorageJson(SETTINGS_KEY, {});
    }
    return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  async function saveScraperSettings(settings) {
    const clean = {
      excludeMostRecent: Boolean(settings && settings.excludeMostRecent)
    };
    if (hasChromeStorage()) {
      await chromeStorageSet({ [SETTINGS_KEY]: clean });
    } else {
      writeLocalStorageJson(SETTINGS_KEY, clean);
    }
    return clean;
  }

  async function getGoogleSheetConfig() {
    const defaults = {
      sheetUrl: '',
      webAppUrl: '',
      accessToken: '',
      sheetName: '',
      syncToken: '',
      autoSync: false
    };
    let saved;
    if (hasChromeStorage()) {
      const res = await chromeStorageGet([SHEET_CONFIG_KEY]);
      saved = res[SHEET_CONFIG_KEY];
    } else {
      saved = readLocalStorageJson(SHEET_CONFIG_KEY, {});
    }
    return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  // Serializes read-modify-write cycles on the stored list within this page, so a scrape that
  // finishes while a price edit / row removal is being saved can't overwrite it (lost update).
  let storageWriteChain = Promise.resolve();
  function withStorageLock(task) {
    const run = storageWriteChain.then(task, task);
    storageWriteChain = run.catch(() => {});
    return run;
  }

  function upsertProfileRecord(record) {
    return withStorageLock(async () => {
      const list = await getStoredProfiles();
      return saveStoredProfiles([...list, record]);
    });
  }

  let suppressNextStorageRender = false;

  function updateProfilePrice(username, pricePerReel) {
    return withStorageLock(() => updateProfilePriceUnlocked(username, pricePerReel));
  }

  async function updateProfilePriceUnlocked(username, pricePerReel) {
    const list = await getStoredProfiles();
    const key = Core.normalizeUsernameKey(username);
    const idx = list.findIndex((item) => Core.normalizeUsernameKey(item.username) === key);
    if (idx >= 0) {
      list[idx].pricePerReel = String(pricePerReel || '').trim();
      suppressNextStorageRender = true;
      try {
        await saveStoredProfiles(list);
      } finally {
        setTimeout(() => {
          suppressNextStorageRender = false;
        }, 50);
      }
    }
    return list;
  }

  function removeProfileRecord(username) {
    return withStorageLock(async () => {
      const list = await getStoredProfiles();
      const key = Core.normalizeUsernameKey(username);
      const filtered = list.filter((item) => Core.normalizeUsernameKey(item.username) !== key);
      await saveStoredProfiles(filtered);
      return filtered;
    });
  }

  function clearAllProfiles() {
    return withStorageLock(async () => {
      await saveStoredProfiles([]);
      return [];
    });
  }

  async function syncProfilesWithGoogleSheet(profilesOverride) {
    let profiles;
    let config;
    try {
      [profiles, config] = await Promise.all([
        Array.isArray(profilesOverride) ? Promise.resolve(profilesOverride) : getStoredProfiles(),
        getGoogleSheetConfig()
      ]);
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }

    const directSync = async () => {
      try {
        return await Core.syncProfilesToGoogleSheet(profiles, config);
      } catch (err) {
        return { ok: false, error: (err && err.message) || String(err) };
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      if (!isExtensionContextAlive()) {
        return { ok: false, error: RELOAD_REQUIRED_MESSAGE };
      }
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'SYNC_GOOGLE_SHEET', profiles, config },
            async (response) => {
              const lastErr = chrome.runtime && chrome.runtime.lastError;
              if (lastErr || !response) {
                resolve(await directSync());
                return;
              }
              resolve(response);
            }
          );
        } catch (err) {
          resolve({
            ok: false,
            error: isExtensionContextAlive() ? ((err && err.message) || String(err)) : RELOAD_REQUIRED_MESSAGE
          });
        }
      });
    }

    return directSync();
  }

  // ============================================================================
  // DOM Inspection & Fallback Scraping Helpers
  // ============================================================================

  /**
   * Resolves the single-tile wrapper element for a grid post link.
   * Supports both legacy classes (_aabd, _ac7v) and modern StyleX/Comet wrappers.
   * @param {Element} postEl
   * @returns {Element}
   */
  function getPostTileContainer(postEl) {
    if (!postEl) return postEl;
    const legacy = postEl.closest && postEl.closest('div._aabd, div._ac7v > div, li');
    if (legacy) return legacy;

    let curr = postEl;
    for (let depth = 0; depth < 2; depth++) {
      const parent = curr.parentElement;
      if (!parent || parent.tagName === 'MAIN' || parent.tagName === 'ARTICLE' || parent.tagName === 'BODY') {
        break;
      }
      const links = parent.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]');
      if (links.length === 1) {
        curr = parent;
      } else {
        break;
      }
    }
    return curr;
  }

  const PINNED_LABEL_REGEX = /pinned|pin\s*icon|سنجاق|مثبت|fijad|épingl|angeheftet|sabitlen|закреп|fixad|fissat/i;

  /**
   * Checks if a DOM post anchor/tile has a "Pinned" icon, badge, or attribute.
   * @param {Element} postEl
   * @returns {boolean}
   */
  function isDomPostElementPinned(postEl) {
    if (!postEl || typeof postEl.querySelector !== 'function') return false;

    const container = getPostTileContainer(postEl);

    // 1. Check explicit data attributes or classes on the anchor or its tile container
    for (const el of [postEl, container]) {
      if (!el) continue;
      if (
        el.getAttribute('data-pinned') === 'true' ||
        el.getAttribute('data-is-pinned') === 'true' ||
        PINNED_LABEL_REGEX.test(el.className || '') ||
        PINNED_LABEL_REGEX.test(el.getAttribute('aria-label') || '') ||
        PINNED_LABEL_REGEX.test(el.getAttribute('title') || '')
      ) {
        return true;
      }
    }

    // 2. Check SVG aria-label, <title>, or pushpin SVG path inside the tile container
    const searchRoot = container || postEl;
    const pinCandidates = searchRoot.querySelectorAll(
      'svg[aria-label], [aria-label], [title], svg title, svg path, [data-testid], [data-pinned="true"], .pinned, .pinned-icon'
    );
    for (const node of pinCandidates) {
      const aria = node.getAttribute && (node.getAttribute('aria-label') || '');
      const titleAttr = node.getAttribute && (node.getAttribute('title') || '');
      const testId = node.getAttribute && (node.getAttribute('data-testid') || '');
      const dataPinned = node.getAttribute && (node.getAttribute('data-pinned') || '');
      const pathD = node.tagName && node.tagName.toLowerCase() === 'path' ? (node.getAttribute('d') || '') : '';
      const tagTitle = node.tagName && node.tagName.toLowerCase() === 'title' ? (node.textContent || '') : '';
      const cls = typeof node.className === 'string' ? node.className : '';

      if (
        PINNED_LABEL_REGEX.test(aria) ||
        PINNED_LABEL_REGEX.test(titleAttr) ||
        PINNED_LABEL_REGEX.test(testId) ||
        PINNED_LABEL_REGEX.test(tagTitle) ||
        PINNED_LABEL_REGEX.test(cls) ||
        dataPinned === 'true' ||
        /^m22\.707\s+7\.583/i.test(pathD.trim())
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detects whether a DOM post anchor/tile represents a Reel vs an explicit photo.
   * @param {Element} postEl
   * @param {number} [views=0]
   * @param {boolean} [hasViews=false]
   * @returns {{ isReel: boolean, isExplicitNonReel: boolean }}
   */
  function detectDomPostReelStatus(postEl, views = 0, hasViews = false) {
    if (!postEl) return { isReel: false, isExplicitNonReel: false };
    const container = getPostTileContainer(postEl);
    const searchRoot = container || postEl;

    const href = postEl.getAttribute('href') || '';
    const postType = (
      postEl.getAttribute('data-post-type') ||
      (container && container.getAttribute('data-post-type')) ||
      ''
    ).toLowerCase();
    const dataIsReel = (
      postEl.getAttribute('data-is-reel') ||
      (container && container.getAttribute('data-is-reel')) ||
      ''
    ).toLowerCase();

    if (
      postType === 'photo' ||
      postType === 'image' ||
      postType === 'carousel' ||
      dataIsReel === 'false'
    ) {
      return { isReel: false, isExplicitNonReel: true };
    }

    if (
      /\/(?:reel|reels)\//i.test(href) ||
      postType === 'reel' ||
      postType === 'clips' ||
      dataIsReel === 'true' ||
      views > 0 ||
      hasViews
    ) {
      return { isReel: true, isExplicitNonReel: false };
    }

    if (searchRoot && typeof searchRoot.querySelectorAll === 'function') {
      const iconCandidates = searchRoot.querySelectorAll('svg[aria-label], [aria-label], svg title');
      for (const node of iconCandidates) {
        const aria = node.getAttribute ? (node.getAttribute('aria-label') || '') : '';
        const text = node.tagName && node.tagName.toLowerCase() === 'title' ? (node.textContent || '') : '';
        if (/\b(?:reel|reels|clip|clips)\b/i.test(aria) || /\b(?:reel|reels|clip|clips)\b/i.test(text)) {
          return { isReel: true, isExplicitNonReel: false };
        }
      }
    }

    return { isReel: false, isExplicitNonReel: false };
  }

  /**
   * Strips invisible Unicode BiDi/zero-width characters and normalizes localized digits.
   * @param {string} raw
   * @returns {string}
   */
  function cleanCountToken(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u066B٫]/g, '.')
      .replace(/[\u066C٬]/g, ',')
      .trim();
  }

  const STANDALONE_COUNT_REGEX =
    /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(?:[KMBkmb]|هزار|میلیون|ملیون|ملین|میلیارد|ملیارد|mio|mln)?$/i;

  /**
   * Returns cleaned text of an element excluding <svg>, <title>, <script>, and <style> children.
   * @param {Element} el
   * @returns {string}
   */
  function getNonSvgCleanText(el) {
    if (!el) return '';
    if (!el.children || el.children.length === 0) {
      return cleanCountToken(el.textContent || '');
    }
    const parts = [];
    for (const node of Array.from(el.childNodes || [])) {
      if (node.nodeType === 3) {
        const t = cleanCountToken(node.nodeValue || '');
        if (t) parts.push(t);
      } else if (node.nodeType === 1) {
        const tag = (node.tagName || '').toLowerCase();
        if (tag === 'svg' || tag === 'title' || tag === 'script' || tag === 'style') {
          continue;
        }
        const childText = getNonSvgCleanText(node);
        if (childText) parts.push(childText);
      }
    }
    return cleanCountToken(parts.join(' '));
  }

  /**
   * Extracts standalone numeric token strings from descendant spans/divs without duplicating wrapper elements.
   * @param {Element} rootEl
   * @param {(el: Element) => boolean} [filterFn]
   * @returns {Array<{ el: Element, text: string }>}
   */
  function extractStandaloneNumericNodes(rootEl, filterFn) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];
    const candidates = Array.from(rootEl.querySelectorAll('span, div')).filter((el) => {
      if (el.closest && el.closest('svg')) return false;
      if (typeof filterFn === 'function' && !filterFn(el)) return false;
      return true;
    });

    const matched = [];
    for (const el of candidates) {
      const text = getNonSvgCleanText(el);
      if (text && STANDALONE_COUNT_REGEX.test(text)) {
        matched.push({ el, text });
      }
    }

    // Filter out parent wrapper elements when a descendant has the same or more specific numeric token,
    // and filter out child fragments when the parent combines a number + K/M/B suffix (e.g. <span><span>1.5</span><span>M</span></span>).
    return matched.filter((item, idx) => {
      const itemVal = Core.roundToWrittenCount(item.text);
      for (let j = 0; j < matched.length; j++) {
        if (idx === j) continue;
        const other = matched[j];
        if (item.el.contains(other.el)) {
          // `item` is an ancestor of `other`. If `other` has the same parsed value (or `item` has >= 2 matched descendants), skip ancestor `item`.
          const otherVal = Core.roundToWrittenCount(other.text);
          if (otherVal === itemVal || otherVal > itemVal) {
            return false;
          }
        } else if (other.el.contains(item.el)) {
          // `other` is an ancestor of `item`. If `other` has a larger value (because `other` includes the K/M/B suffix), skip child `item`.
          const otherVal = Core.roundToWrittenCount(other.text);
          if (otherVal > itemVal) {
            return false;
          }
        }
      }
      return true;
    });
  }

  /**
   * Extracts a count string from a labeled node, its data attributes, aria-label (if numeric),
   * text content, or adjacent sibling/parent element (e.g. when the node is an <svg> icon next to a <span>).
   * @param {Element} node
   * @returns {{ raw: string, badgeEl: Element } | null}
   */
  function extractCountFromNodeOrSiblings(node) {
    if (!node) return null;
    const dataVal =
      node.getAttribute('data-view-count') ??
      node.getAttribute('data-views') ??
      node.getAttribute('data-play-count') ??
      node.getAttribute('data-plays') ??
      node.getAttribute('data-like-count') ??
      node.getAttribute('data-likes') ??
      node.getAttribute('data-comment-count') ??
      node.getAttribute('data-comments');
    if (dataVal !== null && dataVal !== undefined && /\d/.test(String(dataVal))) {
      return { raw: String(dataVal), badgeEl: node };
    }

    const ariaVal = cleanCountToken(node.getAttribute('aria-label') || '');
    if (ariaVal && /\d/.test(ariaVal)) {
      return { raw: ariaVal, badgeEl: node };
    }

    const ownText = getNonSvgCleanText(node);
    if (ownText && STANDALONE_COUNT_REGEX.test(ownText)) {
      return { raw: ownText, badgeEl: node };
    }

    for (const sib of [node.nextElementSibling, node.previousElementSibling]) {
      if (!sib) continue;
      const sibText = getNonSvgCleanText(sib);
      if (sibText && STANDALONE_COUNT_REGEX.test(sibText)) {
        return { raw: sibText, badgeEl: node.parentElement || sib };
      }
    }

    if (node.parentElement) {
      const parentText = getNonSvgCleanText(node.parentElement);
      if (parentText && STANDALONE_COUNT_REGEX.test(parentText)) {
        return { raw: parentText, badgeEl: node.parentElement };
      }
    }

    return null;
  }

  /**
   * Extracts views, likes, and comments from a single DOM post tile element if available.
   * Rounds view counts to their written K/M representation via Core.roundToWrittenCount.
   * @param {Element} postEl
   * @returns {{ views: number, likes: number, comments: number, hasCounts: boolean, hasViews: boolean }}
   */
  function extractCountsFromDomPostTile(postEl) {
    if (!postEl) return { views: 0, likes: 0, comments: 0, hasCounts: false, hasViews: false };
    const container = getPostTileContainer(postEl);
    const searchScope = container || postEl;

    let views = 0;
    let hasViews = false;
    let viewBadgeEl = null;

    // A. Extract explicit view/play count from data attributes or dedicated view/play nodes & SVG badges
    for (const el of [postEl, container]) {
      if (!el) continue;
      const attrViews =
        el.getAttribute('data-views') ??
        el.getAttribute('data-plays') ??
        el.getAttribute('data-view-count') ??
        el.getAttribute('data-play-count') ??
        el.dataset?.views ??
        el.dataset?.plays ??
        el.dataset?.viewCount ??
        el.dataset?.playCount;
      if (attrViews !== undefined && attrViews !== null) {
        views = Core.roundToWrittenCount(attrViews);
        hasViews = true;
        break;
      }
    }

    if (!hasViews && searchScope && typeof searchScope.querySelectorAll === 'function') {
      const viewCandidates = searchScope.querySelectorAll(
        '[data-view-count], [data-views], [data-play-count], [data-plays], .view-count, .views-count, .play-count, .plays-count, [aria-label*="view" i], [aria-label*="play" i], [aria-label*="clip" i], [aria-label*="reel" i], svg'
      );
      for (const cand of viewCandidates) {
        const tag = (cand.tagName || '').toLowerCase();
        if (tag === 'svg') {
          if (cand.closest && cand.closest('ul')) continue;
          const svgAria = (cand.getAttribute('aria-label') || '').toLowerCase();
          const titleEl = cand.querySelector ? cand.querySelector('title') : null;
          const svgTitle = titleEl ? (titleEl.textContent || '').toLowerCase() : '';
          const parentClass = (cand.parentElement && cand.parentElement.className && typeof cand.parentElement.className === 'string')
            ? cand.parentElement.className.toLowerCase()
            : '';
          const labelCombined = `${svgAria} ${svgTitle} ${parentClass}`;
          if (/like|heart|comment|pin|carousel|sidecar|photo|image/i.test(labelCombined)) {
            continue;
          }
          const isExplicitPlayOrViewSvg = /view|play|clip|reel/i.test(labelCombined);
          if (!isExplicitPlayOrViewSvg) {
            // For an unlabeled <svg>, only treat it as a view badge icon if its parent group does not contain a 2-icon [Likes, Comments] pair
            const groupEl = (cand.parentElement && cand.parentElement.parentElement) || cand.parentElement;
            const groupSvgs = groupEl && typeof groupEl.querySelectorAll === 'function'
              ? groupEl.querySelectorAll('svg').length
              : 1;
            if (groupSvgs !== 1) continue;
          }
        }
        const extracted = extractCountFromNodeOrSiblings(cand);
        if (extracted) {
          const parsedV = Core.roundToWrittenCount(extracted.raw);
          if (parsedV > 0 || /\d/.test(extracted.raw)) {
            views = parsedV;
            hasViews = true;
            viewBadgeEl = extracted.badgeEl;
            break;
          }
        }
      }
    }

    const ariaTexts = Array.from(searchScope.querySelectorAll('[aria-label]'))
      .map((el) => el.getAttribute('aria-label') || '');
    const combinedText = cleanCountToken(
      [
        postEl.getAttribute('aria-label') || '',
        container && container !== postEl ? (container.getAttribute('aria-label') || '') : '',
        ...ariaTexts,
        searchScope.textContent || ''
      ].join(' ')
    );

    if (!hasViews) {
      const viewMatch = combinedText.match(/([\d,.]+\s*(?:[KMBkmb]|هزار|میلیون|ملیون|میلیارد)?)\s*(?:views?|plays?|بازدید)/i);
      if (viewMatch) {
        views = Core.roundToWrittenCount(viewMatch[1]);
        hasViews = true;
      }
    }

    // 1. Explicit data attributes for likes & comments (e.g., data-likes="1200" data-comments="45")
    for (const el of [postEl, container]) {
      if (!el) continue;
      const attrLikes = el.getAttribute('data-likes') ?? el.dataset?.likes;
      const attrComments = el.getAttribute('data-comments') ?? el.dataset?.comments;
      if (attrLikes !== undefined || attrComments !== undefined) {
        return {
          views,
          likes: Core.parseCount(attrLikes),
          comments: Core.parseCount(attrComments),
          hasCounts: true,
          hasViews
        };
      }
    }

    // 2. Look for distinct child elements with explicit classes/attributes for likes & comments
    const likeNode = searchScope.querySelector('[data-like-count], [data-likes], .like-count, .likes-count, [aria-label*="like" i]');
    const commentNode = searchScope.querySelector('[data-comment-count], [data-comments], .comment-count, .comments-count, [aria-label*="comment" i]');
    if (likeNode && commentNode && likeNode !== commentNode) {
      const lExtracted = extractCountFromNodeOrSiblings(likeNode);
      const cExtracted = extractCountFromNodeOrSiblings(commentNode);
      if (lExtracted || cExtracted) {
        return {
          views,
          likes: lExtracted ? Core.parseCount(lExtracted.raw) : 0,
          comments: cExtracted ? Core.parseCount(cExtracted.raw) : 0,
          hasCounts: true,
          hasViews
        };
      }
    }

    // 3. Instagram hover overlay list (`ul li` with two items: [likes, comments], or 3 items with views)
    const listItems = searchScope.querySelectorAll('ul li');
    if (listItems.length >= 2) {
      if (!hasViews && listItems.length >= 3) {
        views = Core.roundToWrittenCount(listItems[2].textContent);
        hasViews = views > 0;
      }
      if (!hasViews) {
        // Check for a numeric span/div outside `ul` (such as a Reel view count badge on the tile)
        const outsideNodes = extractStandaloneNumericNodes(searchScope, (el) => !el.closest('ul'));
        if (outsideNodes.length > 0) {
          views = Core.roundToWrittenCount(outsideNodes[0].text);
          hasViews = views > 0;
        }
      }
      return {
        views,
        likes: Core.parseCount(listItems[0].textContent),
        comments: Core.parseCount(listItems[1].textContent),
        hasCounts: true,
        hasViews
      };
    }

    // 4. Text or aria-label pattern like "78,007 likes, 878 comments"
    const likeMatch = combinedText.match(/([\d,.]+\s*[KMBkmb]?)\s*likes?/i);
    const commentMatch = combinedText.match(/([\d,.]+\s*[KMBkmb]?)\s*comments?/i);
    if (likeMatch || commentMatch) {
      return {
        views,
        likes: likeMatch ? Core.parseCount(likeMatch[1]) : 0,
        comments: commentMatch ? Core.parseCount(commentMatch[1]) : 0,
        hasCounts: true,
        hasViews
      };
    }

    // 5. Generic numeric spans/divs inside the tile (handles both [Views, Likes, Comments] and [Likes, Comments, Views])
    const numericNodes = extractStandaloneNumericNodes(searchScope);
    if (hasViews && viewBadgeEl) {
      const nonViewNodes = numericNodes.filter(
        (n) => !viewBadgeEl.contains(n.el) && !n.el.contains(viewBadgeEl)
      );
      if (nonViewNodes.length >= 2) {
        return {
          views,
          likes: Core.parseCount(nonViewNodes[0].text),
          comments: Core.parseCount(nonViewNodes[1].text),
          hasCounts: true,
          hasViews
        };
      }
    }

    const numericSpans = numericNodes.map((n) => n.text);
    if (numericSpans.length >= 2) {
      if (numericSpans.length >= 3) {
        const v0 = Core.roundToWrittenCount(numericSpans[0]);
        const v1 = Core.roundToWrittenCount(numericSpans[1]);
        const v2 = Core.roundToWrittenCount(numericSpans[2]);
        const raw0 = Core.parseCount(numericSpans[0]);
        const raw1 = Core.parseCount(numericSpans[1]);
        const raw2 = Core.parseCount(numericSpans[2]);

        if (hasViews) {
          if (v0 === views && (v0 > raw1 || v2 !== views)) {
            return {
              views,
              likes: raw1,
              comments: raw2,
              hasCounts: true,
              hasViews
            };
          }
          return {
            views,
            likes: raw0,
            comments: raw1,
            hasCounts: true,
            hasViews
          };
        }

        // When 3 numbers exist (Views badge + [Likes, Comments] overlay):
        // If the first number is the largest (persistent thumbnail View badge precedes hover overlay in DOM),
        // then numericSpans[0] is Views and [numericSpans[1], numericSpans[2]] are [Likes, Comments].
        if (v0 >= v1 && v0 > v2) {
          views = v0;
          hasViews = views > 0;
          return {
            views,
            likes: raw1,
            comments: raw2,
            hasCounts: true,
            hasViews
          };
        }

        views = v2;
        hasViews = views > 0;
        return {
          views,
          likes: raw0,
          comments: raw1,
          hasCounts: true,
          hasViews
        };
      }

      return {
        views,
        likes: Core.parseCount(numericSpans[0]),
        comments: Core.parseCount(numericSpans[1]),
        hasCounts: true,
        hasViews
      };
    }

    // 6. Single numeric badge on an unhovered thumbnail is the Reel view badge
    // (Note: Instagram frequently uses `/p/<shortcode>/` or `/<user>/p/<shortcode>/` hrefs even for Reels!)
    if (!hasViews && numericSpans.length === 1) {
      const postType = (
        postEl.getAttribute('data-post-type') ||
        (container && container.getAttribute('data-post-type')) ||
        ''
      ).toLowerCase();
      const dataIsReel = (
        postEl.getAttribute('data-is-reel') ||
        (container && container.getAttribute('data-is-reel')) ||
        ''
      ).toLowerCase();
      const isExplicitNonReel =
        postType === 'photo' ||
        postType === 'image' ||
        postType === 'carousel' ||
        dataIsReel === 'false';
      if (!isExplicitNonReel) {
        views = Core.roundToWrittenCount(numericSpans[0]);
        hasViews = views > 0;
      }
    }

    return { views, likes: 0, comments: 0, hasCounts: false, hasViews };
  }

  /**
   * Finds the profile `<header>` element (excluding any `<header>` inside feed `<article>` elements).
   * @param {Document|Element} [rootDoc=document]
   * @returns {Element|null}
   */
  function findProfileHeaderElement(rootDoc = document) {
    const headers = Array.from(rootDoc.querySelectorAll('header'));
    return headers.find((h) => !h.closest('article')) || headers[0] || null;
  }

  /**
   * Scans the current document for profile grid post links, identifying pinned posts, reel status, and counts.
   * @param {Document|Element} [rootDoc=document]
   * @returns {{ domPosts: Array<object>, domPinnedShortcodes: Set<string>, postElements: Array<object> }}
   */
  function scanDomGridPosts(rootDoc = document) {
    const searchRoot = rootDoc.querySelector('main') || rootDoc;
    const anchors = Array.from(
      searchRoot.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]')
    ).filter((a) => {
      if (a.closest('header') || a.closest('#ig-scraper-panel')) return false;
      // Profile tab links ("/<user>/reels/", role="tab") are navigation, not posts. They used to
      // become a fake 0-view "dom_post_N" reel that took one of the 6 slots and dragged ER/VR down.
      if (a.closest('[role="tablist"]') || a.getAttribute('role') === 'tab') return false;
      const href = (a.getAttribute('href') || '').split(/[?#]/)[0];
      return /\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/i.test(href);
    });

    const seenShortcodes = new Set();
    const domPinnedShortcodes = new Set();
    const domPosts = [];
    const postElements = [];

    anchors.forEach((a, index) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
      const shortcode = m ? m[1] : `dom_post_${index}`;
      if (seenShortcodes.has(shortcode)) return;
      seenShortcodes.add(shortcode);

      const isPinned = isDomPostElementPinned(a);
      if (isPinned) {
        domPinnedShortcodes.add(shortcode);
      }

      const { views, likes, comments, hasCounts, hasViews } = extractCountsFromDomPostTile(a);
      const { isReel, isExplicitNonReel } = detectDomPostReelStatus(a, views, hasViews);

      domPosts.push({
        shortcode,
        views,
        likes,
        comments,
        isPinned,
        isReel,
        isExplicitNonReel,
        hasCounts,
        hasViews,
        index
      });
      postElements.push({ el: a, shortcode, isPinned, isReel, isExplicitNonReel });
    });

    return { domPosts, domPinnedShortcodes, postElements };
  }

  /**
   * Extracts follower count from the profile page DOM.
   * @param {Document} [rootDoc=document]
   * @returns {number}
   */
  function extractFollowersFromDom(rootDoc = document) {
    const header = findProfileHeaderElement(rootDoc) || rootDoc;

    // 1. Explicit data attribute
    const explicitAttrEl = header.querySelector('[data-followers], [data-follower-count]');
    if (explicitAttrEl) {
      const val = explicitAttrEl.getAttribute('data-followers') || explicitAttrEl.getAttribute('data-follower-count');
      const count = Core.parseCount(val);
      if (count > 0) return count;
    }

    // 2. Link to /followers/ (Instagram puts the exact number in span[title] inside a[href*="/followers"])
    const followerLinks = header.querySelectorAll('a[href*="/followers"]');
    for (const link of followerLinks) {
      const titled = link.querySelector('[title]');
      if (titled && titled.getAttribute('title')) {
        const count = Core.parseCount(titled.getAttribute('title'));
        if (count > 0) return count;
      }
      if (link.getAttribute('title')) {
        const count = Core.parseCount(link.getAttribute('title'));
        if (count > 0) return count;
      }
      const textCount = Core.parseCount(link.textContent);
      if (textCount > 0) return textCount;
    }

    // 3. Elements inside header containing the word "followers" or "follower" (with or without space between spans)
    const candidates = header.querySelectorAll('li, div, span, button, a');
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (/^[\d,.]+\s*[KMBkmb]?\s*followers?$/i.test(text)) {
        const titled = el.querySelector('[title]');
        if (titled && titled.getAttribute('title')) {
          const exact = Core.parseCount(titled.getAttribute('title'));
          if (exact > 0) return exact;
        }
        return Core.parseCount(text);
      }
    }

    // 4. Meta description fallback: <meta property="og:description" content="373K Followers, ...">
    const metas = rootDoc.querySelectorAll('meta[property="og:description"], meta[name="description"]');
    for (const meta of metas) {
      const content = meta.getAttribute('content') || '';
      const m = content.match(/([\d,.]+\s*[KMBkmb]?)\s+Followers/i);
      if (m) {
        return Core.parseCount(m[1]);
      }
    }

    return 0;
  }

  /**
   * Triggers hover events on non-pinned DOM post tiles to coax Instagram into rendering
   * hover overlay counts if they weren't already in the DOM.
   * @param {Array<{ el: Element, shortcode: string, isPinned: boolean, isReel?: boolean, isExplicitNonReel?: boolean }>} postElements
   * @param {number} [maxCount=7]
   */
  async function populateDomPostCountsViaHover(postElements, maxCount = Core.RECENT_POSTS_LIMIT + 1) {
    const hasNonPinnedReels = postElements.some((p) => !p.isPinned && p.isReel === true);
    const nonPinnedTargets = postElements
      .filter((p) => !p.isPinned && (hasNonPinnedReels ? p.isReel === true : !p.isExplicitNonReel))
      .slice(0, maxCount);
    const results = [];

    for (const item of nonPinnedTargets) {
      const initialCounts = extractCountsFromDomPostTile(item.el);
      let counts = initialCounts;
      if (!counts.hasCounts) {
        try {
          const targets = [item.el, item.el.firstElementChild].filter(Boolean);
          for (const t of targets) {
            if (typeof PointerEvent === 'function') {
              t.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
              t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
            }
            t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          }
          await new Promise((r) => setTimeout(r, 60));
          counts = extractCountsFromDomPostTile(item.el);
          for (const t of targets) {
            if (typeof PointerEvent === 'function') {
              t.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
            }
            t.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          }
        } catch (_err) {
          // ignore synthetic event errors
        }
      }
      const mergedViews = Math.max(counts.views || 0, initialCounts.views || 0);
      const mergedHasViews = Boolean(counts.hasViews || initialCounts.hasViews || mergedViews > 0);
      results.push({
        shortcode: item.shortcode,
        views: mergedViews,
        likes: counts.likes || initialCounts.likes || 0,
        comments: counts.comments || initialCounts.comments || 0,
        isPinned: false,
        isReel: Boolean(item.isReel || mergedHasViews),
        isExplicitNonReel: Boolean(item.isExplicitNonReel),
        hasViews: mergedHasViews
      });
    }

    return results;
  }

  // ============================================================================
  // Instagram API + Embedded SSR JSON + DOM Hybrid Profile Scraper
  // ============================================================================

  function buildInstagramApiHeaders() {
    const headers = {
      'x-ig-app-id': IG_WEB_APP_ID,
      'x-asbd-id': '129477',
      'x-requested-with': 'XMLHttpRequest',
      'accept': 'application/json'
    };
    try {
      if (typeof document !== 'undefined' && document.cookie) {
        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        if (m && m[1]) {
          headers['x-csrftoken'] = decodeURIComponent(m[1]);
        }
      }
    } catch (_err) {
      // ignore cookie access error
    }
    return headers;
  }

  /**
   * Scans embedded `<script type="application/json">` tags in the document for Relay/Polaris
   * profile user data, Clips/Reels connections, and timeline edges matching `username`.
   * @param {string} username
   * @param {Document} [rootDoc=document]
   * @returns {{ followers: number, posts: Array<object> }}
   */
  function extractDataFromEmbeddedScripts(username, rootDoc = document) {
    let followers = 0;
    let posts = [];
    let clipsPosts = [];
    if (!rootDoc || typeof rootDoc.querySelectorAll !== 'function') {
      return { followers, posts };
    }

    const targetLower = String(username || '').toLowerCase();
    const scripts = rootDoc.querySelectorAll('script[type="application/json"]');

    function walkObject(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) walkObject(item);
        return;
      }

      const uname = typeof obj.username === 'string' ? obj.username.toLowerCase() : '';
      if (targetLower && uname === targetLower) {
        const fCount = Core.parseCount(obj.edge_followed_by?.count ?? obj.follower_count ?? 0);
        if (fCount > followers) {
          followers = fCount;
        }
        const userClipsEdges =
          obj.xdt_api__v1__clips__user__connection_v2?.edges ||
          obj.edge_felix_video_timeline?.edges;
        if (Array.isArray(userClipsEdges) && userClipsEdges.length > clipsPosts.length) {
          clipsPosts = userClipsEdges;
        }
        const timelineEdges =
          obj.edge_owner_to_timeline_media?.edges ||
          obj.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
        if (Array.isArray(timelineEdges) && timelineEdges.length > posts.length) {
          posts = timelineEdges;
        }
      }

      const rootClipsEdges = obj.xdt_api__v1__clips__user__connection_v2?.edges;
      if (!uname && Array.isArray(rootClipsEdges) && rootClipsEdges.length > clipsPosts.length) {
        const firstNode = rootClipsEdges[0]?.node?.media || rootClipsEdges[0]?.node || rootClipsEdges[0];
        const edgeOwner = String(
          firstNode?.user?.username || firstNode?.owner?.username || ''
        ).toLowerCase();
        if (!edgeOwner || (targetLower && edgeOwner === targetLower)) {
          clipsPosts = rootClipsEdges;
        }
      }

      const rootTimelineEdges = obj.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
      if (!uname && Array.isArray(rootTimelineEdges) && rootTimelineEdges.length > posts.length) {
        const firstNode = rootTimelineEdges[0]?.node || rootTimelineEdges[0];
        const edgeOwner = String(
          firstNode?.user?.username || firstNode?.owner?.username || ''
        ).toLowerCase();
        if (targetLower && edgeOwner === targetLower) {
          posts = rootTimelineEdges;
        }
      }

      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') {
          walkObject(val);
        }
      }
    }

    for (const script of scripts) {
      const text = script.textContent || '';
      if (
        !text ||
        (!text.includes('edge_owner_to_timeline_media') &&
          !text.includes('follower_count') &&
          !text.includes('edge_followed_by') &&
          !text.includes('user_timeline_graphql') &&
          !text.includes('clips__user') &&
          !text.includes('edge_felix_video_timeline'))
      ) {
        continue;
      }
      try {
        walkObject(JSON.parse(text));
      } catch (_err) {
        // ignore non-JSON or malformed script blocks
      }
    }

    const bestPosts = clipsPosts.length > 0 ? clipsPosts : posts;
    return { followers, posts: bestPosts };
  }

  /**
   * Fetches profile info and recent Reels/posts from Instagram's internal web APIs:
   * 1. `GET /api/v1/users/web_profile_info/?username=...`
   * 2. `POST /api/v1/clips/user/` (Reels endpoint with exact `play_count` / `view_count` & `clips_tab_pinned_user_ids`)
   * 3. `GET /api/v1/feed/user/${username}/username/?count=18` fallback/combine (always called when `clips/user` is empty because `web_profile_info` only has legacy `video_view_count` and lacks `play_count`)
   *
   * @param {string} username
   * @param {Set<string>} [domPinnedShortcodes]
   * @returns {Promise<{ followers: number, posts: Array<object> } | null>}
   */
  async function fetchFromInstagramApi(username, domPinnedShortcodes) {
    if (typeof fetch !== 'function') return null;

    const headers = buildInstagramApiHeaders();
    let followers = 0;
    let userId = '';
    let timelinePosts = [];
    let clipsPosts = [];

    // 1. Try web_profile_info endpoint
    try {
      const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers
      });

      if (response && response.ok) {
        const json = await response.json();
        const user = json && json.data && json.data.user;
        if (user) {
          userId = String(user.id || user.pk || user.pk_id || '');
          followers = Core.parseCount(
            user.edge_followed_by?.count ?? user.follower_count ?? 0
          );
          const timelineEdges =
            user.edge_owner_to_timeline_media?.edges ||
            user.xdt_api__v1__feed__user_timeline_graphql_connection?.edges;
          if (Array.isArray(timelineEdges) && timelineEdges.length > 0) {
            timelinePosts = timelineEdges;
            // Record any timeline-pinned shortcodes into domPinnedShortcodes
            if (domPinnedShortcodes instanceof Set) {
              for (const edge of timelineEdges) {
                const n = edge && edge.node ? edge.node : edge;
                if (n && Core.isPostPinned(n, domPinnedShortcodes)) {
                  const sc = n.shortcode || n.code;
                  if (sc) domPinnedShortcodes.add(sc);
                }
              }
            }
          }
        }
      }
    } catch (_err) {
      // Proceed to clips/feed fallbacks
    }

    // 2. Fetch dedicated Reels endpoint `/api/v1/clips/user/` if we have `userId`
    if (userId) {
      try {
        const clipsUrl = 'https://www.instagram.com/api/v1/clips/user/';
        const clipsBody = `target_user_id=${encodeURIComponent(userId)}&page_size=12&include_feed_video=true`;
        const clipsRes = await fetch(clipsUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            ...headers,
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: clipsBody
        });
        if (clipsRes && clipsRes.ok) {
          const clipsJson = await clipsRes.json();
          if (Array.isArray(clipsJson?.items) && clipsJson.items.length > 0) {
            clipsPosts = clipsJson.items;
          }
        }
      } catch (_clipsErr) {
        // Keep timelinePosts fallback
      }
    }

    let posts = clipsPosts.length > 0 ? clipsPosts : timelinePosts;

    // 3. Also try v1 feed endpoint if we have fewer than 6 non-pinned posts OR if clipsPosts is empty
    // (because timelinePosts from web_profile_info only has legacy video_view_count and lacks play_count!)
    const selectedInitial = Core.selectRecentNonPinnedPosts(posts, domPinnedShortcodes);
    const nonPinnedCount = selectedInitial.length;
    const hasUnreliableReelViews =
      clipsPosts.length === 0 &&
      selectedInitial.some((p) => p.isReel && !p.hasReliableViews);

    if (nonPinnedCount < Core.RECENT_POSTS_LIMIT || clipsPosts.length === 0 || hasUnreliableReelViews) {
      try {
        const feedUrl = `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(username)}/username/?count=18`;
        const feedRes = await fetch(feedUrl, {
          method: 'GET',
          credentials: 'include',
          headers
        });
        if (feedRes && feedRes.ok) {
          const feedJson = await feedRes.json();
          if (Array.isArray(feedJson?.items) && feedJson.items.length > 0) {
            if (clipsPosts.length > 0) {
              // Combine additional Reels from feedJson.items without overwriting clipsPosts with photos
              const seenCodes = new Set(
                posts.map((p) => Core.normalizePost(p, domPinnedShortcodes).shortcode).filter(Boolean)
              );
              for (const item of feedJson.items) {
                const norm = Core.normalizePost(item, domPinnedShortcodes);
                if (norm.isReel && norm.shortcode && !seenCodes.has(norm.shortcode)) {
                  seenCodes.add(norm.shortcode);
                  posts.push(item);
                }
              }
            } else {
              // Merge feedJson.items play_count with timelinePosts so we never lose play_count or pin flags
              const feedByCode = new Map();
              for (const item of feedJson.items) {
                const norm = Core.normalizePost(item, domPinnedShortcodes);
                if (norm.shortcode) {
                  feedByCode.set(norm.shortcode, { raw: item, norm });
                }
              }
              const timelineByCode = new Map();
              for (const edge of posts) {
                const norm = Core.normalizePost(edge, domPinnedShortcodes);
                if (norm.shortcode) {
                  timelineByCode.set(norm.shortcode, { raw: edge, norm });
                }
              }

              const feedNonPinned = Core.selectRecentNonPinnedPosts(feedJson.items, domPinnedShortcodes).length;
              if (feedNonPinned > nonPinnedCount || feedJson.items.length > posts.length) {
                posts = feedJson.items.map((item) => {
                  const normFeed = Core.normalizePost(item, domPinnedShortcodes);
                  const matchedTimeline = timelineByCode.get(normFeed.shortcode);
                  if (matchedTimeline) {
                    return {
                      ...normFeed,
                      views: Math.max(normFeed.views || 0, matchedTimeline.norm.views || 0),
                      hasReliableViews: Boolean(normFeed.hasReliableViews || matchedTimeline.norm.hasReliableViews),
                      likes: normFeed.likes || matchedTimeline.norm.likes,
                      comments: normFeed.comments || matchedTimeline.norm.comments,
                      isPinned: Boolean(normFeed.isPinned || matchedTimeline.norm.isPinned),
                      isReel: Boolean(normFeed.isReel || matchedTimeline.norm.isReel)
                    };
                  }
                  return item;
                });
              } else if (feedByCode.size > 0) {
                posts = posts.map((edge) => {
                  const normEdge = Core.normalizePost(edge, domPinnedShortcodes);
                  const matchedFeed = feedByCode.get(normEdge.shortcode);
                  if (matchedFeed) {
                    return {
                      ...normEdge,
                      views: Math.max(normEdge.views || 0, matchedFeed.norm.views || 0),
                      hasReliableViews: Boolean(normEdge.hasReliableViews || matchedFeed.norm.hasReliableViews),
                      likes: normEdge.likes || matchedFeed.norm.likes,
                      comments: normEdge.comments || matchedFeed.norm.comments,
                      isPinned: Boolean(normEdge.isPinned || matchedFeed.norm.isPinned),
                      isReel: Boolean(normEdge.isReel || matchedFeed.norm.isReel)
                    };
                  }
                  return edge;
                });
              }
            }
            if (followers === 0 && feedJson.items[0]?.user) {
              followers = Core.parseCount(feedJson.items[0].user.follower_count ?? 0);
            }
          }
        }
      } catch (_feedErr) {
        // Keep existing posts
      }
    }

    if (followers === 0 && posts.length === 0) {
      return null;
    }
    return { followers, posts };
  }

  /**
   * Finds the profile's Reels tab link (`/<username>/reels/`, `https://www.instagram.com/<username>/reels/`, or `/reels/`) in the live page DOM if present.
   * @param {Document|Element} [rootDoc=document]
   * @returns {Element|null}
   */
  function findReelsTabLink(rootDoc = document, username = '') {
    if (!rootDoc || typeof rootDoc.querySelectorAll !== 'function') return null;
    const userKey = String(username || '').trim().replace(/^@+/, '').toLowerCase();
    const mainScope = (typeof rootDoc.querySelector === 'function' && rootDoc.querySelector('main')) || rootDoc;
    const scopes = mainScope !== rootDoc ? [mainScope, rootDoc] : [rootDoc];
    for (const scope of scopes) {
      const links = Array.from(scope.querySelectorAll('a[href*="/reels"]')).filter(
        (a) => !a.closest || !a.closest('#ig-scraper-panel')
      );
      const match = links.find((a) => {
        const href = (a.getAttribute('href') || '').split(/[?#]/)[0];
        // Only THIS profile's Reels tab. The global "/reels/" feed link in the sidebar used to
        // match too: clicking it left the profile and the rescan read random feed reels.
        const m = href.match(/(?:^|instagram\.com)\/([^/]+)\/reels\/?$/i);
        if (!m) return false;
        return !userKey || m[1].toLowerCase() === userKey;
      });
      if (match) return match;
    }
    return null;
  }

  /**
   * Merges primary API/SSR posts with secondary SSR/DOM posts so written K/M DOM view counts
   * and Clips play_count values always override undercounted legacy video_view_count values.
   * @param {Array<object>} primaryPosts
   * @param {Array<object>} ssrPosts
   * @param {Array<object>} domPosts
   * @param {Set<string>} domPinnedShortcodes
   * @returns {Array<object>}
   */
  function mergePostLists(primaryPosts, ssrPosts, domPosts, domPinnedShortcodes) {
    const normalizedPrimary = (Array.isArray(primaryPosts) ? primaryPosts : []).map((p, idx) =>
      Core.normalizePost(p, domPinnedShortcodes, idx)
    );
    const normalizedSsr = (Array.isArray(ssrPosts) ? ssrPosts : []).map((p, idx) =>
      Core.normalizePost(p, domPinnedShortcodes, idx)
    );
    const normalizedDom = (Array.isArray(domPosts) ? domPosts : []).map((p, idx) =>
      Core.normalizePost(p, domPinnedShortcodes, idx)
    );

    const ssrByCode = new Map();
    for (const s of normalizedSsr) {
      if (s.shortcode) ssrByCode.set(s.shortcode, s);
    }

    const domByCode = new Map();
    for (const d of normalizedDom) {
      if (d.shortcode) domByCode.set(d.shortcode, d);
    }

    const matchedDomCodes = new Set();
    const merged = normalizedPrimary.map((p) => {
      const s = ssrByCode.get(p.shortcode);
      const d = domByCode.get(p.shortcode);
      if (d) matchedDomCodes.add(d.shortcode);

      // An exact API/SSR play count is authoritative. Taking the max of all sources let a
      // mis-parsed or mis-paired DOM badge override a correct play_count.
      let bestViews;
      if (p.hasReliableViews && p.views > 0) {
        bestViews = p.views;
      } else if (s && s.hasReliableViews && s.views > 0) {
        bestViews = s.views;
      } else {
        bestViews = Math.max(
          p.views || 0,
          s ? s.views || 0 : 0,
          d ? d.views || 0 : 0
        );
      }
      const hasReliableViews = Boolean(
        p.hasReliableViews ||
        (s && s.hasReliableViews) ||
        (d && d.views > 0)
      );

      return {
        ...p,
        views: bestViews,
        viewsFormatted: Core.formatCompactCount(bestViews),
        hasReliableViews,
        likes: p.likes > 0 ? p.likes : (s && s.likes > 0 ? s.likes : (d ? d.likes : 0)),
        comments: p.comments > 0 ? p.comments : (s && s.comments > 0 ? s.comments : (d ? d.comments : 0)),
        isPinned: Boolean(p.isPinned || (s && s.isPinned) || (d && d.isPinned)),
        isReel: p.isExplicitNonReel ? false : Boolean(p.isReel || (s && s.isReel) || (d && d.isReel))
      };
    });

    // If any non-pinned Reels in `merged` still have unreliable views (e.g. only legacy video_view_count from web_profile_info)
    // and `normalizedDom` has unmatched non-pinned Reels with written view badges, pair them in order:
    const unmatchedDomReelsWithViews = normalizedDom.filter(
      (d) => !d.isPinned && d.isReel && d.views > 0 && !matchedDomCodes.has(d.shortcode)
    );
    let domReelIdx = 0;
    for (const item of merged) {
      if (!item.isPinned && item.isReel && !item.hasReliableViews && domReelIdx < unmatchedDomReelsWithViews.length) {
        const domReel = unmatchedDomReelsWithViews[domReelIdx++];
        item.views = Math.max(item.views || 0, domReel.views || 0);
        item.viewsFormatted = Core.formatCompactCount(item.views);
        item.hasReliableViews = true;
      }
    }

    return merged;
  }

  /**
   * Scrapes the profile for `username` using API + SSR JSON + DOM cross-checking and DOM fallback.
   * Exclusively uses up to 6 recent non-pinned Reels/posts (skipping pinned posts and optionally
   * skipping the single most recent post when `excludeMostRecent` is enabled).
   * @param {string} [targetUsername]
   * @param {Document} [rootDoc=document]
   * @param {{ excludeMostRecent?: boolean }} [options]
   * @returns {Promise<object>}
   */
  async function scrapeProfileData(targetUsername, rootDoc = document, options = undefined) {
    const username = targetUsername || detectCurrentProfileUsername(rootDoc);
    if (!username) {
      throw new Error('Could not detect Instagram profile username on this page.');
    }

    const settings = options && typeof options.excludeMostRecent === 'boolean'
      ? options
      : await getScraperSettings();
    const excludeMostRecent = Boolean(settings && settings.excludeMostRecent);
    const targetSliceCount = Core.RECENT_POSTS_LIMIT + (excludeMostRecent ? 1 : 0);

    // Step 1: Scan DOM for pinned post shortcodes, DOM post counts, and DOM followers
    let { domPosts, domPinnedShortcodes, postElements } = scanDomGridPosts(rootDoc);
    const domFollowers = extractFollowersFromDom(rootDoc);

    // Step 2: Attempt Instagram Web API + Reels Clips API + Embedded SSR JSON
    const apiData = await fetchFromInstagramApi(username, domPinnedShortcodes);
    const ssrData = extractDataFromEmbeddedScripts(username, rootDoc);

    const bestFollowers =
      (apiData && apiData.followers > 0 ? apiData.followers : 0) ||
      (ssrData && ssrData.followers > 0 ? ssrData.followers : 0) ||
      domFollowers;

    const primaryPosts =
      (apiData && apiData.posts.length > 0 ? apiData.posts : null) ||
      (ssrData && ssrData.posts.length > 0 ? ssrData.posts : null);

    if (primaryPosts && primaryPosts.length > 0) {
      let mergedPosts = mergePostLists(
        primaryPosts,
        ssrData && ssrData.posts ? ssrData.posts : [],
        domPosts,
        domPinnedShortcodes
      );

      let selectedBeforeTab = Core.selectRecentNonPinnedPosts(mergedPosts, domPinnedShortcodes, Core.RECENT_POSTS_LIMIT, {
        excludeMostRecent
      });
      let needsReelsTabViews =
        selectedBeforeTab.length > 0 &&
        selectedBeforeTab.some((p) => p.isReel && !p.hasReliableViews);

      // If current DOM tiles haven't been hovered yet and might reveal view counts on hover, hover them first:
      if (needsReelsTabViews && postElements.length > 0 && domPosts.some((d) => !d.isPinned && !d.hasViews)) {
        const hoveredNonPinned = await populateDomPostCountsViaHover(postElements, targetSliceCount);
        if (hoveredNonPinned.some((h) => h.views > 0)) {
          const pinnedOnly = domPosts.filter((p) => p.isPinned);
          domPosts = [...pinnedOnly, ...hoveredNonPinned];
          mergedPosts = mergePostLists(
            primaryPosts,
            ssrData && ssrData.posts ? ssrData.posts : [],
            domPosts,
            domPinnedShortcodes
          );
          selectedBeforeTab = Core.selectRecentNonPinnedPosts(mergedPosts, domPinnedShortcodes, Core.RECENT_POSTS_LIMIT, {
            excludeMostRecent
          });
          needsReelsTabViews =
            selectedBeforeTab.length > 0 &&
            selectedBeforeTab.some((p) => p.isReel && !p.hasReliableViews);
        }
      }

      // If merged posts still lack reliable Reel view counts (e.g., web_profile_info only had video_view_count
      // and the user is on the main Posts tab where DOM tiles don't show Reel view badges),
      // switch to the Reels tab if available in the DOM to read the written K/M view badges!
      if (needsReelsTabViews) {
        const reelsTabLink = findReelsTabLink(rootDoc, username);
        if (reelsTabLink && typeof reelsTabLink.click === 'function') {
          try {
            reelsTabLink.click();
            for (let attempt = 0; attempt < 8; attempt++) {
              await new Promise((r) => setTimeout(r, 100));
              const rescan = scanDomGridPosts(rootDoc);
              if (rescan.domPosts.some((d) => d.views > 0)) {
                domPosts = rescan.domPosts;
                for (const code of rescan.domPinnedShortcodes) {
                  domPinnedShortcodes.add(code);
                }
                break;
              }
            }
            mergedPosts = mergePostLists(
              primaryPosts,
              ssrData && ssrData.posts ? ssrData.posts : [],
              domPosts,
              domPinnedShortcodes
            );
          } catch (_tabErr) {
            // ignore tab click errors
          }
        }
      }

      return Core.calculateProfileMetrics({
        username,
        followers: bestFollowers,
        posts: mergedPosts,
        domPinnedShortcodes,
        excludeMostRecent
      });
    }

    // Step 3: DOM Post Fallback (with hover if counts aren't rendered yet)
    const hasDomReels = domPosts.some((p) => !p.isPinned && p.isReel === true);
    const candidateDomPosts = domPosts.filter(
      (p) => !p.isPinned && (hasDomReels ? p.isReel === true : !p.isExplicitNonReel)
    );
    const needHover = candidateDomPosts
      .slice(0, targetSliceCount)
      .some((p) => !p.hasCounts);

    let finalDomPosts = domPosts;
    if (needHover && postElements.length > 0) {
      const hoveredNonPinned = await populateDomPostCountsViaHover(postElements, targetSliceCount);
      const pinnedOnly = domPosts.filter((p) => p.isPinned);
      finalDomPosts = [...pinnedOnly, ...hoveredNonPinned];
    }

    // If DOM fallback Reels still lack view counts (e.g. on main Posts tab) and a Reels tab link exists, click it and merge views:
    const domSelected = Core.selectRecentNonPinnedPosts(finalDomPosts, domPinnedShortcodes, Core.RECENT_POSTS_LIMIT, {
      excludeMostRecent
    });
    if (domSelected.length > 0 && domSelected.some((p) => !p.hasReliableViews)) {
      const reelsTabLink = findReelsTabLink(rootDoc, username);
      if (reelsTabLink && typeof reelsTabLink.click === 'function') {
        try {
          reelsTabLink.click();
          for (let attempt = 0; attempt < 8; attempt++) {
            await new Promise((r) => setTimeout(r, 100));
            const rescan = scanDomGridPosts(rootDoc);
            if (rescan.domPosts.some((d) => d.views > 0)) {
              for (const code of rescan.domPinnedShortcodes) {
                domPinnedShortcodes.add(code);
              }
              finalDomPosts = mergePostLists(finalDomPosts, [], rescan.domPosts, domPinnedShortcodes);
              break;
            }
          }
        } catch (_tabErr) {
          // ignore tab click errors
        }
      }
    }

    return Core.calculateProfileMetrics({
      username,
      followers: bestFollowers,
      posts: finalDomPosts,
      domPinnedShortcodes,
      excludeMostRecent
    });
  }

  // ============================================================================
  // Profile Username Detection & Header Button Injection
  // ============================================================================

  function extractCleanHeadingUsername(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    if (clone.querySelectorAll) {
      const noise = clone.querySelectorAll('svg, button, .ig-scraper-btn, [aria-label="Verified" i]');
      noise.forEach((n) => n.remove());
    }
    return (clone.textContent || '').trim().replace(/^@/, '');
  }

  function detectCurrentProfileUsername(rootDoc = document) {
    const loc = typeof window !== 'undefined' && window.location ? window.location : null;
    const pathname = loc ? loc.pathname : '';
    const hostname = loc ? (loc.hostname || '').toLowerCase() : '';

    const fromPath = Core.extractProfileUsernameFromPath(pathname);
    if (fromPath) return fromPath;

    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
      return null;
    }

    const header = findProfileHeaderElement(rootDoc);
    if (header) {
      const heading = header.querySelector('h2, h1, [role="heading"]');
      if (heading) {
        const text = extractCleanHeadingUsername(heading);
        if (/^[a-zA-Z0-9._]{1,30}$/.test(text)) {
          return text;
        }
      }
    }
    return null;
  }

  function findProfileUsernameElement(username, rootDoc = document) {
    const header = findProfileHeaderElement(rootDoc);
    if (!header) return null;

    const targetLower = String(username || '').toLowerCase();

    const headings = header.querySelectorAll('h2, h1, [role="heading"], [data-testid="profile-username"], .profile-username');
    for (const h of headings) {
      const cleanText = extractCleanHeadingUsername(h);
      if (targetLower && cleanText.toLowerCase() === targetLower) {
        return h;
      }
    }

    if (targetLower) {
      const els = header.querySelectorAll('span, a, div');
      for (const el of els) {
        const cleanText = extractCleanHeadingUsername(el);
        if (cleanText.toLowerCase() === targetLower && el.querySelectorAll('span, div').length <= 2) {
          return el.closest('h2, h1, [role="heading"], a') || el;
        }
      }
    }

    if (!targetLower && headings.length > 0) {
      return headings[0];
    }

    return null;
  }

  function ensureProfileScrapeButton(rootDoc = document) {
    const username = detectCurrentProfileUsername(rootDoc);
    let existingBtn = rootDoc.getElementById('ig-scraper-profile-btn');

    // A button left behind by an orphaned (pre-update) copy of this script has a dead click
    // handler. Replace it so the freshly injected copy owns a working button.
    if (existingBtn && existingBtn.getAttribute(INSTANCE_ATTR) !== INSTANCE_TOKEN) {
      existingBtn.remove();
      existingBtn = null;
    }

    if (!username) {
      if (existingBtn) existingBtn.remove();
      return null;
    }

    const nameEl = findProfileUsernameElement(username, rootDoc);
    if (!nameEl) {
      if (existingBtn && existingBtn.getAttribute('data-username') !== username) {
        existingBtn.remove();
      }
      return null;
    }

    if (existingBtn) {
      if (existingBtn.getAttribute('data-username') !== username) {
        existingBtn.setAttribute('data-username', username);
        existingBtn.className = 'ig-scraper-btn';
        existingBtn.innerHTML = `<span class="ig-scraper-btn-icon">${renderCrowLogoImg('ig-scraper-btn-crow')}</span><span class="ig-scraper-btn-text">Scrape Profile</span>`;
        bindCrowLogoFallback(existingBtn);
        existingBtn.disabled = false;
      }
      if (existingBtn.previousElementSibling !== nameEl) {
        if (nameEl.parentElement) {
          nameEl.insertAdjacentElement('afterend', existingBtn);
        } else {
          nameEl.appendChild(existingBtn);
        }
      }
      return existingBtn;
    }

    const btn = rootDoc.createElement('button');
    btn.id = 'ig-scraper-profile-btn';
    btn.type = 'button';
    btn.className = 'ig-scraper-btn';
    btn.setAttribute(INSTANCE_ATTR, INSTANCE_TOKEN);
    btn.setAttribute('data-username', username);
    btn.title = 'Crow Scrapper by @mhrshadfm — Scrape Followers, View Rate (V.R.) & Engagement Rate (ER) from 6 recent non-pinned Reels';
    btn.innerHTML = `<span class="ig-scraper-btn-icon">${renderCrowLogoImg('ig-scraper-btn-crow')}</span><span class="ig-scraper-btn-text">Scrape Profile</span>`;
    bindCrowLogoFallback(btn);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleScrapeButtonClick(btn, rootDoc);
    });

    if (nameEl.parentElement) {
      nameEl.insertAdjacentElement('afterend', btn);
    } else {
      nameEl.appendChild(btn);
    }

    return btn;
  }

  function setScrapeButtonState(btn, stateClass, text, title) {
    btn.className = stateClass ? `ig-scraper-btn ${stateClass}` : 'ig-scraper-btn';
    btn.innerHTML = `<span class="ig-scraper-btn-icon">${renderCrowLogoImg('ig-scraper-btn-crow')}</span><span class="ig-scraper-btn-text"></span>`;
    const textEl = btn.querySelector('.ig-scraper-btn-text');
    if (textEl) textEl.textContent = text;
    if (title) btn.title = title;
    bindCrowLogoFallback(btn);
  }

  function showPanelStatus(message, type, rootDoc = document) {
    const statusEl = rootDoc.getElementById('ig-scraper-panel-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `ig-scraper-panel-status ${type}`;
  }

  function sameUsername(a, b) {
    return Boolean(a && b) && Core.normalizeUsernameKey(a) === Core.normalizeUsernameKey(b);
  }

  /**
   * Rejects results that would be misleading to save: a profile with no analyzable posts
   * (private account, or no Reels/posts yet) would otherwise be stored as ER 0.00% / "Very low".
   */
  function assertScrapeHasPosts(metrics, username) {
    if (!metrics || !metrics.postsAnalyzed) {
      throw new Error(
        `No public Reels/posts could be read for @${username}. The account may be private, have no posts yet, or Instagram did not load the grid — scroll the profile a little and retry.`
      );
    }
  }

  /**
   * Throws if the user navigated to a different profile while the scrape was running, so data
   * gathered from a mix of two profiles' DOM is never saved under one username.
   */
  function assertStillOnProfile(username, rootDoc = document) {
    const nowOn = detectCurrentProfileUsername(rootDoc);
    if (nowOn && !sameUsername(nowOn, username)) {
      throw new Error(`You navigated away from @${username} while it was being scraped — open it again and retry.`);
    }
  }

  async function handleScrapeButtonClick(btn, rootDoc = document) {
    const currentUsername = detectCurrentProfileUsername(rootDoc) || btn.getAttribute('data-username');
    if (!currentUsername) return;

    if (!isExtensionContextAlive()) {
      setScrapeButtonState(btn, 'ig-scraper-btn-error', '⟳ Refresh tab to use Crow Scrapper', RELOAD_REQUIRED_MESSAGE);
      return;
    }

    // The same <button> element is re-labelled when the user SPA-navigates to another profile.
    // Only touch it again if it still belongs to the profile this scrape was started for.
    const buttonStillForUser = () => sameUsername(btn.getAttribute('data-username'), currentUsername);

    btn.disabled = true;
    setScrapeButtonState(btn, 'ig-scraper-btn-loading', '⏳ Scraping 6 recent reels...');

    try {
      const metrics = await scrapeProfileData(currentUsername, rootDoc);
      assertStillOnProfile(currentUsername, rootDoc);
      assertScrapeHasPosts(metrics, currentUsername);
      const updatedList = await upsertProfileRecord(metrics);

      if (buttonStillForUser()) {
        btn.disabled = false;
        setScrapeButtonState(btn, 'ig-scraper-btn-success', `✓ Scraped · ER ${metrics.erFormatted} · VR ${metrics.vrFormatted}`);
      }

      ensureInPagePanel(rootDoc);
      await renderInPagePanelList(updatedList, rootDoc);
      showPanelExpanded(true, rootDoc);

      // Auto-sync to Shared Google Sheet if configured
      const sheetCfg = await getGoogleSheetConfig();
      if (sheetCfg && sheetCfg.autoSync && (sheetCfg.webAppUrl || (sheetCfg.sheetUrl && sheetCfg.accessToken))) {
        syncProfilesWithGoogleSheet(updatedList)
          .then((res) => {
            if (res && !res.ok) {
              showPanelStatus(`Auto-sync to Google Sheet failed: ${res.error || 'unknown error'}`, 'error', rootDoc);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      const message = (err && err.message) || String(err);
      if (buttonStillForUser()) {
        btn.disabled = false;
        setScrapeButtonState(
          btn,
          'ig-scraper-btn-error',
          isExtensionContextAlive() ? '⚠️ Retry Scrape' : '⟳ Refresh tab to use Crow Scrapper',
          message
        );
      }
      ensureInPagePanel(rootDoc);
      showPanelExpanded(true, rootDoc);
      showPanelStatus(message, 'error', rootDoc);
      console.error('[Crow Scrapper] Scrape error:', err);
    }
  }

  // ============================================================================
  // File Download Helpers (Excel .xlsx & CSV .csv)
  // ============================================================================

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 500);
  }

  async function downloadExcelFile() {
    const list = await getStoredProfiles();
    if (list.length === 0) throw new Error('No scraped profiles to export yet.');
    const bytes = Core.generateXlsxBytes(list);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(blob, `instagram_profiles_${dateStamp}.xlsx`);
  }

  async function downloadCsvFile() {
    const list = await getStoredProfiles();
    if (list.length === 0) throw new Error('No scraped profiles to export yet.');
    const csv = Core.generateCsvContent(list);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(blob, `instagram_profiles_${dateStamp}.csv`);
  }

  // ============================================================================
  // In-Page Collapsible List Panel (Quick Access on Instagram)
  // ============================================================================

  function getVrBadgeClass(band) {
    const b = String(band || '').toLowerCase();
    if (b === 'very high') return 'ig-badge-vr-vhigh';
    if (b === 'high') return 'ig-badge-vr-high';
    if (b === 'medium') return 'ig-badge-vr-med';
    if (b === 'low') return 'ig-badge-vr-low';
    return 'ig-badge-vr-vlow';
  }

function describeSheetSyncResult(res) {
    const dupRemoved = Number(res && res.duplicateRowsRemoved) || 0;
    const dupFound = Number(res && res.duplicateRowsFound) || 0;
    if (dupRemoved > 0) return `${dupRemoved} duplicate row(s) removed`;
    if (dupFound > 0) return `${dupFound} duplicate row(s) already in the sheet — delete them manually`;
    return 'no duplicates';
  }

  function showPanelExpanded(expanded, rootDoc = document) {
    const panel = rootDoc.getElementById('ig-scraper-panel');
    if (!panel) return;
    if (expanded) {
      panel.classList.remove('ig-scraper-panel-collapsed');
    } else {
      panel.classList.add('ig-scraper-panel-collapsed');
    }
  }

  function ensureInPagePanel(rootDoc = document) {
    let panel = rootDoc.getElementById('ig-scraper-panel');
    if (panel && panel.getAttribute(INSTANCE_ATTR) === INSTANCE_TOKEN) return panel;

    // A panel created by an orphaned (pre-update) copy has dead listeners — rebuild it.
    const keepExpanded = Boolean(panel && !panel.classList.contains('ig-scraper-panel-collapsed'));
    if (panel) panel.remove();

    panel = rootDoc.createElement('div');
    panel.id = 'ig-scraper-panel';
    panel.setAttribute(INSTANCE_ATTR, INSTANCE_TOKEN);
    panel.className = keepExpanded ? 'ig-scraper-panel' : 'ig-scraper-panel ig-scraper-panel-collapsed';
    panel.innerHTML = `
      <div class="ig-scraper-panel-header" id="ig-scraper-panel-toggle">
        <div class="ig-scraper-panel-title">
          <span class="ig-scraper-logo-badge">${renderCrowLogoImg('ig-scraper-panel-crow')}</span>
          <span class="ig-scraper-brand-name">Crow Scrapper</span>
          <a href="https://www.instagram.com/mhrshadfm/" target="_blank" rel="noopener noreferrer" class="ig-scraper-owner-pill" title="Created &amp; Owned by @mhrshadfm">by @mhrshadfm</a>
          <span class="ig-scraper-badge" id="ig-scraper-count-badge">0</span>
        </div>
        <div class="ig-scraper-panel-header-actions">
          <button type="button" class="ig-scraper-export-btn ig-scraper-sheet-btn" id="ig-scraper-sync-sheet" title="Sync deduplicated list to connected Shared Google Sheet">☁️ Sync Sheet</button>
          <button type="button" class="ig-scraper-export-btn ig-scraper-xlsx-btn" id="ig-scraper-dl-xlsx" title="Download Excel (.xlsx) with clickable usernames">Excel (.xlsx)</button>
          <button type="button" class="ig-scraper-export-btn ig-scraper-csv-btn" id="ig-scraper-dl-csv" title="Download CSV (.csv)">CSV (.csv)</button>
          <button type="button" class="ig-scraper-toggle-icon" id="ig-scraper-expand-btn" title="Toggle table">▲</button>
        </div>
      </div>
      <div class="ig-scraper-panel-body" id="ig-scraper-panel-body">
        <div class="ig-scraper-controls-row">
          <div class="ig-scraper-subtitle">
            <strong>6 recent non-pinned Reels</strong> · Pinned posts excluded.
          </div>
          <label class="ig-scraper-skip-toggle" title="When checked, skips the #1 newest post/reel in addition to pinned posts">
            <input type="checkbox" id="ig-scraper-skip-recent" />
            <span>Skip most recent post/reel</span>
          </label>
        </div>
        <div class="ig-scraper-benchmarks-bar">
          <span><strong>V.R. Bands:</strong> Very low ≤10% · Low 10-15% · Medium 15-30% · High 30-50% · Very high ≥50%</span>
          <span><strong>E.R. Benchmarks:</strong> ≤1K: 8% · 1K-5K: 5.7% · 5K-10K: 4% · 10K-100K: 2.4% · ≥100K: 1.7%</span>
        </div>
        <div id="ig-scraper-panel-status" class="ig-scraper-panel-status hidden"></div>
        <div class="ig-scraper-table-wrap">
          <table class="ig-scraper-table" id="ig-scraper-table">
            <thead>
              <tr>
                <th class="col-username">USERNAME</th>
                <th class="col-follower">Follower</th>
                <th class="col-er">ER</th>
                <th class="col-vr">V.R.</th>
                <th class="col-avview">AV VIEW</th>
                <th class="col-avlike">AV LIKE</th>
                <th class="col-avcomments">AV COMMENTS</th>
                <th class="col-lpc">LIKES PER COMMENT</th>
                <th class="col-price">Price/REEL</th>
                <th class="col-del"></th>
              </tr>
            </thead>
            <tbody id="ig-scraper-tbody"></tbody>
          </table>
        </div>
        <div class="ig-scraper-panel-footer">
          <span class="ig-scraper-footer-owner">Crow Scrapper · Owner: <a href="https://www.instagram.com/mhrshadfm/" target="_blank" rel="noopener noreferrer" class="ig-scraper-footer-owner-link">@mhrshadfm</a></span>
          <button type="button" class="ig-scraper-clear-btn" id="ig-scraper-clear-btn">Clear List</button>
        </div>
      </div>
    `;

    rootDoc.body.appendChild(panel);
    bindCrowLogoFallback(panel);

    const skipCheckbox = panel.querySelector('#ig-scraper-skip-recent');
    if (skipCheckbox) {
      getScraperSettings()
        .then((s) => {
          skipCheckbox.checked = Boolean(s && s.excludeMostRecent);
        })
        .catch(() => {});
      skipCheckbox.addEventListener('change', async () => {
        try {
          await saveScraperSettings({ excludeMostRecent: skipCheckbox.checked });
        } catch (err) {
          showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
        }
      });
    }

    panel.querySelector('#ig-scraper-expand-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = panel.classList.contains('ig-scraper-panel-collapsed');
      showPanelExpanded(isCollapsed, rootDoc);
    });

    panel.querySelectorAll('a.ig-scraper-owner-pill, a.ig-scraper-footer-owner-link').forEach((linkEl) => {
      linkEl.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });

    panel.querySelector('#ig-scraper-panel-toggle').addEventListener('click', (e) => {
      const targetEl = e.target && typeof e.target.closest === 'function'
        ? e.target
        : (e.target && e.target.parentElement);
      if (targetEl && targetEl.closest('a')) return;
      if (targetEl && targetEl.closest('button') && targetEl.id !== 'ig-scraper-expand-btn') return;
      const isCollapsed = panel.classList.contains('ig-scraper-panel-collapsed');
      showPanelExpanded(isCollapsed, rootDoc);
    });

    panel.querySelector('#ig-scraper-sync-sheet').addEventListener('click', async (e) => {
      e.stopPropagation();
      showPanelExpanded(true, rootDoc);
      const statusEl = panel.querySelector('#ig-scraper-panel-status');
      if (statusEl) {
        statusEl.textContent = 'Syncing deduplicated list to Google Sheet...';
        statusEl.className = 'ig-scraper-panel-status info';
      }
      const res = await syncProfilesWithGoogleSheet();
      if (statusEl) {
        if (res && res.ok) {
          statusEl.textContent = `Synced to Google Sheet! (${res.updatedCount || 0} updated, ${res.appendedCount || 0} added, ${describeSheetSyncResult(res)})`;
          statusEl.className = 'ig-scraper-panel-status success';
        } else {
          statusEl.textContent = (res && res.error) || 'Configure your Shared Google Sheet in the extension popup first.';
          statusEl.className = 'ig-scraper-panel-status error';
        }
      }
    });

    panel.querySelector('#ig-scraper-dl-xlsx').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await downloadExcelFile();
      } catch (err) {
        showPanelExpanded(true, rootDoc);
        showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      }
    });

    panel.querySelector('#ig-scraper-dl-csv').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await downloadCsvFile();
      } catch (err) {
        showPanelExpanded(true, rootDoc);
        showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      }
    });

    panel.querySelector('#ig-scraper-clear-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const badge = rootDoc.getElementById('ig-scraper-count-badge');
      const count = badge ? Number(badge.textContent) || 0 : 0;
      if (count > 0 && typeof window !== 'undefined' && typeof window.confirm === 'function' &&
        !window.confirm(`Remove all ${count} scraped profile(s) from Crow Scrapper? This cannot be undone.`)) {
        return;
      }
      try {
        const empty = await clearAllProfiles();
        await renderInPagePanelList(empty, rootDoc);
      } catch (err) {
        showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      }
    });

    getStoredProfiles()
      .then((list) => renderInPagePanelList(list, rootDoc))
      .catch((err) => showPanelStatus((err && err.message) || String(err), 'error', rootDoc));
    return panel;
  }

  async function renderInPagePanelList(profiles, rootDoc = document) {
    const list = Array.isArray(profiles) ? profiles : await getStoredProfiles();
    const badge = rootDoc.getElementById('ig-scraper-count-badge');
    if (badge) badge.textContent = String(list.length);

    const tbody = rootDoc.getElementById('ig-scraper-tbody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="ig-scraper-empty-cell">
            No profiles scraped yet. Click <strong>"Scrape Profile"</strong> next to a profile's username!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    list.forEach((item) => {
      const tr = rootDoc.createElement('tr');
      const username = String(item.username || '');
      const profileUrl = item.profileUrl || `https://www.instagram.com/${encodeURIComponent(username)}/`;

      // Col 1: USERNAME
      const tdUser = rootDoc.createElement('td');
      tdUser.className = 'cell-username';
      const link = rootDoc.createElement('a');
      link.href = profileUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'ig-scraper-user-link';
      link.title = `Open @${username} on Instagram`;
      link.textContent = username;
      tdUser.appendChild(link);

      // Col 2: Follower
      const tdFollowers = rootDoc.createElement('td');
      tdFollowers.textContent = Core.formatNumberWithCommas(item.followers);

      // Col 3: ER + Follower Benchmark Badge
      const tdEr = rootDoc.createElement('td');
      const erVal = item.erFormatted || (Number(item.er || 0).toFixed(2) + '%');
      const erBenchInfo = Core.getErBenchmark(item.followers, item.er);
      const erSpan = rootDoc.createElement('span');
      erSpan.className = 'ig-metric-val';
      erSpan.textContent = erVal;
      const erBadge = rootDoc.createElement('span');
      const erBadgeClass = erBenchInfo.aboveBenchmark
        ? 'ig-badge-er-good'
        : Number(item.er || 0) >= erBenchInfo.benchmark * 0.5
          ? 'ig-badge-er-low'
          : 'ig-badge-er-bad';
      erBadge.className = `ig-metric-badge ${erBadgeClass}`;
      erBadge.title = `Benchmark for ${erBenchInfo.tier} followers: ${erBenchInfo.formatted}`;
      erBadge.textContent = `${erBenchInfo.aboveBenchmark ? '≥' : '<'}${erBenchInfo.formatted}`;
      tdEr.append(erSpan, erBadge);

      // Col 4: V.R. + View Rate Band Badge
      const tdVr = rootDoc.createElement('td');
      const vrVal = item.vrFormatted || (Number(item.vr || 0).toFixed(2) + '%');
      const vrBandInfo = Core.getViewRateBand(item.vr);
      const vrSpan = rootDoc.createElement('span');
      vrSpan.className = 'ig-metric-val';
      vrSpan.textContent = vrVal;
      const vrBadge = rootDoc.createElement('span');
      vrBadge.className = `ig-metric-badge ${getVrBadgeClass(vrBandInfo.band)}`;
      vrBadge.title = `View Rate Band: ${vrBandInfo.band} (${vrBandInfo.range})`;
      vrBadge.textContent = vrBandInfo.band;
      tdVr.append(vrSpan, vrBadge);

      // Col 5: AV VIEW
      const tdViews = rootDoc.createElement('td');
      tdViews.textContent = (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
        ? item.avgViewsFormatted
        : Core.formatCompactCount(item.avgViews);

      // Col 6: AV LIKE
      const tdLikes = rootDoc.createElement('td');
      tdLikes.textContent = Core.formatNumberWithCommas(item.avgLikes);

      // Col 7: AV COMMENTS
      const tdComments = rootDoc.createElement('td');
      tdComments.textContent = Core.formatNumberWithCommas(item.avgComments);

      // Col 8: LIKES PER COMMENT
      const tdLpc = rootDoc.createElement('td');
      tdLpc.textContent = Core.formatLikesPerComment(item.likesPerComment);

      // Col 9: Price/REEL (empty by default, editable)
      const tdPrice = rootDoc.createElement('td');
      const priceInput = rootDoc.createElement('input');
      priceInput.type = 'text';
      priceInput.className = 'ig-scraper-price-input';
      priceInput.value = item.pricePerReel !== undefined && item.pricePerReel !== null ? String(item.pricePerReel) : '';
      priceInput.placeholder = '';
      priceInput.title = 'Optional Price/REEL (kept empty by default)';
      priceInput.addEventListener('change', async () => {
        try {
          await updateProfilePrice(username, priceInput.value);
        } catch (err) {
          showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
        }
      });
      tdPrice.appendChild(priceInput);

      // Col 10: Remove button
      const tdDel = rootDoc.createElement('td');
      const delBtn = rootDoc.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ig-scraper-row-del';
      delBtn.setAttribute('data-username', username);
      delBtn.title = `Remove ${username}`;
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async () => {
        try {
          const updated = await removeProfileRecord(username);
          await renderInPagePanelList(updated, rootDoc);
        } catch (err) {
          showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
        }
      });
      tdDel.appendChild(delBtn);

      tr.append(tdUser, tdFollowers, tdEr, tdVr, tdViews, tdLikes, tdComments, tdLpc, tdPrice, tdDel);
      tbody.appendChild(tr);
    });
  }

  // ============================================================================
  // Message Listener (Communication with Extension Popup)
  // ============================================================================

  // Listeners are registered by every injected copy, but only the copy that currently owns the
  // page (see INSTANCE_TOKEN) answers. A boolean "already registered" flag on window would make a
  // re-injected copy skip registration while the orphaned copy's listeners are dead.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && isExtensionContextAlive()) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return false;
      if (!isCurrentInstance()) return false;

      if (message.type === 'GET_PAGE_STATUS') {
        const username = detectCurrentProfileUsername(document);
        sendResponse({ ok: true, username });
        return false;
      }

      if (message.type === 'SCRAPE_CURRENT_PROFILE') {
        const username = message.username || detectCurrentProfileUsername(document);
        if (!username) {
          sendResponse({ ok: false, error: 'Open an Instagram profile page (https://www.instagram.com/<username>/) first.' });
          return false;
        }
        const opts = typeof message.excludeMostRecent === 'boolean'
          ? { excludeMostRecent: message.excludeMostRecent }
          : undefined;
        scrapeProfileData(username, document, opts)
          .then(async (metrics) => {
            assertStillOnProfile(username, document);
            assertScrapeHasPosts(metrics, username);
            const list = await upsertProfileRecord(metrics);
            ensureInPagePanel(document);
            await renderInPagePanelList(list, document);
            const btn = document.getElementById('ig-scraper-profile-btn');
            if (btn && sameUsername(btn.getAttribute('data-username'), username)) {
              btn.disabled = false;
              setScrapeButtonState(btn, 'ig-scraper-btn-success', `✓ Scraped · ER ${metrics.erFormatted} · VR ${metrics.vrFormatted}`);
            }
            sendResponse({ ok: true, metrics, profiles: list });
            const sheetCfg = await getGoogleSheetConfig();
            if (sheetCfg && sheetCfg.autoSync && (sheetCfg.webAppUrl || (sheetCfg.sheetUrl && sheetCfg.accessToken))) {
              syncProfilesWithGoogleSheet(list).catch(() => {});
            }
          })
          .catch((err) => {
            try {
              sendResponse({ ok: false, error: (err && err.message) || String(err) });
            } catch (_sendErr) {
              // popup already closed
            }
          });
        return true; // keep channel open for async response
      }

      return false;
    });
  }

  // Listen for storage updates from popup to keep in-page list synced
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged && isExtensionContextAlive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!isCurrentInstance()) return;
      if (area === 'local' && changes[STORAGE_KEY]) {
        if (suppressNextStorageRender) {
          suppressNextStorageRender = false;
          return;
        }
        const newList = changes[STORAGE_KEY].newValue || [];
        renderInPagePanelList(newList, document).catch(() => {});
      }
      if (area === 'local' && changes[SETTINGS_KEY]) {
        const newSettings = changes[SETTINGS_KEY].newValue || {};
        const skipCb = document.getElementById('ig-scraper-skip-recent');
        if (skipCb) {
          skipCb.checked = Boolean(newSettings.excludeMostRecent);
        }
      }
    });
  }

  // ============================================================================
  // Initialization & SPA Navigation Observer
  // ============================================================================

  let contentObserver = null;
  let pendingEnsureFrame = 0;

  function teardownContentObserver() {
    if (contentObserver) {
      contentObserver.disconnect();
      contentObserver = null;
    }
    if (pendingEnsureFrame) {
      cancelAnimationFrame(pendingEnsureFrame);
      pendingEnsureFrame = 0;
    }
  }

  function initContentScript() {
    if (typeof document === 'undefined' || !document.body) return;

    ensureProfileScrapeButton(document);
    ensureInPagePanel(document);

    if (contentObserver) return;

    // Instagram mutates the DOM constantly; coalesce bursts of mutations into a single
    // ensureProfileScrapeButton() pass per animation frame instead of one pass per mutation.
    contentObserver = new MutationObserver(() => {
      if (!isCurrentInstance() || !isExtensionContextAlive()) {
        // A newer copy of the script took over, or the extension was updated/reloaded.
        teardownContentObserver();
        return;
      }
      if (pendingEnsureFrame) return;
      pendingEnsureFrame = requestAnimationFrame(() => {
        pendingEnsureFrame = 0;
        if (!isCurrentInstance()) return;
        ensureProfileScrapeButton(document);
        if (!document.getElementById('ig-scraper-panel')) {
          ensureInPagePanel(document);
        }
      });
    });

    contentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initContentScript);
    } else {
      initContentScript();
    }
  }

  // Export functions for automated testing
  const exportedApi = {
    getPostTileContainer,
    isDomPostElementPinned,
    detectDomPostReelStatus,
    extractCountsFromDomPostTile,
    scanDomGridPosts,
    extractFollowersFromDom,
    extractDataFromEmbeddedScripts,
    fetchFromInstagramApi,
    scrapeProfileData,
    detectCurrentProfileUsername,
    findProfileUsernameElement,
    ensureProfileScrapeButton,
    handleScrapeButtonClick,
    ensureInPagePanel,
    renderInPagePanelList,
    getStoredProfiles,
    saveStoredProfiles,
    getScraperSettings,
    saveScraperSettings,
    getGoogleSheetConfig,
    upsertProfileRecord,
    updateProfilePrice,
    syncProfilesWithGoogleSheet
  };

  if (typeof window !== 'undefined') {
    window.InstaScraperContent = exportedApi;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = exportedApi;
  }
})();
