/**
 * Crow Scrapper (by @mhrshadfm) — shared "Edit profile" dialog.
 * Used by both the in-page Instagram panel (content script) and the toolbar popup.
 *
 * Lets the user fix a wrongly scraped row: followers, the three averages, every reel that was
 * averaged (views / likes / comments / include), Price/REEL and ID/Phone. ER, V.R., bands and
 * Likes-per-Comment are recalculated live with the same Core math used for scraping.
 */
(function (root) {
  'use strict';

  let openInstance = null;

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatPlain(num) {
    const n = Math.round(Number(num) || 0);
    return n > 0 ? n.toLocaleString('en-US') : '0';
  }

  function vrBadgeClass(band) {
    const b = String(band || '').toLowerCase();
    if (b === 'very high') return 'crow-badge-vhigh';
    if (b === 'high') return 'crow-badge-high';
    if (b === 'medium') return 'crow-badge-med';
    if (b === 'low') return 'crow-badge-low';
    return 'crow-badge-vlow';
  }

  function initialOf(username) {
    const ch = String(username || '?').replace(/^[^a-zA-Z0-9]+/, '').charAt(0) || '?';
    return ch.toUpperCase();
  }

  /**
   * Opens the edit dialog.
   * @param {{
   *   doc?: Document,
   *   Core: object,
   *   profile: object,
   *   onSave: (record: object) => Promise<void>|void,
   *   onRescrape?: (profile: object) => void,
   *   onDelete?: (profile: object) => Promise<void>|void,
   *   rescrapeLabel?: string
   * }} options
   * @returns {{ close: () => void }}
   */
  function open(options) {
    const opts = options || {};
    const doc = opts.doc || root.document;
    const Core = opts.Core || root.InstaScraperCore;
    const profile = opts.profile || {};
    if (!doc || !Core) return { close() {} };

    if (openInstance) openInstance.close();

    const username = String(profile.username || '');
    const reels = Array.isArray(profile.reels) ? profile.reels.map((r) => ({ ...r })) : [];
    let averagesFollowReels = reels.length > 0;

    const overlay = el(doc, 'div', 'crow-ed-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Edit @${username}`);

    const dialog = el(doc, 'div', 'crow-ed-dialog');
    overlay.appendChild(dialog);

    // ---------- header
    const head = el(doc, 'div', 'crow-ed-head');
    const avatar = el(doc, 'div', 'crow-ed-avatar', initialOf(username));
    const titleWrap = el(doc, 'div', 'crow-ed-titlewrap');
    const title = el(doc, 'h3', 'crow-ed-title');
    title.append('Edit ');
    const userLink = el(doc, 'a', 'crow-ed-userlink', `@${username}`);
    userLink.href = profile.profileUrl || `https://www.instagram.com/${encodeURIComponent(username)}/`;
    userLink.target = '_blank';
    userLink.rel = 'noopener noreferrer';
    title.appendChild(userLink);
    const subtitle = el(
      doc,
      'p',
      'crow-ed-subtitle',
      'Fix any wrong number — ER, V.R. and Likes/Comment recalculate instantly.'
    );
    titleWrap.append(title, subtitle);
    const closeX = el(doc, 'button', 'crow-ed-x', '×');
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close');
    head.append(avatar, titleWrap, closeX);
    dialog.appendChild(head);

    // ---------- quality warnings
    const quality = typeof Core.assessProfileQuality === 'function'
      ? Core.assessProfileQuality({ ...profile, manuallyEdited: false })
      : { issues: [] };
    if (quality.issues.length > 0) {
      const warn = el(doc, 'div', 'crow-ed-warn');
      const strong = el(doc, 'strong', '', '⚠ This row may be wrong');
      const list = el(doc, 'ul');
      quality.issues.forEach((issue) => list.appendChild(el(doc, 'li', '', issue)));
      warn.append(strong, list);
      dialog.appendChild(warn);
    }

    const body = el(doc, 'div', 'crow-ed-body');
    dialog.appendChild(body);

    // ---------- fields
    function field(labelText, value, opts2) {
      const o = opts2 || {};
      const wrap = el(doc, 'label', `crow-ed-field${o.wide ? ' crow-ed-field-wide' : ''}`);
      const label = el(doc, 'span', 'crow-ed-label', labelText);
      const input = el(doc, 'input', 'crow-ed-input');
      input.type = 'text';
      input.value = value;
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (o.placeholder) input.placeholder = o.placeholder;
      if (o.inputMode) input.inputMode = o.inputMode;
      wrap.append(label, input);
      if (o.hint) wrap.appendChild(el(doc, 'span', 'crow-ed-hint', o.hint));
      return { wrap, input };
    }

    const grid = el(doc, 'div', 'crow-ed-grid');
    const fFollowers = field('Followers', formatPlain(profile.followers), {
      inputMode: 'numeric',
      hint: 'Accepts 12,345 · 12.3K · 1.2M'
    });
    const fViews = field('AV VIEW', formatPlain(profile.avgViews), { inputMode: 'numeric' });
    const fLikes = field('AV LIKE', formatPlain(profile.avgLikes), { inputMode: 'numeric' });
    const fComments = field('AV COMMENTS', formatPlain(profile.avgComments), { inputMode: 'numeric' });
    const fPrice = field('Price/REEL', String(profile.pricePerReel || ''), { placeholder: 'e.g. 20M' });
    const fContact = field('ID/Phone', String(profile.contactInfo || ''), {
      placeholder: '@id, phone or email',
      wide: true
    });
    grid.append(fFollowers.wrap, fViews.wrap, fLikes.wrap, fComments.wrap, fPrice.wrap, fContact.wrap);
    body.appendChild(grid);

    // ---------- reels
    const reelInputs = [];
    let reelsNote = null;
    if (reels.length > 0) {
      const section = el(doc, 'div', 'crow-ed-reels');
      const sh = el(doc, 'div', 'crow-ed-reels-head');
      sh.append(
        el(doc, 'strong', '', `Reels used for the averages (${reels.length})`),
        el(doc, 'span', '', 'Correct a reel or untick it to leave it out — open it to compare.')
      );
      section.appendChild(sh);

      const table = el(doc, 'table', 'crow-ed-table');
      const thead = el(doc, 'thead');
      const hr = el(doc, 'tr');
      ['#', 'Reel', 'Views', 'Likes', 'Comments', 'Use'].forEach((h) => hr.appendChild(el(doc, 'th', '', h)));
      thead.appendChild(hr);
      const tbody = el(doc, 'tbody');
      reels.forEach((reel, idx) => {
        const tr = el(doc, 'tr');
        if (reel.excluded) tr.classList.add('crow-ed-row-off');
        tr.appendChild(el(doc, 'td', 'crow-ed-idx', String(idx + 1)));
        const tdLink = el(doc, 'td');
        if (reel.url) {
          const a = el(doc, 'a', 'crow-ed-reel-link', reel.shortcode ? reel.shortcode.slice(0, 11) : 'open');
          a.href = reel.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.title = 'Open this reel on Instagram';
          tdLink.appendChild(a);
        } else {
          tdLink.appendChild(el(doc, 'span', 'crow-ed-muted', reel.shortcode ? reel.shortcode.slice(0, 11) : '—'));
        }
        if (reel.viewsSuspect) {
          const flag = el(doc, 'span', 'crow-ed-flag', '!');
          flag.title = 'The view count read for this reel looked wrong (lower than its likes) and was ignored.';
          tdLink.appendChild(flag);
        }
        tr.appendChild(tdLink);

        const mk = (key) => {
          const td = el(doc, 'td');
          const input = el(doc, 'input', 'crow-ed-cell');
          input.type = 'text';
          input.inputMode = 'numeric';
          input.value = formatPlain(reel[key]);
          input.setAttribute('aria-label', `Reel ${idx + 1} ${key}`);
          td.appendChild(input);
          tr.appendChild(td);
          return input;
        };
        const views = mk('views');
        const likes = mk('likes');
        const comments = mk('comments');
        const tdUse = el(doc, 'td');
        const use = el(doc, 'input', 'crow-ed-check');
        use.type = 'checkbox';
        use.checked = !reel.excluded;
        use.setAttribute('aria-label', `Use reel ${idx + 1}`);
        tdUse.appendChild(use);
        tr.appendChild(tdUse);
        tbody.appendChild(tr);
        reelInputs.push({ tr, views, likes, comments, use });
      });
      table.append(thead, tbody);
      const scroller = el(doc, 'div', 'crow-ed-table-wrap');
      scroller.appendChild(table);
      section.appendChild(scroller);
      reelsNote = el(doc, 'p', 'crow-ed-note');
      section.appendChild(reelsNote);
      body.appendChild(section);
    }

    // ---------- live preview
    const preview = el(doc, 'div', 'crow-ed-preview');
    body.appendChild(preview);

    // ---------- footer
    const foot = el(doc, 'div', 'crow-ed-foot');
    const left = el(doc, 'div', 'crow-ed-foot-left');
    const right = el(doc, 'div', 'crow-ed-foot-right');
    if (typeof opts.onRescrape === 'function') {
      const rescrapeBtn = el(doc, 'button', 'crow-ed-btn crow-ed-btn-ghost', opts.rescrapeLabel || '↻ Re-scrape fresh');
      rescrapeBtn.type = 'button';
      rescrapeBtn.title = 'Reload this profile and scrape it again without any cached data';
      rescrapeBtn.addEventListener('click', () => {
        close();
        opts.onRescrape(profile);
      });
      left.appendChild(rescrapeBtn);
    }
    if (typeof opts.onDelete === 'function') {
      const delBtn = el(doc, 'button', 'crow-ed-btn crow-ed-btn-danger', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', async () => {
        const ok = typeof root.confirm !== 'function' || root.confirm(`Remove @${username} from the list?`);
        if (!ok) return;
        try {
          await opts.onDelete(profile);
          close();
        } catch (err) {
          showError(err);
        }
      });
      left.appendChild(delBtn);
    }
    const cancelBtn = el(doc, 'button', 'crow-ed-btn crow-ed-btn-ghost', 'Cancel');
    cancelBtn.type = 'button';
    const saveBtn = el(doc, 'button', 'crow-ed-btn crow-ed-btn-primary', 'Save changes');
    saveBtn.type = 'button';
    right.append(cancelBtn, saveBtn);
    foot.append(left, right);
    dialog.appendChild(foot);

    const errorLine = el(doc, 'p', 'crow-ed-error');
    errorLine.hidden = true;
    dialog.insertBefore(errorLine, foot);

    function showError(err) {
      errorLine.hidden = false;
      errorLine.textContent = (err && err.message) || String(err);
    }

    // ---------- logic
    function currentReels() {
      return reels.map((r, i) => {
        const ri = reelInputs[i];
        return {
          ...r,
          views: Core.parseCount(ri.views.value),
          likes: Core.parseCount(ri.likes.value),
          comments: Core.parseCount(ri.comments.value),
          excluded: !ri.use.checked
        };
      });
    }

    function collectEdits() {
      const edits = {
        followers: Core.parseCount(fFollowers.input.value),
        avgViews: Core.parseCount(fViews.input.value),
        avgLikes: Core.parseCount(fLikes.input.value),
        avgComments: Core.parseCount(fComments.input.value),
        pricePerReel: fPrice.input.value,
        contactInfo: fContact.input.value
      };
      if (reels.length > 0) edits.reels = currentReels();
      return edits;
    }

    function syncAveragesFromReels() {
      if (!averagesFollowReels || reels.length === 0) return;
      const totals = Core.computeReelAverages(currentReels());
      fViews.input.value = formatPlain(totals.avgViews);
      fLikes.input.value = formatPlain(totals.avgLikes);
      fComments.input.value = formatPlain(totals.avgComments);
    }

    function renderPreview() {
      const next = Core.recalculateProfileMetrics(profile, collectEdits());
      preview.textContent = '';
      const chip = (label, value, badgeText, badgeClass) => {
        const c = el(doc, 'div', 'crow-ed-chip');
        c.append(el(doc, 'span', 'crow-ed-chip-label', label), el(doc, 'span', 'crow-ed-chip-value', value));
        if (badgeText) c.appendChild(el(doc, 'span', `crow-ed-chip-badge ${badgeClass || ''}`, badgeText));
        preview.appendChild(c);
      };
      chip('ER', next.erFormatted, `${next.erAboveBenchmark ? '≥' : '<'}${next.erBenchmarkFormatted}`,
        next.erAboveBenchmark ? 'crow-badge-good' : 'crow-badge-bad');
      chip('V.R.', next.vrFormatted, next.vrBand, vrBadgeClass(next.vrBand));
      chip('AV VIEW', next.avgViewsFormatted);
      chip('Likes / comment', Core.formatLikesPerComment(next.likesPerComment));
      if (reelsNote) {
        const used = reelInputs.filter((r) => r.use.checked).length;
        reelsNote.textContent = averagesFollowReels
          ? `Averages follow the ${used} ticked reel(s).`
          : 'You typed the averages directly — reel edits no longer change them.';
      }
      reelInputs.forEach((ri) => ri.tr.classList.toggle('crow-ed-row-off', !ri.use.checked));
      saveBtn.disabled = !(next.followers > 0);
      saveBtn.title = next.followers > 0 ? '' : 'Followers must be greater than 0';
    }

    reelInputs.forEach((ri) => {
      [ri.views, ri.likes, ri.comments].forEach((input) => {
        input.addEventListener('input', () => {
          syncAveragesFromReels();
          renderPreview();
        });
      });
      ri.use.addEventListener('change', () => {
        syncAveragesFromReels();
        renderPreview();
      });
    });
    [fViews.input, fLikes.input, fComments.input].forEach((input) => {
      input.addEventListener('input', () => {
        averagesFollowReels = false;
        renderPreview();
      });
    });
    [fFollowers.input, fPrice.input, fContact.input].forEach((input) => {
      input.addEventListener('input', renderPreview);
    });

    async function save() {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const record = Core.recalculateProfileMetrics(profile, collectEdits());
        await opts.onSave(record);
        close();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save changes';
        showError(err);
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    }

    function close() {
      doc.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (openInstance && openInstance.overlay === overlay) openInstance = null;
    }

    closeX.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    saveBtn.addEventListener('click', save);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
    // Keep Instagram's own shortcuts / SPA handlers from seeing typing inside the dialog.
    ['keydown', 'keyup', 'keypress', 'click'].forEach((type) => {
      dialog.addEventListener(type, (e) => {
        if (!(type === 'keydown' && e.key === 'Escape')) e.stopPropagation();
      });
    });
    doc.addEventListener('keydown', onKey, true);

    (doc.body || doc.documentElement).appendChild(overlay);
    renderPreview();
    setTimeout(() => {
      try {
        fFollowers.input.focus();
        fFollowers.input.select();
      } catch (_err) {
        // ignore
      }
    }, 0);

    openInstance = { overlay, close };
    return { close };
  }

  const api = { open };
  root.CrowEditor = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this);
