# Changelog

## v1.1.0 — Bug-fix release

### Scraping accuracy
- The profile's **Reels tab link** was counted as a fake 0-view reel whenever the DOM fallback was used, taking one of the 6 slots and dragging ER / V.R. down. Only real post/reel links are read now.
- The Reels-tab step could click the **global Reels feed** link in the sidebar and read random reels; it now only uses the scraped profile's own Reels tab.
- An exact API play count is no longer overridden by a larger (mis-parsed or mis-paired) DOM badge.
- **AV VIEW / V.R.** no longer average in reels whose view count couldn't be read (they counted as 0 views).
- **Private / empty profiles** are no longer saved as `ER 0.00%` / `Very low` rows (and auto-synced over good data); you get a clear error instead.
- Navigating to another profile mid-scrape no longer saves mixed data or writes profile A's result onto profile B's button.
- More Instagram number formats: Spanish/Portuguese (`12,3 mil`, `1,2 mi`, `millones`, `milhões`), Arabic (`مليون`, `ألف`), Russian (`тыс.`, `млн`), Indonesian (`rb`, `jt`), German `Tsd.`.

### Reliability
- After the extension is **updated or reloaded**, an already-open Instagram tab no longer keeps a dead "Scrape Profile" button: a re-injected script takes over, and an orphaned one tells you to refresh the tab.
- Storage writes inside a page are serialized (a scrape finishing during a price edit can't overwrite it), storage errors are shown instead of failing silently, and the page observer is throttled to one pass per frame.
- Price/REEL edits in the popup are saved while typing (the popup closing before the field lost focus used to drop the edit).
- **Clear List** asks for confirmation (popup and in-page panel).
- The toolbar badge is restored after a browser restart; failed auto-syncs are now reported in the panel.
- The popup only treats real `instagram.com` tabs as Instagram tabs.

### Google Sheet sync
- The generated Apps Script **ignores the target sheet sent by the caller** (anyone with the `/exec` URL could make it rewrite another spreadsheet the owner can edit) and requires a per-install **sync token**. Re-copy the script and redeploy after updating.
- It refuses to overwrite row 1 of a sheet that isn't a Crow Scrapper sheet, escapes `HYPERLINK()` values, skips invalid usernames, and keeps the Price/REEL of duplicate rows it deletes (including a `0` price).
- A Price/REEL typed in the sheet now wins over the extension's copy (as the README always promised).
- An HTML error page from Apps Script is no longer reported as a successful sync.
- Syncs run one at a time (overlapping syncs could append the same profile twice) and time out after 60 s; Sheets-API mode reports duplicates it finds instead of always saying "0 duplicates".

### Exports
- CSV cells that look like formulas (e.g. a Price/REEL starting with `=`) are neutralized; characters that are illegal in XML are stripped so Excel never rejects the `.xlsx`.

## v1.0.0
- Initial release.
