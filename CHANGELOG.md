# Changelog

## v1.2.0 — Edit & fix rows, ID/Phone column, new top panel

### Fix wrongly scraped profiles
- **✎ Edit** on every row (in the Instagram panel and the popup): correct followers, AV VIEW / AV LIKE / AV COMMENTS, or each of the reels that were averaged (change its numbers or untick it). ER, V.R., bands and Likes/Comment recalculate live; edited rows are marked "✎ edited" until the next re-scrape.
- **↻ Re-scrape fresh**: reloads the profile and scrapes it again automatically. Before, scraping again on the same page could reuse stale page data and give the same wrong numbers.
- Instagram API calls are made with `cache: 'no-store'`, so a re-scrape never receives a cached answer.
- Each row now shows how many reels were read, where the numbers came from (API / page data / page tiles) and when it was scraped.
- **⚠ check** flags rows that look mis-scraped: likes above views, views equal to comments, V.R. above 1,500%, ER above 60%, fewer than 3 reels, unreadable views, or the page-tile fallback. The edit dialog lists the reasons.
- A reel whose "views" are lower than its likes (a misread tile number, usually the comment count) is no longer averaged in as views.

### Reel views read from the page (when Instagram's API doesn't answer)
- **Fixed:** scraping from a profile's main **Posts** grid read every reel's view count as its **comment count** (the number next to the first unlabeled icon in the hover overlay), so the row ended up with **AV VIEW 0 / V.R. 0.00%** (e.g. @artin_vah).
- Reel tiles are now read by comparing what is visible **before and after hovering**: the only number on a reel tile without hovering is its view badge; hovering adds likes and comments; on a reel, views are always the largest number; icon labels (eye / heart / comment) win when present. On the Posts grid, where Instagram shows no views, views stay "unknown" instead of being guessed.
- The **Reels-tab step** (used to get the view badges) waits up to 6 s for the tab to load and reads only the view badges, instead of re-guessing after a fixed 0.8 s.
- Hover overlays are closed again after reading each tile, so they can't leak into later reads.
- When the numbers come from the page tiles, the ⚠ reasons say **why Instagram's API didn't answer** (e.g. "too many requests (HTTP 429) — wait a few minutes, then re-scrape").

### ID / Phone column
- New **ID/Phone** column after Price/REEL in the panel, popup, Excel (column J), CSV and Google Sheet (Apps Script and Sheets API). Like Price/REEL, it survives re-scrapes, and a value typed in the sheet wins.
- Phone numbers stay text everywhere: `+98 912…` is never evaluated as a formula and leading zeros are kept.
- Re-copy and redeploy the Google Apps Script once to get the new column in your sheet.

### New in-page panel
- The list now lives behind a small **crow icon at the top of the screen**. Click it to open the list under the icon; minimize (or press `Esc`) to shrink it back to just the icon. The icon can be dragged anywhere and its position and open/closed state are remembered.
- **Resizable list window:** drag its side edge, its bottom edge (top edge when it opens upward) or the corner grip to make it as wide/tall as you like. The size is remembered; double-click an edge to go back to the automatic size. With the keyboard: focus an edge with `Tab`, use the arrow keys, `Enter` resets. In a narrow window the header wraps and long labels hide, and the table scrolls inside.
- The list opens lined up with the icon's left edge when the icon is on the left half of the screen (right edge otherwise), so it never jumps away from the icon.
- Search by username, ID or phone; sort by newest, needs-a-check, followers, ER, V.R. or name; benchmarks behind an ⓘ button; sticky header and username column.
- Typing in a Price/REEL or ID/Phone cell no longer loses focus when the list refreshes.
- Restyled popup to match (dark, compact, same edit dialog).
- The panel no longer uses a `<header>` element, so the scraper can't mistake it for the Instagram profile header, and page styles can't distort its layout.

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
