/**
 * Popup controller for Crow Scrapper (by @mhrshadfm) Extension.
 * Manages the 9-column profile table (USERNAME, Follower, ER + benchmark, V.R. + band,
 * AV VIEW, AV LIKE, AV COMMENTS, LIKES PER COMMENT, Price/REEL), Excel/CSV export,
 * Skip-Most-Recent option, and Shared Google Sheet sync with strict deduplication.
 */
(function () {
  'use strict';

  const Core = window.InstaScraperCore;
  const STORAGE_KEY = 'ig_scraped_profiles';
  const SETTINGS_KEY = 'ig_scraper_settings';
  const SHEET_CONFIG_KEY = 'ig_google_sheet_config';

  const scrapeActiveBtn = document.getElementById('scrape-active-btn');
  const syncSheetBtn = document.getElementById('sync-sheet-btn');
  const exportXlsxBtn = document.getElementById('export-xlsx-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const clearListBtn = document.getElementById('clear-list-btn');
  const profileCountEl = document.getElementById('profile-count');
  const skipMostRecentCheckbox = document.getElementById('skip-most-recent-checkbox');
  const tbodyEl = document.getElementById('results-tbody');
  const statusBanner = document.getElementById('status-banner');

  const sheetSyncSection = document.getElementById('sheet-sync-section');
  const sheetUrlInput = document.getElementById('sheet-url-input');
  const sheetWebAppInput = document.getElementById('sheet-webapp-input');
  const sheetTokenInput = document.getElementById('sheet-token-input');
  const sheetAutoSyncCheckbox = document.getElementById('sheet-autosync-checkbox');
  const copySheetScriptBtn = document.getElementById('copy-sheet-script-btn');
  const saveSheetConfigBtn = document.getElementById('save-sheet-config-btn');
  let suppressNextStorageRender = false;

  function showStatus(message, type = 'info') {
    if (!statusBanner) return;
    statusBanner.textContent = message;
    statusBanner.className = `status-banner ${type}`;
  }

  function getStoredProfiles() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          const list = Array.isArray(res && res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
          resolve(Core.deduplicateProfiles(list));
        });
      } else {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const parsed = raw ? JSON.parse(raw) : [];
          resolve(Core.deduplicateProfiles(Array.isArray(parsed) ? parsed : []));
        } catch (_err) {
          resolve([]);
        }
      }
    });
  }

  function saveStoredProfiles(profiles) {
    return new Promise((resolve) => {
      const list = Core.deduplicateProfiles(Array.isArray(profiles) ? profiles : []);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: list }, () => resolve(list));
      } else {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (_err) {
          // ignore
        }
        resolve(list);
      }
    });
  }

  function getScraperSettings() {
    return new Promise((resolve) => {
      const defaults = { excludeMostRecent: false };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([SETTINGS_KEY], (res) => {
          const saved = res && res[SETTINGS_KEY] && typeof res[SETTINGS_KEY] === 'object' ? res[SETTINGS_KEY] : {};
          resolve({ ...defaults, ...saved });
        });
      } else {
        try {
          const raw = localStorage.getItem(SETTINGS_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ ...defaults, ...(parsed && typeof parsed === 'object' ? parsed : {}) });
        } catch (_err) {
          resolve(defaults);
        }
      }
    });
  }

  function saveScraperSettings(settings) {
    return new Promise((resolve) => {
      const clean = { excludeMostRecent: Boolean(settings && settings.excludeMostRecent) };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [SETTINGS_KEY]: clean }, () => resolve(clean));
      } else {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
        } catch (_err) {
          // ignore
        }
        resolve(clean);
      }
    });
  }

  function getGoogleSheetConfig() {
    return new Promise((resolve) => {
      const defaults = {
        sheetUrl: '',
        webAppUrl: '',
        accessToken: '',
        syncToken: '',
        autoSync: false
      };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([SHEET_CONFIG_KEY], (res) => {
          const saved = res && res[SHEET_CONFIG_KEY] && typeof res[SHEET_CONFIG_KEY] === 'object'
            ? res[SHEET_CONFIG_KEY]
            : {};
          resolve({ ...defaults, ...saved });
        });
      } else {
        try {
          const raw = localStorage.getItem(SHEET_CONFIG_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ ...defaults, ...(parsed && typeof parsed === 'object' ? parsed : {}) });
        } catch (_err) {
          resolve(defaults);
        }
      }
    });
  }

  function generateSyncToken() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function saveGoogleSheetConfig(config) {
    // The form doesn't contain the sync token; keep the stored one unless a new one is passed.
    const existing = await getGoogleSheetConfig();
    return new Promise((resolve) => {
      const clean = {
        sheetUrl: String((config && config.sheetUrl) || '').trim(),
        webAppUrl: String((config && config.webAppUrl) || '').trim(),
        accessToken: String((config && config.accessToken) || '').trim(),
        syncToken: String((config && config.syncToken) || existing.syncToken || '').trim(),
        autoSync: Boolean(config && config.autoSync)
      };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [SHEET_CONFIG_KEY]: clean }, () => resolve(clean));
      } else {
        try {
          localStorage.setItem(SHEET_CONFIG_KEY, JSON.stringify(clean));
        } catch (_err) {
          // ignore
        }
        resolve(clean);
      }
    });
  }

  function readSheetFormInputs() {
    return {
      sheetUrl: sheetUrlInput ? sheetUrlInput.value.trim() : '',
      webAppUrl: sheetWebAppInput ? sheetWebAppInput.value.trim() : '',
      accessToken: sheetTokenInput ? sheetTokenInput.value.trim() : '',
      autoSync: sheetAutoSyncCheckbox ? sheetAutoSyncCheckbox.checked : false
    };
  }

  async function executeGoogleSheetSync() {
    const config = await saveGoogleSheetConfig(readSheetFormInputs());
    const profiles = await getStoredProfiles();

    if (profiles.length === 0) {
      showStatus('Add at least one scraped profile before syncing to Google Sheets.', 'error');
      return;
    }

    if (!config.webAppUrl && !config.sheetUrl) {
      if (sheetSyncSection) sheetSyncSection.open = true;
      showStatus('Please configure your Shared Google Sheet URL or Apps Script Web App URL below.', 'error');
      return;
    }

    if (syncSheetBtn) syncSheetBtn.disabled = true;
    showStatus(`Syncing ${profiles.length} deduplicated profile(s) to Google Sheet...`, 'info');

    const finishSync = (result) => {
      if (syncSheetBtn) syncSheetBtn.disabled = false;
      if (result && result.ok) {
        showStatus(
          `Google Sheet synced! Updated ${result.updatedCount || 0} existing row(s), appended ${result.appendedCount || 0} new profile(s) (${describeSheetSyncResult(result)}).`,
          'success'
        );
      } else {
        if (sheetSyncSection) sheetSyncSection.open = true;
        showStatus((result && result.error) || 'Failed to sync with Google Sheet.', 'error');
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      chrome.runtime.sendMessage({ type: 'SYNC_GOOGLE_SHEET', profiles, config }, async (response) => {
        if (chrome.runtime.lastError || !response) {
          const fallbackRes = await Core.syncProfilesToGoogleSheet(profiles, config);
          finishSync(fallbackRes);
          return;
        }
        finishSync(response);
      });
    } else {
      const res = await Core.syncProfilesToGoogleSheet(profiles, config);
      finishSync(res);
    }
  }

function describeSheetSyncResult(res) {
    const dupRemoved = Number(res && res.duplicateRowsRemoved) || 0;
    const dupFound = Number(res && res.duplicateRowsFound) || 0;
    if (dupRemoved > 0) return `${dupRemoved} duplicate row(s) removed`;
    if (dupFound > 0) return `${dupFound} duplicate row(s) already in the sheet — delete them manually`;
    return 'no duplicates';
  }

  function getVrBadgeClass(band) {
    const b = String(band || '').toLowerCase();
    if (b === 'very high') return 'badge-vr-vhigh';
    if (b === 'high') return 'badge-vr-high';
    if (b === 'medium') return 'badge-vr-med';
    if (b === 'low') return 'badge-vr-low';
    return 'badge-vr-vlow';
  }

  function renderTable(profiles) {
    const list = Core.deduplicateProfiles(Array.isArray(profiles) ? profiles : []);
    if (profileCountEl) {
      profileCountEl.textContent = String(list.length);
    }

    const hasItems = list.length > 0;
    if (syncSheetBtn) syncSheetBtn.disabled = !hasItems;
    if (exportXlsxBtn) exportXlsxBtn.disabled = !hasItems;
    if (exportCsvBtn) exportCsvBtn.disabled = !hasItems;
    if (clearListBtn) clearListBtn.disabled = !hasItems;

    if (!tbodyEl) return;
    tbodyEl.innerHTML = '';

    if (!hasItems) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 10;
      td.className = 'empty-state';
      td.textContent = 'No profiles in list yet. Open an Instagram profile and click "Scrape Profile" next to their username!';
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
      return;
    }

    list.forEach((item) => {
      const tr = document.createElement('tr');
      const username = String(item.username || '');
      const profileUrl = item.profileUrl || `https://www.instagram.com/${encodeURIComponent(username)}/`;

      // Column 1: Clickable USERNAME
      const tdUser = document.createElement('td');
      const link = document.createElement('a');
      link.href = profileUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'user-profile-link';
      link.title = `Open @${username} on Instagram`;
      link.textContent = username;
      tdUser.appendChild(link);

      // Column 2: Follower
      const tdFollowers = document.createElement('td');
      tdFollowers.textContent = Core.formatNumberWithCommas(item.followers);

      // Column 3: ER + Follower Benchmark Badge
      const tdEr = document.createElement('td');
      const erVal = item.erFormatted || (Number(item.er || 0).toFixed(2) + '%');
      const erBenchInfo = Core.getErBenchmark(item.followers, item.er);
      const erMain = document.createElement('span');
      erMain.className = 'metric-main';
      erMain.textContent = erVal;
      const erBadge = document.createElement('span');
      const erBadgeClass = erBenchInfo.aboveBenchmark
        ? 'badge-er-good'
        : Number(item.er || 0) >= erBenchInfo.benchmark * 0.5
          ? 'badge-er-low'
          : 'badge-er-bad';
      erBadge.className = `metric-badge ${erBadgeClass}`;
      erBadge.title = `Benchmark for ${erBenchInfo.tier} followers: ${erBenchInfo.formatted}`;
      erBadge.textContent = `${erBenchInfo.aboveBenchmark ? '≥' : '<'}${erBenchInfo.formatted}`;
      tdEr.append(erMain, erBadge);

      // Column 4: V.R. + View Rate Band Badge
      const tdVr = document.createElement('td');
      const vrVal = item.vrFormatted || (Number(item.vr || 0).toFixed(2) + '%');
      const vrBandInfo = Core.getViewRateBand(item.vr);
      const vrMain = document.createElement('span');
      vrMain.className = 'metric-main';
      vrMain.textContent = vrVal;
      const vrBadge = document.createElement('span');
      vrBadge.className = `metric-badge ${getVrBadgeClass(vrBandInfo.band)}`;
      vrBadge.title = `View Rate Band: ${vrBandInfo.band} (${vrBandInfo.range})`;
      vrBadge.textContent = vrBandInfo.band;
      tdVr.append(vrMain, vrBadge);

      // Column 5: AV VIEW
      const tdViews = document.createElement('td');
      tdViews.textContent = (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
        ? item.avgViewsFormatted
        : Core.formatCompactCount(item.avgViews);

      // Column 6: AV LIKE
      const tdLikes = document.createElement('td');
      tdLikes.textContent = Core.formatNumberWithCommas(item.avgLikes);

      // Column 7: AV COMMENTS
      const tdComments = document.createElement('td');
      tdComments.textContent = Core.formatNumberWithCommas(item.avgComments);

      // Column 8: LIKES PER COMMENT
      const tdLpc = document.createElement('td');
      tdLpc.textContent = Core.formatLikesPerComment(item.likesPerComment);

      // Column 9: Price/REEL (empty by default, editable)
      const tdPrice = document.createElement('td');
      const priceInput = document.createElement('input');
      priceInput.type = 'text';
      priceInput.className = 'price-reel-input';
      priceInput.value = item.pricePerReel !== undefined && item.pricePerReel !== null ? String(item.pricePerReel) : '';
      priceInput.placeholder = '';
      priceInput.title = 'Optional Price/REEL (kept empty by default)';
      // Save while typing (debounced) as well as on 'change': the popup is destroyed as soon as
      // it loses focus, often before the input's 'change' event fires, which lost the edit.
      let priceSaveTimer = null;
      const savePrice = async () => {
        if (priceSaveTimer) {
          clearTimeout(priceSaveTimer);
          priceSaveTimer = null;
        }
        const current = await getStoredProfiles();
        const key = Core.normalizeUsernameKey(username);
        const idx = current.findIndex((p) => Core.normalizeUsernameKey(p.username) === key);
        const nextPrice = priceInput.value.trim();
        if (idx >= 0 && String(current[idx].pricePerReel || '') !== nextPrice) {
          current[idx].pricePerReel = nextPrice;
          suppressNextStorageRender = true;
          try {
            await saveStoredProfiles(current);
          } finally {
            setTimeout(() => {
              suppressNextStorageRender = false;
            }, 50);
          }
        }
      };
      priceInput.addEventListener('input', () => {
        if (priceSaveTimer) clearTimeout(priceSaveTimer);
        priceSaveTimer = setTimeout(() => {
          savePrice();
        }, 300);
      });
      priceInput.addEventListener('change', () => {
        savePrice();
      });
      tdPrice.appendChild(priceInput);

      // Column 10: Remove button
      const tdAction = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'delete-row-btn';
      delBtn.title = `Remove ${username}`;
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async () => {
        const current = await getStoredProfiles();
        const key = Core.normalizeUsernameKey(username);
        const filtered = current.filter(
          (p) => Core.normalizeUsernameKey(p.username) !== key
        );
        await saveStoredProfiles(filtered);
        renderTable(filtered);
      });
      tdAction.appendChild(delBtn);

      tr.append(tdUser, tdFollowers, tdEr, tdVr, tdViews, tdLikes, tdComments, tdLpc, tdPrice, tdAction);
      tbodyEl.appendChild(tr);
    });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 500);
  }

  if (skipMostRecentCheckbox) {
    skipMostRecentCheckbox.addEventListener('change', async () => {
      await saveScraperSettings({ excludeMostRecent: skipMostRecentCheckbox.checked });
      showStatus(
        skipMostRecentCheckbox.checked
          ? 'Enabled: The #1 most recent post/reel will also be excluded along with pinned posts.'
          : 'Disabled: All 6 newest non-pinned reels will be included.',
        'info'
      );
    });
  }

  for (const inputEl of [sheetUrlInput, sheetWebAppInput, sheetTokenInput, sheetAutoSyncCheckbox]) {
    if (inputEl) {
      inputEl.addEventListener('change', () => {
        saveGoogleSheetConfig(readSheetFormInputs());
      });
    }
  }

  if (copySheetScriptBtn) {
    copySheetScriptBtn.addEventListener('click', async () => {
      const formCfg = readSheetFormInputs();
      const existingCfg = await getGoogleSheetConfig();
      // A per-install shared secret is baked into the script; only this extension can then write
      // to the sheet through the deployed Web App (knowing the /exec URL alone is not enough).
      const syncToken = existingCfg.syncToken || generateSyncToken();
      const cfg = await saveGoogleSheetConfig({ ...formCfg, syncToken });
      const scriptCode = Core.generateGoogleAppsScriptCode(cfg.sheetUrl, cfg.syncToken);
      try {
        await navigator.clipboard.writeText(scriptCode);
        showStatus(
          'Copied Google Apps Script to clipboard! Open your Google Sheet → Extensions → Apps Script, paste, and deploy as Web App.',
          'success'
        );
      } catch (_err) {
        showStatus('Could not access clipboard automatically.', 'error');
      }
    });
  }

  if (saveSheetConfigBtn) {
    saveSheetConfigBtn.addEventListener('click', async () => {
      await executeGoogleSheetSync();
    });
  }

  if (syncSheetBtn) {
    syncSheetBtn.addEventListener('click', async () => {
      await executeGoogleSheetSync();
    });
  }

  if (exportXlsxBtn) {
    exportXlsxBtn.addEventListener('click', async () => {
      const list = await getStoredProfiles();
      if (list.length === 0) {
        showStatus('Add at least one profile before exporting.', 'error');
        return;
      }
      const bytes = Core.generateXlsxBytes(list);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const dateStr = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `instagram_profiles_${dateStr}.xlsx`);
      showStatus(`Exported ${list.length} profile(s) to Excel (.xlsx) with 9 columns & clickable usernames!`, 'success');
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', async () => {
      const list = await getStoredProfiles();
      if (list.length === 0) {
        showStatus('Add at least one profile before exporting.', 'error');
        return;
      }
      const csv = Core.generateCsvContent(list);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const dateStr = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `instagram_profiles_${dateStr}.csv`);
      showStatus(`Exported ${list.length} profile(s) to CSV (.csv)!`, 'success');
    });
  }

  if (clearListBtn) {
    clearListBtn.addEventListener('click', async () => {
      const current = await getStoredProfiles();
      if (current.length > 0 && !window.confirm(`Remove all ${current.length} scraped profile(s)? This cannot be undone.`)) {
        return;
      }
      await saveStoredProfiles([]);
      renderTable([]);
      showStatus('Cleared all scraped profiles.', 'info');
    });
  }

  if (scrapeActiveBtn) {
    scrapeActiveBtn.addEventListener('click', async () => {
      if (typeof chrome === 'undefined' || !chrome.tabs) {
        showStatus('Open an Instagram profile page to scrape.', 'error');
        return;
      }

      const settings = await getScraperSettings();
      const excludeMostRecent = Boolean(settings && settings.excludeMostRecent);

      scrapeActiveBtn.disabled = true;
      showStatus('Scraping 6 recent non-pinned reels from active Instagram tab...', 'info');

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs && tabs[0];
        let isInstagramTab = false;
        try {
          const host = new URL(activeTab && activeTab.url ? activeTab.url : '').hostname.toLowerCase();
          isInstagramTab = host === 'instagram.com' || host === 'www.instagram.com';
        } catch (_err) {
          isInstagramTab = false;
        }
        if (!activeTab || !activeTab.id || !isInstagramTab) {
          scrapeActiveBtn.disabled = false;
          showStatus('Please open an Instagram profile page (https://www.instagram.com/<username>/) first.', 'error');
          return;
        }

        function handleScrapeResponse(response) {
          scrapeActiveBtn.disabled = false;
          if (!response || !response.ok) {
            showStatus(
              (response && response.error) || 'Could not scrape this page. Make sure you are on a profile page.',
              'error'
            );
            return;
          }
          renderTable(response.profiles || []);
          const m = response.metrics;
          showStatus(
            `Scraped @${m.username}: ${Core.formatNumberWithCommas(m.followers)} followers · ER ${m.erFormatted} (${m.erAboveBenchmark ? '≥' : '<'}${m.erBenchmarkFormatted}) · V.R. ${m.vrFormatted} (${m.vrBand})`,
            'success'
          );
        }

        chrome.tabs.sendMessage(
          activeTab.id,
          { type: 'SCRAPE_CURRENT_PROFILE', excludeMostRecent },
          (response) => {
            if (chrome.runtime.lastError || !response) {
              if (chrome.scripting && chrome.scripting.executeScript) {
                chrome.scripting.insertCSS(
                  { target: { tabId: activeTab.id }, files: ['src/content.css'] },
                  () => {
                    chrome.scripting.executeScript(
                      { target: { tabId: activeTab.id }, files: ['src/core.js', 'src/content.js'] },
                      () => {
                        if (chrome.runtime.lastError) {
                          scrapeActiveBtn.disabled = false;
                          showStatus('Please refresh the Instagram tab and try again.', 'error');
                          return;
                        }
                        chrome.tabs.sendMessage(
                          activeTab.id,
                          { type: 'SCRAPE_CURRENT_PROFILE', excludeMostRecent },
                          handleScrapeResponse
                        );
                      }
                    );
                  }
                );
              } else {
                scrapeActiveBtn.disabled = false;
                showStatus('Please refresh the Instagram tab and try again.', 'error');
              }
              return;
            }
            handleScrapeResponse(response);
          }
        );
      });
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        if (suppressNextStorageRender) {
          suppressNextStorageRender = false;
          return;
        }
        renderTable(changes[STORAGE_KEY].newValue || []);
      }
      if (area === 'local' && changes[SETTINGS_KEY] && skipMostRecentCheckbox) {
        const s = changes[SETTINGS_KEY].newValue || {};
        skipMostRecentCheckbox.checked = Boolean(s.excludeMostRecent);
      }
    });
  }

  const brandLogoImg = document.querySelector('.brand-logo-img');
  if (brandLogoImg && Core && Core.CROW_WHITE_DATA_URI) {
    brandLogoImg.addEventListener('error', () => {
      if (brandLogoImg.src !== Core.CROW_WHITE_DATA_URI) {
        brandLogoImg.src = Core.CROW_WHITE_DATA_URI;
      }
    });
    if (brandLogoImg.complete && brandLogoImg.naturalWidth === 0 && brandLogoImg.src !== Core.CROW_WHITE_DATA_URI) {
      brandLogoImg.src = Core.CROW_WHITE_DATA_URI;
    }
  }

  // Initialize UI state from storage
  Promise.all([getStoredProfiles(), getScraperSettings(), getGoogleSheetConfig()]).then(
    ([profiles, settings, sheetCfg]) => {
      renderTable(profiles);
      if (skipMostRecentCheckbox) {
        skipMostRecentCheckbox.checked = Boolean(settings && settings.excludeMostRecent);
      }
      if (sheetUrlInput) sheetUrlInput.value = sheetCfg.sheetUrl || '';
      if (sheetWebAppInput) sheetWebAppInput.value = sheetCfg.webAppUrl || '';
      if (sheetTokenInput) sheetTokenInput.value = sheetCfg.accessToken || '';
      if (sheetAutoSyncCheckbox) sheetAutoSyncCheckbox.checked = Boolean(sheetCfg.autoSync);
    }
  );
})();
