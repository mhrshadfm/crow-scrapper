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
    return updateProfileField(username, 'pricePerReel', pricePerReel);
  }

  const EDITABLE_TEXT_FIELDS = new Set(['pricePerReel', 'contactInfo']);

  /** Saves one free-text cell (Price/REEL or ID/Phone) without re-rendering the list. */
  function updateProfileField(username, field, value) {
    if (!EDITABLE_TEXT_FIELDS.has(field)) return Promise.reject(new Error(`Field "${field}" is not editable.`));
    return withStorageLock(async () => {
      const list = await getStoredProfiles();
      const key = Core.normalizeUsernameKey(username);
      const idx = list.findIndex((item) => Core.normalizeUsernameKey(item.username) === key);
      if (idx < 0) return list;
      const next = String(value === undefined || value === null ? '' : value).trim();
      if (String(list[idx][field] === undefined || list[idx][field] === null ? '' : list[idx][field]) === next) {
        return list;
      }
      list[idx] = { ...list[idx], [field]: next };
      suppressNextStorageRender = true;
      try {
        await saveStoredProfiles(list);
      } finally {
        setTimeout(() => {
          suppressNextStorageRender = false;
        }, 50);
      }
      return list;
    });
  }

  /** Replaces a stored row exactly (used after a manual edit — no merging with the old values). */
  function replaceProfileRecord(record) {
    return withStorageLock(async () => {
      const list = await getStoredProfiles();
      const key = Core.normalizeUsernameKey(record && record.username);
      if (!key) return list;
      let found = false;
      const next = list.map((item) => {
        if (Core.normalizeUsernameKey(item.username) === key) {
          found = true;
          return { ...record };
        }
        return item;
      });
      if (!found) next.push({ ...record });
      return saveStoredProfiles(next);
    });
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
    // Never treat Crow Scrapper's own UI (panel / edit dialog) as the Instagram profile header.
    const headers = Array.from(rootDoc.querySelectorAll('header')).filter(
      (h) => !h.closest('#ig-scraper-panel') && !h.closest('.crow-ed-overlay')
    );
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
  /**
   * True when `el` is actually shown inside `stopAt` (not display:none / hidden / transparent).
   * Hover overlays that Instagram keeps in the DOM but hides must not count as "visible" numbers.
   */
  function isNodeVisibleWithin(el, stopAt) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (typeof getComputedStyle === 'function') {
        const style = getComputedStyle(node);
        // (Detached nodes report empty styles — '' must not be read as opacity 0.)
        if (style.display === 'none' || style.visibility === 'hidden' ||
          (style.opacity !== '' && Number(style.opacity) === 0)) {
          return false;
        }
      }
      if (node === stopAt) break;
      node = node.parentElement;
    }
    if (el.isConnected && typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
      return false;
    }
    return true;
  }

  const COUNT_LABEL_PATTERNS = [
    { label: 'likes', re: /\blikes?\b|heart|لایک|پسند|curtid|j'aime|gefällt|me gusta|beğen/i },
    { label: 'comments', re: /comment|speech|bubble|کامنت|نظر|comentario|commentaire|kommentar|yorum/i },
    { label: 'views', re: /\bviews?\b|view count|\bplays?\b|play count|\beye\b|\breel\b|\bclip\b|بازدید|نمایش|reproducc|vues|aufrufe|görüntülen/i }
  ];

  /** Labels a count by the icon next to it (svg aria-label / <title>, aria-label or sprite class). */
  function describeCountLabel(el, tileEl) {
    const scopes = [el.parentElement, el.parentElement && el.parentElement.parentElement];
    for (const scope of scopes) {
      if (!scope || (tileEl && !tileEl.contains(scope)) || scope === tileEl) break;
      // Stop widening once the scope also holds ANOTHER count: its icon may belong to that one
      // (e.g. the heart next to the likes must not label the comment count).
      const holdsOtherCount = Array.from(scope.querySelectorAll('span, div')).some(
        (n) => n !== el && !n.contains(el) && !el.contains(n) && STANDALONE_COUNT_REGEX.test(getNonSvgCleanText(n))
      );
      if (holdsOtherCount) break;
      const hints = [];
      const iconEls = Array.from(scope.querySelectorAll('svg, [aria-label], [class*="prite"], [class*="icon" i]'))
        .filter((n) => n !== el && !n.contains(el));
      // A scope with icons for several different counts (e.g. the whole overlay) is ambiguous.
      const svgCount = scope.querySelectorAll('svg').length;
      if (svgCount > 1) continue;
      for (const n of iconEls) {
        hints.push(n.getAttribute('aria-label') || '');
        const t = n.querySelector ? n.querySelector('title') : null;
        if (t) hints.push(t.textContent || '');
        if (typeof n.className === 'string') hints.push(n.className);
      }
      const text = hints.join(' ');
      if (!text.trim()) continue;
      for (const { label, re } of COUNT_LABEL_PATTERNS) {
        if (re.test(text)) return label;
      }
    }
    return '';
  }

  /** Visible standalone numbers inside a tile, in DOM order, with their icon labels. */
  function readTileNumbers(tileEl) {
    if (!tileEl) return [];
    return extractStandaloneNumericNodes(tileEl, (el) => !el.closest('#ig-scraper-panel'))
      .filter((n) => isNodeVisibleWithin(n.el, tileEl))
      .map((n) => ({
        el: n.el,
        text: n.text,
        value: Core.parseCount(n.text),
        written: Core.roundToWrittenCount(n.text),
        label: describeCountLabel(n.el, tileEl)
      }))
      .filter((n) => n.value > 0 || /\d/.test(n.text));
  }

  /**
   * Works out views / likes / comments for a reel tile from what is visible BEFORE and AFTER
   * hovering it. This does not depend on Instagram's (changing) markup:
   * - before hovering, the only number on a reel tile is its view badge (👁 255K);
   * - hovering adds the likes and comments;
   * - on a reel, views are always the largest number (a reel can't have more likes than plays);
   * - an icon label next to a number (eye / heart / comment bubble), when present, wins.
   */
  function resolveTileCountsFromHover(pre, post) {
    const preList = Array.isArray(pre) ? pre : [];
    const postList = Array.isArray(post) && post.length > 0 ? post : preList;
    const result = { views: 0, likes: 0, comments: 0, hasViews: false, hasCounts: false };
    if (postList.length === 0) return result;

    const sameNode = (a, b) => a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el);
    const added = postList.filter((n) => !preList.some((p) => sameNode(p, n)));
    const labeled = (label) => postList.find((n) => n.label === label) || preList.find((n) => n.label === label);

    // Views
    let viewsNode = labeled('views');
    if (!viewsNode && preList.length === 1) viewsNode = preList[0];
    if (!viewsNode && postList.length >= 3) {
      viewsNode = postList.slice().sort((a, b) => b.written - a.written)[0];
    }
    if (viewsNode) {
      result.views = viewsNode.written;
      result.hasViews = result.views > 0;
    }

    // Likes & comments: labeled first, then the remaining numbers in DOM order (likes come first).
    const rest = (added.length > 0 ? added : postList).filter(
      (n) => !(viewsNode && sameNode(n, viewsNode)) && n.label !== 'views'
    );
    // A label that matches more than one number is ambiguous — fall back to DOM order for those.
    const uniqueLabel = (label) => rest.filter((n) => n.label === label).length === 1;
    const likesNode = uniqueLabel('likes') ? rest.find((n) => n.label === 'likes') : undefined;
    const commentsNode = uniqueLabel('comments') ? rest.find((n) => n.label === 'comments') : undefined;
    const unlabeled = rest.filter((n) => n !== likesNode && n !== commentsNode);
    const likesPick = likesNode || unlabeled.shift();
    const commentsPick = commentsNode || unlabeled.find((n) => n !== likesPick);
    if (likesPick) result.likes = likesPick.value;
    if (commentsPick) result.comments = commentsPick.value;
    result.hasCounts = Boolean(likesPick || commentsPick);

    // A reel can't have more likes than plays: if the view number came from position only
    // (no icon label) and it's smaller than the likes, the biggest number is the real view count.
    if (result.views > 0 && result.likes > result.views && !(viewsNode && viewsNode.label === 'views')) {
      const biggest = postList.slice().sort((a, b) => b.written - a.written)[0];
      if (biggest && biggest.written > result.likes) {
        result.views = biggest.written;
      } else {
        result.views = 0;
        result.hasViews = false;
      }
    }
    return result;
  }

  async function hoverTile(el) {
    const targets = [el, el.firstElementChild].filter(Boolean);
    try {
      for (const t of targets) {
        if (typeof PointerEvent === 'function') {
          t.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
          t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        }
        t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }
    } catch (_err) {
      // ignore synthetic event errors
    }
    await new Promise((r) => setTimeout(r, 90));
    return () => {
      try {
        for (const t of targets) {
          if (typeof PointerEvent === 'function') {
            t.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
          }
          t.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          t.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        }
      } catch (_err) {
        // ignore
      }
    };
  }

  /**
   * Reads the view badge of every tile currently in the grid: the one number a reel tile shows
   * WITHOUT hovering (or a number next to an eye / play icon). Tiles showing several numbers
   * (an open hover overlay) are skipped instead of guessed.
   */
  function readViewBadges(rootDoc = document) {
    const { postElements, domPinnedShortcodes } = scanDomGridPosts(rootDoc);
    const domPosts = [];
    postElements.forEach((p, index) => {
      const tile = getPostTileContainer(p.el) || p.el;
      const nums = readTileNumbers(tile);
      const labeled = nums.filter((n) => n.label === 'views');
      const badge = labeled.length === 1 ? labeled[0] : nums.length === 1 ? nums[0] : null;
      if (badge && badge.written > 0) {
        domPosts.push({
          shortcode: p.shortcode,
          views: badge.written,
          likes: 0,
          comments: 0,
          isPinned: p.isPinned,
          isReel: true,
          hasViews: true,
          index
        });
      }
    });
    return { domPosts, domPinnedShortcodes };
  }

  /**
   * After clicking the profile's Reels tab, waits (up to `timeoutMs`) until the reels we need show
   * their view badge. Instagram loads that tab asynchronously; the old fixed 0.8 s wait often read
   * the previous grid (or nothing).
   */
  async function waitForReelViewBadges(rootDoc, wantedCodes, timeoutMs = 6000) {
    const wanted = new Set(Array.from(wantedCodes || []).filter(Boolean));
    const deadline = Date.now() + timeoutMs;
    let best = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const badges = readViewBadges(rootDoc);
      if (badges.domPosts.length > 0 && (!best || badges.domPosts.length >= best.domPosts.length)) {
        best = badges;
      }
      if (badges.domPosts.length > 0) {
        const have = new Set(badges.domPosts.map((d) => d.shortcode));
        if (wanted.size === 0 || Array.from(wanted).every((c) => have.has(c))) {
          return badges;
        }
      }
    }
    return best;
  }

  async function populateDomPostCountsViaHover(postElements, maxCount = Core.RECENT_POSTS_LIMIT + 1) {
    const hasNonPinnedReels = postElements.some((p) => !p.isPinned && p.isReel === true);
    const nonPinnedTargets = postElements
      .filter((p) => !p.isPinned && (hasNonPinnedReels ? p.isReel === true : !p.isExplicitNonReel))
      .slice(0, maxCount);
    const results = [];

    for (const item of nonPinnedTargets) {
      const tile = getPostTileContainer(item.el) || item.el;
      const initialCounts = extractCountsFromDomPostTile(item.el);
      const pre = readTileNumbers(tile);

      // Always hover reels: their likes & comments only exist in the hover overlay, and reading
      // them without the before/after comparison is what mixed up views and comments.
      let counts = initialCounts;
      let post = pre;
      if (!counts.hasCounts || item.isReel || initialCounts.hasViews || pre.length === 1) {
        const unhover = await hoverTile(item.el);
        post = readTileNumbers(tile);
        counts = extractCountsFromDomPostTile(item.el);
        unhover();
      }

      const diff = resolveTileCountsFromHover(pre, post);
      const legacyViews = Math.max(counts.views || 0, initialCounts.views || 0);
      const legacyLikes = counts.likes || initialCounts.likes || 0;
      const legacyComments = counts.comments || initialCounts.comments || 0;

      // When the tile's numbers could be read, the before/after comparison is authoritative —
      // including "views unknown" (e.g. the Posts grid never shows a reel's views). Falling back
      // to the layout guess there is what turned the comment count into the view count.
      const readable = pre.length > 0 || post.length > 0;
      const views = readable ? diff.views : legacyViews;
      const likes = readable && diff.hasCounts ? diff.likes : legacyLikes;
      const comments = readable && diff.hasCounts ? diff.comments : legacyComments;
      const hasViews = readable
        ? views > 0
        : Boolean(views > 0 || counts.hasViews || initialCounts.hasViews);
      results.push({
        shortcode: item.shortcode,
        views,
        likes,
        comments,
        isPinned: false,
        isReel: Boolean(item.isReel || hasViews),
        isExplicitNonReel: Boolean(item.isExplicitNonReel),
        hasViews
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
  // Why the last Instagram API attempt failed (shown in the ⚠ reasons of tile-based rows).
  let lastApiFailure = '';

  function describeApiFailure(status) {
    if (status === 429) return 'Instagram API said "too many requests" (HTTP 429) — wait a few minutes, then re-scrape';
    if (status === 401 || status === 403) return `Instagram API refused the request (HTTP ${status}) — make sure you are logged in, then re-scrape`;
    if (status === 404) return 'Instagram API did not find this profile (HTTP 404)';
    if (status) return `Instagram API answered HTTP ${status}`;
    return 'Instagram API could not be reached';
  }

  async function fetchFromInstagramApi(username, domPinnedShortcodes) {
    lastApiFailure = '';
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
        cache: 'no-store',
        headers
      });

      if (response && !response.ok) {
        lastApiFailure = describeApiFailure(response.status);
      }
      if (response && response.ok) {
        const json = await response.json();
        const user = json && json.data && json.data.user;
        if (!user) {
          lastApiFailure = 'Instagram API returned no profile data (login may be required)';
        }
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
      lastApiFailure = describeApiFailure(0);
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
          cache: 'no-store',
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
          cache: 'no-store',
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
    if (posts.length === 0 && !lastApiFailure) {
      lastApiFailure = 'Instagram API returned the profile but none of its reels';
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
            const wantedCodes = selectedBeforeTab
              .filter((p) => p.isReel && !p.hasReliableViews)
              .map((p) => p.shortcode);
            const badges = await waitForReelViewBadges(rootDoc, wantedCodes);
            if (badges) {
              domPosts = badges.domPosts;
              for (const code of badges.domPinnedShortcodes) {
                domPinnedShortcodes.add(code);
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
        excludeMostRecent,
        dataSource: apiData && apiData.posts.length > 0 ? 'api' : 'page'
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
          const wantedCodes = domSelected.filter((p) => !p.hasReliableViews).map((p) => p.shortcode);
          const badges = await waitForReelViewBadges(rootDoc, wantedCodes);
          if (badges) {
            for (const code of badges.domPinnedShortcodes) {
              domPinnedShortcodes.add(code);
            }
            finalDomPosts = mergePostLists(finalDomPosts, [], badges.domPosts, domPinnedShortcodes);
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
      excludeMostRecent,
      dataSource: 'tiles',
      apiNote: lastApiFailure
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

  let statusHideTimer = 0;
  function showPanelStatus(message, type, rootDoc = document) {
    const statusEl = rootDoc.getElementById('ig-scraper-panel-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `ig-scraper-panel-status ${type}`;
    clearTimeout(statusHideTimer);
    if (type === 'success' || type === 'info') {
      statusHideTimer = setTimeout(() => {
        statusEl.className = 'ig-scraper-panel-status hidden';
      }, 7000);
    }
  }

  function reportScrapeQuality(metrics, rootDoc = document) {
    const q = Core.assessProfileQuality(metrics);
    if (q.level === 'warn') {
      showPanelStatus(
        `⚠ @${metrics.username} may be mis-scraped: ${q.issues[0]} Use ✎ to fix it or ↻ to re-scrape fresh.`,
        'warn',
        rootDoc
      );
    } else {
      showPanelStatus(
        `✓ @${metrics.username} scraped — ER ${metrics.erFormatted} · V.R. ${metrics.vrFormatted} (${metrics.postsAnalyzed} reels)`,
        'success',
        rootDoc
      );
    }
  }

  function markHighlight(username) {
    panelState.highlight = username;
    clearTimeout(panelState.highlightTimer);
    panelState.highlightTimer = setTimeout(() => {
      panelState.highlight = '';
    }, 6000);
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
      markHighlight(metrics.username);
      await renderInPagePanelList(updatedList, rootDoc);
      showPanelExpanded(true, rootDoc);
      reportScrapeQuality(metrics, rootDoc);

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
  // In-Page Panel — top launcher icon + expandable list (v1.2.0)
  // ============================================================================

  function getVrBadgeClass(band) {
    const b = String(band || '').toLowerCase();
    if (b === 'very high') return 'crow-badge-vhigh';
    if (b === 'high') return 'crow-badge-high';
    if (b === 'medium') return 'crow-badge-med';
    if (b === 'low') return 'crow-badge-low';
    return 'crow-badge-vlow';
  }

  function describeSheetSyncResult(res) {
    const dupRemoved = Number(res && res.duplicateRowsRemoved) || 0;
    const dupFound = Number(res && res.duplicateRowsFound) || 0;
    if (dupRemoved > 0) return `${dupRemoved} duplicate row(s) removed`;
    if (dupFound > 0) return `${dupFound} duplicate row(s) already in the sheet — delete them manually`;
    return 'no duplicates';
  }

  // --------------------------------------------------------------------------
  // Panel state & preferences
  // --------------------------------------------------------------------------

  const PANEL_PREFS_KEY = 'crow_panel_prefs';
  const PENDING_RESCRAPE_KEY = 'crow_pending_rescrape';
  const LAUNCHER_SIZE = 46;

  const panelState = {
    profiles: [],
    query: '',
    sort: 'recent',
    highlight: '',
    highlightTimer: 0,
    deferredList: null,
    expandedTouched: false,
    // width / height: 0 = automatic size; otherwise the size the user dragged the window to.
    prefs: { top: 16, right: 20, expanded: false, sort: 'recent', width: 0, height: 0 }
  };

  async function loadPanelPrefs() {
    try {
      let saved;
      if (hasChromeStorage()) {
        const res = await chromeStorageGet([PANEL_PREFS_KEY]);
        saved = res[PANEL_PREFS_KEY];
      } else {
        saved = readLocalStorageJson(PANEL_PREFS_KEY, null);
      }
      if (saved && typeof saved === 'object') {
        panelState.prefs = { ...panelState.prefs, ...saved };
      }
    } catch (_err) {
      // keep defaults
    }
    return panelState.prefs;
  }

  let prefsSaveTimer = 0;
  function savePanelPrefs() {
    clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(() => {
      const prefs = { ...panelState.prefs };
      if (hasChromeStorage()) {
        chromeStorageSet({ [PANEL_PREFS_KEY]: prefs }).catch(() => {});
      } else {
        writeLocalStorageJson(PANEL_PREFS_KEY, prefs);
      }
    }, 250);
  }

  async function getPendingRescrape() {
    if (hasChromeStorage()) {
      const res = await chromeStorageGet([PENDING_RESCRAPE_KEY]);
      return res[PENDING_RESCRAPE_KEY] || null;
    }
    return readLocalStorageJson(PENDING_RESCRAPE_KEY, null);
  }

  async function setPendingRescrape(value) {
    if (hasChromeStorage()) {
      await chromeStorageSet({ [PENDING_RESCRAPE_KEY]: value });
    } else {
      writeLocalStorageJson(PENDING_RESCRAPE_KEY, value);
    }
  }

  function clearPendingRescrape() {
    return setPendingRescrape(null).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------------------

  const AVATAR_GRADIENTS = [
    ['#8b5cf6', '#ec4899'],
    ['#6366f1', '#22d3ee'],
    ['#f59e0b', '#ef4444'],
    ['#10b981', '#3b82f6'],
    ['#ec4899', '#f97316'],
    ['#14b8a6', '#8b5cf6']
  ];

  function avatarStyleFor(username) {
    let hash = 0;
    const s = String(username || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const [a, b] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
    return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
  }

  function timeAgo(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  function sourceLabel(source) {
    if (source === 'api') return 'API';
    if (source === 'page') return 'page data';
    if (source === 'tiles') return 'page tiles';
    return '';
  }

  function qualityOf(item) {
    try {
      return Core.assessProfileQuality(item);
    } catch (_err) {
      return { level: 'ok', issues: [] };
    }
  }

  function sortProfiles(list, sortKey) {
    const arr = list.slice();
    const ts = (p) => Date.parse(p.editedAt || p.scrapedAt || '') || 0;
    switch (sortKey) {
      case 'followers':
        return arr.sort((a, b) => (Number(b.followers) || 0) - (Number(a.followers) || 0));
      case 'er':
        return arr.sort((a, b) => (Number(b.er) || 0) - (Number(a.er) || 0));
      case 'vr':
        return arr.sort((a, b) => (Number(b.vr) || 0) - (Number(a.vr) || 0));
      case 'name':
        return arr.sort((a, b) => String(a.username).localeCompare(String(b.username)));
      case 'check':
        return arr.sort((a, b) => {
          const qa = qualityOf(a).level === 'warn' ? 0 : 1;
          const qb = qualityOf(b).level === 'warn' ? 0 : 1;
          return qa - qb || ts(b) - ts(a);
        });
      case 'recent':
      default:
        return arr.sort((a, b) => ts(b) - ts(a));
    }
  }

  function filterProfiles(list, query) {
    const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
    if (!q) return list;
    return list.filter((p) =>
      String(p.username || '').toLowerCase().includes(q) ||
      String(p.contactInfo || '').toLowerCase().includes(q) ||
      String(p.pricePerReel || '').toLowerCase().includes(q)
    );
  }

  // --------------------------------------------------------------------------
  // Toast
  // --------------------------------------------------------------------------

  let toastTimer = 0;
  function showToast(message, type = 'info', rootDoc = document) {
    // While the list is open, use its status line instead of covering the header buttons.
    if (isPanelExpanded(rootDoc)) {
      showPanelStatus(message, type, rootDoc);
      return;
    }
    const toast = rootDoc.getElementById('crow-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `crow-toast crow-toast-${type}`;
    toast.hidden = false;
    positionFloatingParts(rootDoc);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, type === 'error' ? 7000 : 4200);
  }

  // --------------------------------------------------------------------------
  // Positioning (launcher icon is draggable; the card opens next to it)
  // --------------------------------------------------------------------------

  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), Math.max(min, max));
  }

  function applyLauncherPosition(rootDoc = document) {
    const panel = rootDoc.getElementById('ig-scraper-panel');
    if (!panel) return;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const prefs = panelState.prefs;
    prefs.top = clamp(Number(prefs.top) || 16, 8, vh - LAUNCHER_SIZE - 8);
    prefs.right = clamp(Number(prefs.right) || 20, 8, vw - LAUNCHER_SIZE - 8);
    panel.style.top = `${prefs.top}px`;
    panel.style.right = `${prefs.right}px`;
    positionFloatingParts(rootDoc);
  }

  const CARD_MIN_WIDTH = 420;
  const CARD_MIN_HEIGHT = 220;
  const CARD_DEFAULT_MAX_WIDTH = 1280;
  const CARD_EDGE = 12;
  const CARD_GAP = 10;
  const CARD_NARROW_WIDTH = 760;

  /**
   * Where the list window goes, given the launcher icon's rect. The window hangs off the icon
   * (below it, or above it when the icon sits low) and lines up with the icon's right edge when
   * the icon is on the right half of the screen, its left edge otherwise. A saved width/height
   * (from dragging the window's edge) is kept within the screen.
   */
  function computeCardGeometry(rect, vw, vh, prefs) {
    const openUp = rect.top > vh * 0.55;
    const anchorRight = rect.left + rect.width / 2 >= vw / 2;
    const maxWidth = Math.max(240, vw - CARD_EDGE * 2);
    const minWidth = Math.min(CARD_MIN_WIDTH, maxWidth);
    const savedWidth = Number(prefs && prefs.width) || 0;
    const width = Math.round(savedWidth > 0
      ? clamp(savedWidth, minWidth, maxWidth)
      : Math.min(CARD_DEFAULT_MAX_WIDTH, maxWidth));
    const left = Math.round(anchorRight
      ? clamp(rect.right - width, CARD_EDGE, vw - width - CARD_EDGE)
      : clamp(rect.left, CARD_EDGE, vw - width - CARD_EDGE));
    const room = openUp ? rect.top - CARD_GAP - 16 : vh - rect.bottom - CARD_GAP - 16;
    const maxHeight = Math.max(260, Math.round(room));
    const savedHeight = Number(prefs && prefs.height) || 0;
    const height = savedHeight > 0
      ? Math.round(clamp(savedHeight, Math.min(CARD_MIN_HEIGHT, maxHeight), maxHeight))
      : 0;
    return {
      openUp,
      anchorRight,
      width,
      left,
      height,
      maxHeight,
      top: openUp ? null : Math.round(rect.bottom + CARD_GAP),
      bottom: openUp ? Math.round(vh - rect.top + CARD_GAP) : null
    };
  }

  function positionFloatingParts(rootDoc = document) {
    const launcher = rootDoc.getElementById('crow-launcher');
    if (!launcher || typeof launcher.getBoundingClientRect !== 'function') return;
    const rect = launcher.getBoundingClientRect();
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const geo = computeCardGeometry(rect, vw, vh, panelState.prefs);
    const openUp = geo.openUp;
    const gap = CARD_GAP;

    const card = rootDoc.getElementById('ig-scraper-panel-body');
    if (card) {
      card.style.width = `${geo.width}px`;
      card.style.left = `${geo.left}px`;
      card.style.maxHeight = `${geo.maxHeight}px`;
      card.style.height = geo.height ? `${geo.height}px` : '';
      if (openUp) {
        card.style.top = 'auto';
        card.style.bottom = `${geo.bottom}px`;
      } else {
        card.style.bottom = 'auto';
        card.style.top = `${geo.top}px`;
      }
      card.classList.toggle('crow-card-up', openUp);
      card.classList.toggle('crow-anchor-left', !geo.anchorRight);
      card.classList.toggle('crow-card-sized', Boolean(geo.height));
      card.classList.toggle('crow-card-narrow', geo.width < CARD_NARROW_WIDTH);
    }

    const toast = rootDoc.getElementById('crow-toast');
    if (toast) {
      if (geo.anchorRight) {
        toast.style.left = 'auto';
        toast.style.right = `${Math.round(vw - rect.right)}px`;
      } else {
        toast.style.right = 'auto';
        toast.style.left = `${Math.round(rect.left)}px`;
      }
      if (openUp) {
        toast.style.top = 'auto';
        toast.style.bottom = `${Math.round(vh - rect.top + gap)}px`;
      } else {
        toast.style.bottom = 'auto';
        toast.style.top = `${Math.round(rect.bottom + gap)}px`;
      }
    }
  }

  function isPanelExpanded(rootDoc = document) {
    const panel = rootDoc.getElementById('ig-scraper-panel');
    return Boolean(panel && !panel.classList.contains('ig-scraper-panel-collapsed'));
  }

  function showPanelExpanded(expanded, rootDoc = document, options = undefined) {
    const panel = rootDoc.getElementById('ig-scraper-panel');
    if (!panel) return;
    const opts = options || {};
    if (!opts.fromPrefs) panelState.expandedTouched = true;
    panel.classList.toggle('ig-scraper-panel-collapsed', !expanded);
    const launcher = rootDoc.getElementById('crow-launcher');
    if (launcher) {
      launcher.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      launcher.title = expanded
        ? 'Minimize Crow Scrapper (drag to move)'
        : 'Open Crow Scrapper list (drag to move)';
    }
    if (expanded) {
      const toast = rootDoc.getElementById('crow-toast');
      if (toast) toast.hidden = true;
      positionFloatingParts(rootDoc);
    }
    if (!opts.fromPrefs && panelState.prefs.expanded !== Boolean(expanded)) {
      panelState.prefs.expanded = Boolean(expanded);
      savePanelPrefs();
    }
  }

  function bindLauncherDrag(launcher, rootDoc) {
    let start = null;
    let dragged = false;
    let suppressClick = false;

    launcher.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, top: panelState.prefs.top, right: panelState.prefs.right };
      dragged = false;
      try {
        launcher.setPointerCapture(e.pointerId);
      } catch (_err) {
        // ignore
      }
    });
    launcher.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      dragged = true;
      launcher.classList.add('crow-launcher-dragging');
      panelState.prefs.top = start.top + dy;
      panelState.prefs.right = start.right - dx;
      applyLauncherPosition(rootDoc);
    });
    const finish = () => {
      if (!start) return;
      start = null;
      launcher.classList.remove('crow-launcher-dragging');
      if (dragged) {
        suppressClick = true;
        savePanelPrefs();
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
    };
    launcher.addEventListener('pointerup', finish);
    launcher.addEventListener('pointercancel', finish);
    launcher.addEventListener('click', (e) => {
      e.preventDefault();
      if (suppressClick) return;
      showPanelExpanded(!isPanelExpanded(rootDoc), rootDoc);
    });
  }

  /** Set the list window's size (px; 0 = automatic) and remember it. */
  function setPanelSize(size, rootDoc = document) {
    const s = size || {};
    if (s.width !== undefined) panelState.prefs.width = Math.max(0, Math.round(Number(s.width) || 0));
    if (s.height !== undefined) panelState.prefs.height = Math.max(0, Math.round(Number(s.height) || 0));
    positionFloatingParts(rootDoc);
    savePanelPrefs();
  }

  /** Go back to the automatic size (both directions, or just 'x' / 'y'). */
  function resetPanelSize(rootDoc = document, axis = 'xy') {
    const size = {};
    if (axis.includes('x')) size.width = 0;
    if (axis.includes('y')) size.height = 0;
    setPanelSize(size, rootDoc);
  }

  const RESIZE_KEY_STEP = 24;

  function bindCardResize(card, rootDoc) {
    const handles = card.querySelectorAll('[data-resize]');
    handles.forEach((handle) => {
      const axis = handle.getAttribute('data-resize') || 'xy';
      let drag = null;

      // Dragging away from the icon makes the window bigger, whichever side the icon is on.
      const signs = () => ({
        x: card.classList.contains('crow-anchor-left') ? 1 : -1,
        y: card.classList.contains('crow-card-up') ? -1 : 1
      });

      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const s = signs();
        drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, signX: s.x, signY: s.y };
        card.classList.add('crow-card-resizing');
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (_err) {
          // ignore
        }
      });
      handle.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (axis.includes('x')) panelState.prefs.width = Math.round(drag.w + drag.signX * (e.clientX - drag.x));
        if (axis.includes('y')) panelState.prefs.height = Math.round(drag.h + drag.signY * (e.clientY - drag.y));
        positionFloatingParts(rootDoc);
      });
      const finish = () => {
        if (!drag) return;
        drag = null;
        card.classList.remove('crow-card-resizing');
        // Remember the size actually shown (dragging past the screen edge is clamped).
        if (axis.includes('x')) panelState.prefs.width = Math.round(parseFloat(card.style.width) || 0);
        if (axis.includes('y')) panelState.prefs.height = Math.round(parseFloat(card.style.height) || 0);
        savePanelPrefs();
      };
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);
      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        resetPanelSize(rootDoc, axis);
      });
      handle.addEventListener('keydown', (e) => {
        const { x: signX, y: signY } = signs();
        const r = card.getBoundingClientRect();
        const size = {};
        if (axis.includes('x') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          size.width = Math.round(r.width + signX * dir * RESIZE_KEY_STEP);
        } else if (axis.includes('y') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          size.height = Math.round(r.height + signY * dir * RESIZE_KEY_STEP);
        } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Home') {
          resetPanelSize(rootDoc, axis);
          e.preventDefault();
          return;
        } else {
          return;
        }
        e.preventDefault();
        setPanelSize(size, rootDoc);
        // Store what is shown, so a later arrow press continues from the clamped size.
        if (size.width !== undefined) panelState.prefs.width = Math.round(parseFloat(card.style.width) || 0);
        if (size.height !== undefined) panelState.prefs.height = Math.round(parseFloat(card.style.height) || 0);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Panel DOM
  // --------------------------------------------------------------------------

  const SEARCH_ICON_SVG =
    '<svg class="crow-search-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.3-2.2L21 21"/></svg>';

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
      <button type="button" class="crow-launcher" id="crow-launcher" aria-expanded="${keepExpanded ? 'true' : 'false'}" aria-controls="ig-scraper-panel-body" title="Open Crow Scrapper list (drag to move)">
        ${renderCrowLogoImg('crow-launcher-logo')}
        <span class="crow-launcher-badge" id="crow-launcher-badge">0</span>
      </button>
      <section class="crow-card" id="ig-scraper-panel-body" role="region" aria-label="Crow Scrapper list">
        <div class="crow-card-head" id="ig-scraper-panel-toggle">
          <div class="crow-brand">
            <span class="ig-scraper-logo-badge">${renderCrowLogoImg('ig-scraper-panel-crow')}</span>
            <div class="crow-brand-text">
              <div class="crow-brand-row">
                <span class="ig-scraper-brand-name">Crow Scrapper</span>
                <span class="ig-scraper-badge" id="ig-scraper-count-badge" title="Profiles in your list">0</span>
              </div>
              <a href="https://www.instagram.com/mhrshadfm/" target="_blank" rel="noopener noreferrer" class="ig-scraper-owner-pill" title="Created &amp; Owned by @mhrshadfm">by @mhrshadfm</a>
            </div>
          </div>
          <div class="crow-head-actions">
            <button type="button" class="crow-btn crow-btn-sheet" id="ig-scraper-sync-sheet" title="Sync the list to your Shared Google Sheet (no duplicates)">
              <span aria-hidden="true">☁</span> Sync Sheet
            </button>
            <div class="crow-seg" role="group" aria-label="Export">
              <button type="button" class="crow-btn" id="ig-scraper-dl-xlsx" title="Download Excel (.xlsx) with clickable usernames">Excel</button>
              <button type="button" class="crow-btn" id="ig-scraper-dl-csv" title="Download CSV (.csv)">CSV</button>
            </div>
            <button type="button" class="crow-icon-btn" id="ig-scraper-expand-btn" title="Minimize to icon (Esc)" aria-label="Minimize to icon">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 12h12"/></svg>
            </button>
          </div>
        </div>

        <div class="crow-toolbar">
          <label class="crow-search">
            ${SEARCH_ICON_SVG}
            <input type="search" id="crow-search" placeholder="Search username, ID or phone" autocomplete="off" spellcheck="false" />
          </label>
          <label class="crow-select-wrap" title="Sort the list">
            <select id="crow-sort" aria-label="Sort">
              <option value="recent">Newest first</option>
              <option value="check">Needs a check first</option>
              <option value="followers">Followers</option>
              <option value="er">ER</option>
              <option value="vr">V.R.</option>
              <option value="name">Username A–Z</option>
            </select>
          </label>
          <label class="crow-switch" title="Also skip the #1 newest post/reel (besides pinned posts)">
            <input type="checkbox" id="ig-scraper-skip-recent" />
            <span class="crow-switch-track" aria-hidden="true"></span>
            <span class="crow-switch-label">Skip newest reel</span>
          </label>
          <button type="button" class="crow-chip-btn" id="crow-info-btn" aria-expanded="false" aria-controls="crow-legend">ⓘ Benchmarks</button>
        </div>

        <div class="crow-legend" id="crow-legend" hidden>
          <div><strong>V.R. bands</strong> Very low ≤10% · Low 10–15% · Medium 15–30% · High 30–50% · Very high ≥50%</div>
          <div><strong>E.R. benchmarks</strong> ≤1K: 8% · 1K–5K: 5.7% · 5K–10K: 4% · 10K–100K: 2.4% · ≥100K: 1.7%</div>
          <div class="crow-legend-note">Uses the 6 most recent non-pinned Reels. Rows marked ⚠ look mis-scraped — open ✎ to fix them or ↻ to re-scrape fresh.</div>
          <div class="crow-legend-note">Drag this window's edge or corner to resize it — double-click the edge to go back to the automatic size.</div>
        </div>

        <div id="ig-scraper-panel-status" class="ig-scraper-panel-status hidden"></div>

        <div class="ig-scraper-table-wrap crow-table-wrap">
          <table class="ig-scraper-table crow-table" id="ig-scraper-table">
            <thead>
              <tr>
                <th class="col-username">USERNAME</th>
                <th class="col-num">Follower</th>
                <th class="col-num">ER</th>
                <th class="col-num">V.R.</th>
                <th class="col-num">AV VIEW</th>
                <th class="col-num">AV LIKE</th>
                <th class="col-num">AV COMMENTS</th>
                <th class="col-num">LIKES PER COMMENT</th>
                <th class="col-price">Price/REEL</th>
                <th class="col-contact">ID/Phone</th>
                <th class="col-actions"><span class="crow-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody id="ig-scraper-tbody"></tbody>
          </table>
        </div>

        <div class="ig-scraper-panel-footer crow-card-foot">
          <span class="ig-scraper-footer-owner">Crow Scrapper · Owner: <a href="https://www.instagram.com/mhrshadfm/" target="_blank" rel="noopener noreferrer" class="ig-scraper-footer-owner-link">@mhrshadfm</a></span>
          <span class="crow-foot-summary" id="crow-foot-summary"></span>
          <button type="button" class="crow-btn crow-btn-danger ig-scraper-clear-btn" id="ig-scraper-clear-btn">Clear List</button>
        </div>
        <div class="crow-resize crow-resize-x" data-resize="x" role="separator" aria-orientation="vertical" aria-label="Resize width (arrow keys; Enter resets)" title="Drag to change the width · double-click to reset" tabindex="0"></div>
        <div class="crow-resize crow-resize-y" data-resize="y" role="separator" aria-orientation="horizontal" aria-label="Resize height (arrow keys; Enter resets)" title="Drag to change the height · double-click to reset" tabindex="0"></div>
        <div class="crow-resize crow-resize-xy" data-resize="xy" aria-label="Resize window" title="Drag to resize · double-click to reset the size" tabindex="-1">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M11 4 4 11M11 8 8 11"/></svg>
        </div>
      </section>
      <div class="crow-toast" id="crow-toast" role="status" aria-live="polite" hidden></div>
    `;

    rootDoc.body.appendChild(panel);
    bindCrowLogoFallback(panel);

    // Keep Instagram's document-level shortcuts & SPA click handlers away from the panel.
    ['click', 'keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'wheel'].forEach((type) => {
      panel.addEventListener(type, (e) => {
        if (type === 'keydown' && e.key === 'Escape' && isPanelExpanded(rootDoc)) {
          const active = rootDoc.activeElement;
          if (active && active.id === 'crow-search' && active.value) {
            active.value = '';
            panelState.query = '';
            renderPanelRows(rootDoc);
          } else {
            showPanelExpanded(false, rootDoc);
            const launcher = rootDoc.getElementById('crow-launcher');
            if (launcher) launcher.focus();
          }
        }
        e.stopPropagation();
      });
    });

    const launcher = panel.querySelector('#crow-launcher');
    bindLauncherDrag(launcher, rootDoc);
    bindCardResize(panel.querySelector('#ig-scraper-panel-body'), rootDoc);

    panel.querySelector('#ig-scraper-expand-btn').addEventListener('click', () => {
      showPanelExpanded(false, rootDoc);
    });

    const skipCheckbox = panel.querySelector('#ig-scraper-skip-recent');
    getScraperSettings()
      .then((s) => {
        skipCheckbox.checked = Boolean(s && s.excludeMostRecent);
      })
      .catch(() => {});
    skipCheckbox.addEventListener('change', async () => {
      try {
        await saveScraperSettings({ excludeMostRecent: skipCheckbox.checked });
        showToast(
          skipCheckbox.checked
            ? 'The newest reel will also be skipped on the next scrape.'
            : 'The newest reel will be included again.',
          'info',
          rootDoc
        );
      } catch (err) {
        showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      }
    });

    const infoBtn = panel.querySelector('#crow-info-btn');
    const legend = panel.querySelector('#crow-legend');
    infoBtn.addEventListener('click', () => {
      legend.hidden = !legend.hidden;
      infoBtn.setAttribute('aria-expanded', legend.hidden ? 'false' : 'true');
    });

    const search = panel.querySelector('#crow-search');
    search.addEventListener('input', () => {
      panelState.query = search.value;
      renderPanelRows(rootDoc);
    });

    const sortSel = panel.querySelector('#crow-sort');
    sortSel.addEventListener('change', () => {
      panelState.sort = sortSel.value;
      panelState.prefs.sort = sortSel.value;
      savePanelPrefs();
      renderPanelRows(rootDoc);
    });

    panel.querySelector('#ig-scraper-sync-sheet').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      showPanelStatus('Syncing the list to your Google Sheet…', 'info', rootDoc);
      try {
        const res = await syncProfilesWithGoogleSheet();
        if (res && res.ok) {
          showPanelStatus(
            `Synced to Google Sheet — ${res.updatedCount || 0} updated, ${res.appendedCount || 0} added, ${describeSheetSyncResult(res)}.`,
            'success',
            rootDoc
          );
        } else {
          showPanelStatus((res && res.error) || 'Configure your Shared Google Sheet in the extension popup first.', 'error', rootDoc);
        }
      } finally {
        btn.disabled = false;
      }
    });

    const exportHandler = (fn) => async () => {
      try {
        await fn();
      } catch (err) {
        showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      }
    };
    panel.querySelector('#ig-scraper-dl-xlsx').addEventListener('click', exportHandler(downloadExcelFile));
    panel.querySelector('#ig-scraper-dl-csv').addEventListener('click', exportHandler(downloadCsvFile));

    panel.querySelector('#ig-scraper-clear-btn').addEventListener('click', async () => {
      const count = panelState.profiles.length;
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

    // Row actions (delegated)
    const tbody = panel.querySelector('#ig-scraper-tbody');
    tbody.addEventListener('click', (e) => {
      const target = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-action]') : null;
      if (!target) return;
      const username = target.getAttribute('data-username') || '';
      const action = target.getAttribute('data-action');
      if (action === 'edit' || action === 'check') {
        openProfileEditor(username, rootDoc);
      } else if (action === 'rescrape') {
        requestFreshRescrape(username, rootDoc);
      } else if (action === 'delete') {
        removeProfileRecord(username)
          .then((updated) => renderInPagePanelList(updated, rootDoc))
          .catch((err) => showPanelStatus((err && err.message) || String(err), 'error', rootDoc));
      }
    });
    // Defer re-renders while the user is typing in a Price / ID cell (keeps focus & caret).
    tbody.addEventListener('focusout', () => {
      setTimeout(() => {
        if (panelState.deferredList && !isEditingPanelCell(rootDoc)) {
          const list = panelState.deferredList;
          panelState.deferredList = null;
          renderInPagePanelList(list, rootDoc);
        }
      }, 0);
    });

    if (typeof window !== 'undefined' && !window.__crowPanelResizeBound) {
      window.__crowPanelResizeBound = true;
      window.addEventListener('resize', () => applyLauncherPosition(document));
    }

    applyLauncherPosition(rootDoc);
    loadPanelPrefs().then((prefs) => {
      panelState.sort = prefs.sort || 'recent';
      sortSel.value = panelState.sort;
      applyLauncherPosition(rootDoc);
      if (!panelState.expandedTouched && !keepExpanded) {
        showPanelExpanded(Boolean(prefs.expanded), rootDoc, { fromPrefs: true });
      }
      renderPanelRows(rootDoc);
    });

    getStoredProfiles()
      .then((list) => renderInPagePanelList(list, rootDoc))
      .catch((err) => showPanelStatus((err && err.message) || String(err), 'error', rootDoc));
    return panel;
  }

  function isEditingPanelCell(rootDoc = document) {
    const active = rootDoc.activeElement;
    return Boolean(
      active &&
      active.tagName === 'INPUT' &&
      active.closest &&
      active.closest('#ig-scraper-tbody')
    );
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  async function renderInPagePanelList(profiles, rootDoc = document) {
    const list = Array.isArray(profiles) ? profiles : await getStoredProfiles();
    if (isEditingPanelCell(rootDoc)) {
      panelState.deferredList = list;
      return;
    }
    panelState.profiles = Core.deduplicateProfiles(list);
    renderPanelRows(rootDoc);
  }

  function renderPanelRows(rootDoc = document) {
    const all = panelState.profiles;
    const warnCount = all.filter((p) => qualityOf(p).level === 'warn').length;

    const badge = rootDoc.getElementById('ig-scraper-count-badge');
    if (badge) badge.textContent = String(all.length);
    const launcherBadge = rootDoc.getElementById('crow-launcher-badge');
    if (launcherBadge) {
      launcherBadge.textContent = String(all.length);
      launcherBadge.classList.toggle('crow-launcher-badge-warn', warnCount > 0);
      launcherBadge.hidden = all.length === 0;
    }
    const summary = rootDoc.getElementById('crow-foot-summary');
    if (summary) {
      summary.textContent = all.length === 0
        ? ''
        : `${all.length} profile${all.length === 1 ? '' : 's'}${warnCount ? ` · ⚠ ${warnCount} to check` : ''}`;
    }

    const tbody = rootDoc.getElementById('ig-scraper-tbody');
    if (!tbody) return;

    if (all.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="ig-scraper-empty-cell crow-empty">
            <div class="crow-empty-title">No profiles yet</div>
            <div class="crow-empty-text">Open any Instagram profile and press <strong>Scrape Profile</strong> next to the username.</div>
          </td>
        </tr>
      `;
      return;
    }

    const rows = sortProfiles(filterProfiles(all, panelState.query), panelState.sort);
    if (rows.length === 0) {
      tbody.innerHTML = '';
      const tr = rootDoc.createElement('tr');
      const td = rootDoc.createElement('td');
      td.colSpan = 11;
      td.className = 'ig-scraper-empty-cell crow-empty';
      td.textContent = `No profile matches “${panelState.query}”.`;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    tbody.innerHTML = '';
    let highlightRow = null;
    for (const item of rows) {
      const tr = buildPanelRow(item, rootDoc);
      if (panelState.highlight && sameUsername(item.username, panelState.highlight)) {
        tr.classList.add('crow-row-new');
        highlightRow = tr;
      }
      tbody.appendChild(tr);
    }
    if (highlightRow && typeof highlightRow.scrollIntoView === 'function') {
      try {
        highlightRow.scrollIntoView({ block: 'nearest' });
      } catch (_err) {
        // ignore
      }
    }
  }

  function makeCell(rootDoc, className, text) {
    const td = rootDoc.createElement('td');
    if (className) td.className = className;
    if (text !== undefined) td.textContent = text;
    return td;
  }

  function makeMetricCell(rootDoc, value, badgeText, badgeClass, badgeTitle) {
    const td = makeCell(rootDoc, 'col-num');
    const wrap = rootDoc.createElement('div');
    wrap.className = 'crow-metric';
    const val = rootDoc.createElement('span');
    val.className = 'ig-metric-val';
    val.textContent = value;
    const badge = rootDoc.createElement('span');
    badge.className = `ig-metric-badge crow-pill ${badgeClass}`;
    badge.textContent = badgeText;
    if (badgeTitle) badge.title = badgeTitle;
    wrap.append(val, badge);
    td.appendChild(wrap);
    return td;
  }

  function makeIconButton(rootDoc, action, username, label, svgPath, extraClass) {
    const btn = rootDoc.createElement('button');
    btn.type = 'button';
    btn.className = `crow-row-btn ${extraClass || ''}`.trim();
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-username', username);
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">${svgPath}</svg>`;
    return btn;
  }

  function bindSavingInput(input, username, field, rootDoc) {
    let timer = 0;
    const save = async () => {
      clearTimeout(timer);
      try {
        const list = await updateProfileField(username, field, input.value);
        // Keep the in-memory list current (search / sort read it) without re-rendering the row
        // the user is typing in.
        if (Array.isArray(list)) panelState.profiles = Core.deduplicateProfiles(list);
      } catch (err) {
        showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(save, 450);
    });
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  }

  function buildPanelRow(item, rootDoc = document) {
    const tr = rootDoc.createElement('tr');
    const username = String(item.username || '');
    const profileUrl = item.profileUrl || `https://www.instagram.com/${encodeURIComponent(username)}/`;
    const quality = qualityOf(item);
    if (quality.level === 'warn') tr.classList.add('crow-row-warn');

    // Col 1: USERNAME (+ avatar, meta, flags)
    const tdUser = makeCell(rootDoc, 'cell-username');
    const userWrap = rootDoc.createElement('div');
    userWrap.className = 'crow-user';
    const avatar = rootDoc.createElement('span');
    avatar.className = 'crow-avatar';
    avatar.style.background = avatarStyleFor(username);
    avatar.textContent = (username.replace(/^[^a-zA-Z0-9]+/, '').charAt(0) || '?').toUpperCase();
    const userText = rootDoc.createElement('div');
    userText.className = 'crow-user-text';
    const link = rootDoc.createElement('a');
    link.href = profileUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'ig-scraper-user-link';
    link.title = `Open @${username} on Instagram`;
    link.textContent = username;
    const meta = rootDoc.createElement('div');
    meta.className = 'crow-user-meta';
    const metaParts = [];
    if (Number(item.postsAnalyzed) > 0) metaParts.push(`${item.postsAnalyzed} reel${Number(item.postsAnalyzed) === 1 ? '' : 's'}`);
    const src = sourceLabel(item.dataSource);
    if (src) metaParts.push(src);
    const ago = timeAgo(item.editedAt || item.scrapedAt);
    if (ago) metaParts.push(ago);
    const metaText = rootDoc.createElement('span');
    metaText.textContent = metaParts.join(' · ');
    meta.appendChild(metaText);
    if (item.manuallyEdited) {
      const edited = rootDoc.createElement('span');
      edited.className = 'crow-flag crow-flag-edited';
      edited.textContent = '✎ edited';
      edited.title = 'You corrected this row by hand';
      meta.appendChild(edited);
    }
    if (quality.level === 'warn') {
      const warnBtn = rootDoc.createElement('button');
      warnBtn.type = 'button';
      warnBtn.className = 'crow-flag crow-flag-warn';
      warnBtn.setAttribute('data-action', 'check');
      warnBtn.setAttribute('data-username', username);
      warnBtn.textContent = '⚠ check';
      warnBtn.title = `${quality.issues.join('\n')}\n\nClick to review & fix.`;
      meta.appendChild(warnBtn);
    }
    userText.append(link, meta);
    userWrap.append(avatar, userText);
    tdUser.appendChild(userWrap);

    // Col 2: Follower
    const tdFollowers = makeCell(rootDoc, 'col-num', Core.formatNumberWithCommas(item.followers));

    // Col 3: ER + benchmark
    const erBenchInfo = Core.getErBenchmark(item.followers, item.er);
    const erBadgeClass = erBenchInfo.aboveBenchmark
      ? 'crow-badge-good'
      : Number(item.er || 0) >= erBenchInfo.benchmark * 0.5
        ? 'crow-badge-low'
        : 'crow-badge-bad';
    const tdEr = makeMetricCell(
      rootDoc,
      item.erFormatted || (Number(item.er || 0).toFixed(2) + '%'),
      `${erBenchInfo.aboveBenchmark ? '≥' : '<'}${erBenchInfo.formatted}`,
      erBadgeClass,
      `Benchmark for ${erBenchInfo.tier} followers: ${erBenchInfo.formatted}`
    );

    // Col 4: V.R. + band
    const vrBandInfo = Core.getViewRateBand(item.vr);
    const tdVr = makeMetricCell(
      rootDoc,
      item.vrFormatted || (Number(item.vr || 0).toFixed(2) + '%'),
      vrBandInfo.band,
      getVrBadgeClass(vrBandInfo.band),
      `View Rate band: ${vrBandInfo.band} (${vrBandInfo.range})`
    );

    // Col 5-8
    const tdViews = makeCell(
      rootDoc,
      'col-num',
      (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
        ? item.avgViewsFormatted
        : Core.formatCompactCount(item.avgViews)
    );
    const tdLikes = makeCell(rootDoc, 'col-num', Core.formatNumberWithCommas(item.avgLikes));
    const tdComments = makeCell(rootDoc, 'col-num', Core.formatNumberWithCommas(item.avgComments));
    const tdLpc = makeCell(rootDoc, 'col-num', Core.formatLikesPerComment(item.likesPerComment));

    // Col 9: Price/REEL
    const tdPrice = makeCell(rootDoc, 'col-price');
    const priceInput = rootDoc.createElement('input');
    priceInput.type = 'text';
    priceInput.className = 'ig-scraper-price-input crow-cell-input';
    priceInput.value = item.pricePerReel !== undefined && item.pricePerReel !== null ? String(item.pricePerReel) : '';
    priceInput.placeholder = '—';
    priceInput.title = 'Price/REEL';
    priceInput.setAttribute('aria-label', `Price per reel for ${username}`);
    bindSavingInput(priceInput, username, 'pricePerReel', rootDoc);
    tdPrice.appendChild(priceInput);

    // Col 10: ID/Phone
    const tdContact = makeCell(rootDoc, 'col-contact');
    const contactInput = rootDoc.createElement('input');
    contactInput.type = 'text';
    contactInput.className = 'crow-contact-input crow-cell-input';
    contactInput.value = item.contactInfo !== undefined && item.contactInfo !== null ? String(item.contactInfo) : '';
    contactInput.placeholder = 'Add ID / phone';
    contactInput.title = 'ID / Phone number';
    contactInput.setAttribute('aria-label', `ID or phone number for ${username}`);
    bindSavingInput(contactInput, username, 'contactInfo', rootDoc);
    tdContact.appendChild(contactInput);

    // Col 11: actions
    const tdActions = makeCell(rootDoc, 'col-actions');
    const actions = rootDoc.createElement('div');
    actions.className = 'crow-row-actions';
    actions.append(
      makeIconButton(
        rootDoc,
        'edit',
        username,
        `Edit @${username} (fix wrong numbers)`,
        '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>'
      ),
      makeIconButton(
        rootDoc,
        'rescrape',
        username,
        `Re-scrape @${username} fresh (reloads the profile)`,
        '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'
      ),
      makeIconButton(
        rootDoc,
        'delete',
        username,
        `Remove @${username}`,
        '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>',
        'ig-scraper-row-del crow-row-btn-danger'
      )
    );
    tdActions.appendChild(actions);

    tr.append(tdUser, tdFollowers, tdEr, tdVr, tdViews, tdLikes, tdComments, tdLpc, tdPrice, tdContact, tdActions);
    return tr;
  }

  // --------------------------------------------------------------------------
  // Edit & fresh re-scrape
  // --------------------------------------------------------------------------

  async function openProfileEditor(username, rootDoc = document) {
    const Editor = typeof window !== 'undefined' ? window.CrowEditor : null;
    if (!Editor || typeof Editor.open !== 'function') {
      showPanelStatus('The editor failed to load — refresh the tab.', 'error', rootDoc);
      return;
    }
    let list;
    try {
      list = await getStoredProfiles();
    } catch (err) {
      showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      return;
    }
    const key = Core.normalizeUsernameKey(username);
    const profile = list.find((p) => Core.normalizeUsernameKey(p.username) === key);
    if (!profile) return;
    Editor.open({
      doc: rootDoc,
      Core,
      profile,
      onSave: async (record) => {
        const updated = await replaceProfileRecord(record);
        panelState.highlight = record.username;
        await renderInPagePanelList(updated, rootDoc);
        showToast(`Saved @${record.username} — ER ${record.erFormatted} · V.R. ${record.vrFormatted}`, 'success', rootDoc);
      },
      onRescrape: (p) => requestFreshRescrape(p.username, rootDoc),
      onDelete: async (p) => {
        const updated = await removeProfileRecord(p.username);
        await renderInPagePanelList(updated, rootDoc);
      }
    });
  }

  /**
   * Fully reloads the profile (fresh DOM, fresh embedded data, no-store API calls) and scrapes it
   * again automatically, replacing the stored row. A plain re-click on the same page could reuse
   * stale page data and give the same wrong result.
   */
  async function requestFreshRescrape(username, rootDoc = document) {
    const clean = String(username || '').trim().replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(clean)) return;
    try {
      await setPendingRescrape({ username: clean.toLowerCase(), at: Date.now() });
    } catch (err) {
      showPanelStatus((err && err.message) || String(err), 'error', rootDoc);
      return;
    }
    showToast(`Reloading @${clean} to scrape it fresh…`, 'info', rootDoc);
    setTimeout(() => {
      window.location.assign(`https://www.instagram.com/${clean}/`);
    }, 150);
  }

  let pendingRescrapeRunning = false;
  async function runPendingRescrapeIfAny(rootDoc = document) {
    // Only guards against two runs at the same time; a later call (e.g. after the request was
    // stored) must still be able to pick it up.
    if (pendingRescrapeRunning) return;
    pendingRescrapeRunning = true;
    try {
      await runPendingRescrapeUnguarded(rootDoc);
    } finally {
      pendingRescrapeRunning = false;
    }
  }

  async function runPendingRescrapeUnguarded(rootDoc) {
    let pending = null;
    try {
      pending = await getPendingRescrape();
    } catch (_err) {
      return;
    }
    if (!pending || !pending.username) return;
    if (!Number.isFinite(pending.at) || Date.now() - pending.at > 3 * 60 * 1000) {
      await clearPendingRescrape();
      return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + 20000;
    while (Date.now() < deadline) {
      const current = detectCurrentProfileUsername(rootDoc);
      if (current && !sameUsername(current, pending.username)) {
        // The user went somewhere else — drop the request.
        await clearPendingRescrape();
        return;
      }
      const btn = ensureProfileScrapeButton(rootDoc);
      const gridReady = rootDoc.querySelector('main a[href*="/p/"], main a[href*="/reel/"]');
      if (btn && sameUsername(btn.getAttribute('data-username'), pending.username) &&
        (gridReady || Date.now() - startedAt > 8000)) {
        await clearPendingRescrape();
        await new Promise((r) => setTimeout(r, 700)); // let the grid settle
        await handleScrapeButtonClick(btn, rootDoc);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    await clearPendingRescrape();
    showToast('Could not re-scrape automatically — press “Scrape Profile”.', 'error', rootDoc);
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
            markHighlight(metrics.username);
            await renderInPagePanelList(list, document);
            reportScrapeQuality(metrics, document);
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

  function bootContentScript() {
    initContentScript();
    if (isExtensionContextAlive() && isCurrentInstance()) {
      runPendingRescrapeIfAny(document).catch(() => {});
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootContentScript);
    } else {
      bootContentScript();
    }
  }

  // Export functions for automated testing
  const exportedApi = {
    getPostTileContainer,
    isDomPostElementPinned,
    detectDomPostReelStatus,
    extractCountsFromDomPostTile,
    readTileNumbers,
    resolveTileCountsFromHover,
    populateDomPostCountsViaHover,
    readViewBadges,
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
    updateProfileField,
    replaceProfileRecord,
    removeProfileRecord,
    showPanelExpanded,
    computeCardGeometry,
    setPanelSize,
    resetPanelSize,
    openProfileEditor,
    requestFreshRescrape,
    runPendingRescrapeIfAny,
    syncProfilesWithGoogleSheet
  };

  if (typeof window !== 'undefined') {
    window.InstaScraperContent = exportedApi;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = exportedApi;
  }
})();
