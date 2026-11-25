/**
 * Background Service Worker for Crow Scrapper (by @mhrshadfm) Extension.
 * - Keeps the extension badge count synced with the number of scraped profiles in storage.
 * - Handles background Google Sheets sync requests (Mode 1: Apps Script Web App, Mode 2: Google Sheets REST API v4)
 *   with strict username deduplication.
 */
'use strict';

if (typeof importScripts === 'function') {
  try {
    importScripts('core.js');
  } catch (_err) {
    // ignore if already loaded
  }
}

const Core = typeof self !== 'undefined' && self.InstaScraperCore
  ? self.InstaScraperCore
  : typeof require === 'function'
    ? require('./core.js')
    : null;

const STORAGE_KEY = 'ig_scraped_profiles';
const SHEET_CONFIG_KEY = 'ig_google_sheet_config';

function updateBadgeFromList(list) {
  const count = Array.isArray(list) ? list.length : 0;
  if (typeof chrome !== 'undefined' && chrome.action) {
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  }
}

function getStorageValues(keys) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    } else {
      resolve({});
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      const list = Array.isArray(res && res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
      if (!res || !Array.isArray(res[STORAGE_KEY])) {
        chrome.storage.local.set({ [STORAGE_KEY]: [] });
      }
      updateBadgeFromList(list);
    });
  });
}

// The toolbar badge is not restored when Chrome restarts, so refresh it from storage on startup.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    getStorageValues([STORAGE_KEY]).then((res) => {
      updateBadgeFromList(Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : []);
    });
  });
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      updateBadgeFromList(changes[STORAGE_KEY].newValue || []);
    }
  });
}

// Google Sheet syncs run one at a time. Two overlapping syncs (auto-sync after a scrape plus a
// manual "Sync Sheet") each read the sheet, both saw a new profile as missing and both appended it.
let sheetSyncChain = Promise.resolve();
function enqueueSheetSync(task) {
  const run = sheetSyncChain.then(task, task);
  sheetSyncChain = run.catch(() => {});
  return run;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'SYNC_GOOGLE_SHEET') {
      enqueueSheetSync(async () => {
        try {
          if (!Core || typeof Core.syncProfilesToGoogleSheet !== 'function') {
            sendResponse({ ok: false, error: 'Core sync module unavailable.' });
            return;
          }

          const stored = await getStorageValues([STORAGE_KEY, SHEET_CONFIG_KEY]);
          const profiles = Array.isArray(message.profiles)
            ? message.profiles
            : Array.isArray(stored[STORAGE_KEY])
              ? stored[STORAGE_KEY]
              : [];
          const config = message.config && typeof message.config === 'object'
            ? message.config
            : stored[SHEET_CONFIG_KEY] || {};

          const result = await Core.syncProfilesToGoogleSheet(profiles, config);
          sendResponse(result);
        } catch (err) {
          sendResponse({
            ok: false,
            error: err && err.message ? err.message : String(err)
          });
        }
      });
      return true;
    }

    return false;
  });
}
