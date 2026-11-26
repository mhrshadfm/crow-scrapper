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
    if (b === 'very high') return 'crow-badge-vhigh';
    if (b === 'high') return 'crow-badge-high';
    if (b === 'medium') return 'crow-badge-med';
    if (b === 'low') return 'crow-badge-low';
    return 'crow-badge-vlow';
  }

  const PENDING_RESCRAPE_KEY = 'crow_pending_rescrape';
  const AVATAR_GRADIENTS = [
    ['#8b5cf6', '#ec4899'],
    ['#6366f1', '#22d3ee'],
    ['#f59e0b', '#ef4444'],
    ['#10b981', '#3b82f6'],
    ['#ec4899', '#f97316'],
    ['#14b8a6', '#8b5cf6']
  ];
  let lastRenderedProfiles = [];
  let deferredProfiles = null;
  let searchQuery = '';

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

  function isEditingTableCell() {
    const active = document.activeElement;
    return Boolean(active && active.tagName === 'INPUT' && active.closest && active.closest('#results-tbody'));
  }

  async function updateProfileField(username, field, value) {
    const current = await getStoredProfiles();
    const key = Core.normalizeUsernameKey(username);
    const idx = current.findIndex((p) => Core.normalizeUsernameKey(p.username) === key);
    const next = String(value === undefined || value === null ? '' : value).trim();
    if (idx < 0 || String(current[idx][field] || '') === next) return current;
    current[idx] = { ...current[idx], [field]: next };
    suppressNextStorageRender = true;
    try {
      await saveStoredProfiles(current);
    } finally {
      setTimeout(() => {
        suppressNextStorageRender = false;
      }, 50);
    }
    return current;
  }

  async function replaceProfileRecord(record) {
    const current = await getStoredProfiles();
    const key = Core.normalizeUsernameKey(record.username);
    let found = false;
    const next = current.map((p) => {
      if (Core.normalizeUsernameKey(p.username) === key) {
        found = true;
        return { ...record };
      }
      return p;
    });
    if (!found) next.push({ ...record });
    return saveStoredProfiles(next);
  }

  async function removeProfile(username) {
    const current = await getStoredProfiles();
    const key = Core.normalizeUsernameKey(username);
    const filtered = current.filter((p) => Core.normalizeUsernameKey(p.username) !== key);
    await saveStoredProfiles(filtered);
    renderTable(filtered);
    return filtered;
  }

  /**
   * Reloads the profile in the active Instagram tab (or a new tab) and lets the content script
   * scrape it again automatically — fresh page data, no cached answers.
   */
  function requestFreshRescrape(username) {
    const clean = String(username || '').trim().replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(clean)) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.tabs) {
      showStatus('Re-scrape is only available inside the extension.', 'error');
      return;
    }
    const url = `https://www.instagram.com/${clean}/`;
    chrome.storage.local.set({ [PENDING_RESCRAPE_KEY]: { username: clean.toLowerCase(), at: Date.now() } }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        let onInstagram = false;
        try {
          const host = new URL(tab && tab.url ? tab.url : '').hostname.toLowerCase();
          onInstagram = host === 'instagram.com' || host === 'www.instagram.com';
        } catch (_err) {
          onInstagram = false;
        }
        if (tab && tab.id && onInstagram) {
          chrome.tabs.update(tab.id, { url });
        } else {
          chrome.tabs.create({ url, active: true });
        }
        showStatus(`Reloading @${clean} — it will be re-scraped automatically.`, 'info');
      });
    });
  }

  function openEditor(username) {
    if (!window.CrowEditor || typeof window.CrowEditor.open !== 'function') {
      showStatus('The editor failed to load.', 'error');
      return;
    }
    getStoredProfiles().then((list) => {
      const key = Core.normalizeUsernameKey(username);
      const profile = list.find((p) => Core.normalizeUsernameKey(p.username) === key);
      if (!profile) return;
      window.CrowEditor.open({
        doc: document,
        Core,
        profile,
        onSave: async (record) => {
          const updated = await replaceProfileRecord(record);
          renderTable(updated);
          showStatus(`Saved @${record.username} — ER ${record.erFormatted} · V.R. ${record.vrFormatted}`, 'success');
        },
        onRescrape: (p) => requestFreshRescrape(p.username),
        onDelete: async (p) => {
          await removeProfile(p.username);
        }
      });
    });
  }

  function bindSavingInput(input, username, field) {
    let timer = 0;
    // Save while typing (debounced) as well as on 'change': the popup is destroyed as soon as
    // it loses focus, often before the input's 'change' event fires.
    const save = () => {
      clearTimeout(timer);
      updateProfileField(username, field, input.value)
        .then((list) => {
          // Keep search results current without re-rendering the cell being typed in.
          if (Array.isArray(list)) lastRenderedProfiles = Core.deduplicateProfiles(list);
        })
        .catch((err) => {
          showStatus((err && err.message) || String(err), 'error');
        });
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(save, 300);
    });
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  }

  function iconButton(action, username, label, svgPath, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `row-btn ${extraClass || ''}`.trim();
    btn.setAttribute('data-action', action);
    btn.setAttribute('data-username', username);
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${svgPath}</svg>`;
    return btn;
  }

  function metricCell(value, badgeText, badgeClass, badgeTitle) {
    const td = document.createElement('td');
    td.className = 'col-num';
    const wrap = document.createElement('div');
    wrap.className = 'metric';
    const main = document.createElement('span');
    main.className = 'metric-main';
    main.textContent = value;
    const badge = document.createElement('span');
    badge.className = `metric-badge ${badgeClass}`;
    badge.textContent = badgeText;
    if (badgeTitle) badge.title = badgeTitle;
    wrap.append(main, badge);
    td.appendChild(wrap);
    return td;
  }

  function textCell(text, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function renderTable(profiles) {
    const list = Core.deduplicateProfiles(Array.isArray(profiles) ? profiles : []);
    if (isEditingTableCell()) {
      deferredProfiles = list;
      return;
    }
    lastRenderedProfiles = list;

    const warnCount = list.filter((p) => qualityOf(p).level === 'warn').length;
    if (profileCountEl) {
      profileCountEl.textContent = String(list.length);
    }
    const warnEl = document.getElementById('profile-warn-count');
    if (warnEl) {
      warnEl.textContent = `⚠ ${warnCount} to check`;
      warnEl.classList.toggle('hidden', warnCount === 0);
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
      td.colSpan = 11;
      td.className = 'empty-state';
      td.textContent = 'No profiles yet. Open an Instagram profile and press "Scrape Profile" next to the username.';
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
      return;
    }

    const q = searchQuery.trim().toLowerCase().replace(/^@/, '');
    const visible = q
      ? list.filter((p) =>
          String(p.username || '').toLowerCase().includes(q) ||
          String(p.contactInfo || '').toLowerCase().includes(q) ||
          String(p.pricePerReel || '').toLowerCase().includes(q))
      : list;

    if (visible.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.className = 'empty-state';
      td.textContent = `No profile matches "${searchQuery}".`;
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
      return;
    }

    visible.forEach((item) => {
      const tr = document.createElement('tr');
      const username = String(item.username || '');
      const profileUrl = item.profileUrl || `https://www.instagram.com/${encodeURIComponent(username)}/`;
      const quality = qualityOf(item);
      if (quality.level === 'warn') tr.classList.add('row-warn');

      // Column 1: USERNAME (+ avatar, meta, flags)
      const tdUser = document.createElement('td');
      tdUser.className = 'cell-username';
      const userCell = document.createElement('div');
      userCell.className = 'user-cell';
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.style.background = avatarStyleFor(username);
      avatar.textContent = (username.replace(/^[^a-zA-Z0-9]+/, '').charAt(0) || '?').toUpperCase();
      const userText = document.createElement('div');
      userText.className = 'user-text';
      const link = document.createElement('a');
      link.href = profileUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'user-profile-link';
      link.title = `Open @${username} on Instagram`;
      link.textContent = username;
      const meta = document.createElement('div');
      meta.className = 'user-meta';
      const parts = [];
      if (Number(item.postsAnalyzed) > 0) parts.push(`${item.postsAnalyzed} reel${Number(item.postsAnalyzed) === 1 ? '' : 's'}`);
      const src = sourceLabel(item.dataSource);
      if (src) parts.push(src);
      const ago = timeAgo(item.editedAt || item.scrapedAt);
      if (ago) parts.push(ago);
      const metaText = document.createElement('span');
      metaText.textContent = parts.join(' · ');
      meta.appendChild(metaText);
      if (item.manuallyEdited) {
        const edited = document.createElement('span');
        edited.className = 'flag flag-edited';
        edited.textContent = '✎ edited';
        meta.appendChild(edited);
      }
      if (quality.level === 'warn') {
        const warnBtn = document.createElement('button');
        warnBtn.type = 'button';
        warnBtn.className = 'flag flag-warn';
        warnBtn.setAttribute('data-action', 'edit');
        warnBtn.setAttribute('data-username', username);
        warnBtn.textContent = '⚠ check';
        warnBtn.title = `${quality.issues.join('\n')}\n\nClick to review & fix.`;
        meta.appendChild(warnBtn);
      }
      userText.append(link, meta);
      userCell.append(avatar, userText);
      tdUser.appendChild(userCell);

      // Column 2: Follower
      const tdFollowers = textCell(Core.formatNumberWithCommas(item.followers), 'col-num');

      // Column 3: ER + Follower Benchmark Badge
      const erBenchInfo = Core.getErBenchmark(item.followers, item.er);
      const erBadgeClass = erBenchInfo.aboveBenchmark
        ? 'crow-badge-good'
        : Number(item.er || 0) >= erBenchInfo.benchmark * 0.5
          ? 'crow-badge-low'
          : 'crow-badge-bad';
      const tdEr = metricCell(
        item.erFormatted || (Number(item.er || 0).toFixed(2) + '%'),
        `${erBenchInfo.aboveBenchmark ? '≥' : '<'}${erBenchInfo.formatted}`,
        erBadgeClass,
        `Benchmark for ${erBenchInfo.tier} followers: ${erBenchInfo.formatted}`
      );

      // Column 4: V.R. + View Rate Band Badge
      const vrBandInfo = Core.getViewRateBand(item.vr);
      const tdVr = metricCell(
        item.vrFormatted || (Number(item.vr || 0).toFixed(2) + '%'),
        vrBandInfo.band,
        getVrBadgeClass(vrBandInfo.band),
        `View Rate band: ${vrBandInfo.band} (${vrBandInfo.range})`
      );

      // Columns 5-8
      const tdViews = textCell(
        (typeof item.avgViewsFormatted === 'string' && item.avgViewsFormatted)
          ? item.avgViewsFormatted
          : Core.formatCompactCount(item.avgViews),
        'col-num'
      );
      const tdLikes = textCell(Core.formatNumberWithCommas(item.avgLikes), 'col-num');
      const tdComments = textCell(Core.formatNumberWithCommas(item.avgComments), 'col-num');
      const tdLpc = textCell(Core.formatLikesPerComment(item.likesPerComment), 'col-num');

      // Column 9: Price/REEL
      const tdPrice = document.createElement('td');
      tdPrice.className = 'col-price';
      const priceInput = document.createElement('input');
      priceInput.type = 'text';
      priceInput.className = 'price-reel-input cell-input';
      priceInput.value = item.pricePerReel !== undefined && item.pricePerReel !== null ? String(item.pricePerReel) : '';
      priceInput.placeholder = '—';
      priceInput.title = 'Price/REEL';
      bindSavingInput(priceInput, username, 'pricePerReel');
      tdPrice.appendChild(priceInput);

      // Column 10: ID/Phone
      const tdContact = document.createElement('td');
      tdContact.className = 'col-contact';
      const contactInput = document.createElement('input');
      contactInput.type = 'text';
      contactInput.className = 'contact-input cell-input';
      contactInput.value = item.contactInfo !== undefined && item.contactInfo !== null ? String(item.contactInfo) : '';
      contactInput.placeholder = 'Add ID / phone';
      contactInput.title = 'ID / Phone number';
      bindSavingInput(contactInput, username, 'contactInfo');
      tdContact.appendChild(contactInput);

      // Column 11: actions
      const tdAction = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        iconButton('edit', username, `Edit @${username} (fix wrong numbers)`,
          '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>'),
        iconButton('rescrape', username, `Re-scrape @${username} fresh`,
          '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
        iconButton('delete', username, `Remove @${username}`,
          '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>',
          'delete-row-btn row-btn-danger')
      );
      tdAction.appendChild(actions);

      tr.append(tdUser, tdFollowers, tdEr, tdVr, tdViews, tdLikes, tdComments, tdLpc, tdPrice, tdContact, tdAction);
      tbodyEl.appendChild(tr);
    });
  }

  if (tbodyEl) {
    tbodyEl.addEventListener('click', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!target) return;
      const username = target.getAttribute('data-username') || '';
      const action = target.getAttribute('data-action');
      if (action === 'edit') {
        openEditor(username);
      } else if (action === 'rescrape') {
        requestFreshRescrape(username);
      } else if (action === 'delete') {
        removeProfile(username).catch((err) => showStatus((err && err.message) || String(err), 'error'));
      }
    });
    tbodyEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (deferredProfiles && !isEditingTableCell()) {
          const list = deferredProfiles;
          deferredProfiles = null;
          renderTable(list);
        }
      }, 0);
    });
  }

  const searchInput = document.getElementById('popup-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderTable(lastRenderedProfiles);
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
          const quality = Core.assessProfileQuality(m);
          if (quality.level === 'warn') {
            showStatus(
              `⚠ @${m.username} may be mis-scraped: ${quality.issues[0]} Use ✎ to fix it or ↻ to re-scrape fresh.`,
              'warn'
            );
          } else {
            showStatus(
              `Scraped @${m.username}: ${Core.formatNumberWithCommas(m.followers)} followers · ER ${m.erFormatted} (${m.erAboveBenchmark ? '≥' : '<'}${m.erBenchmarkFormatted}) · V.R. ${m.vrFormatted} (${m.vrBand})`,
              'success'
            );
          }
        }

        chrome.tabs.sendMessage(
          activeTab.id,
          { type: 'SCRAPE_CURRENT_PROFILE', excludeMostRecent },
          (response) => {
            if (chrome.runtime.lastError || !response) {
              if (chrome.scripting && chrome.scripting.executeScript) {
                chrome.scripting.insertCSS(
                  { target: { tabId: activeTab.id }, files: ['src/content.css', 'src/editor.css'] },
                  () => {
                    chrome.scripting.executeScript(
                      { target: { tabId: activeTab.id }, files: ['src/core.js', 'src/editor.js', 'src/content.js'] },
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
