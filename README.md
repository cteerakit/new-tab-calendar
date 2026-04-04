# New Tab Calendar (Chrome Extension, MV3)

A minimal-dependency Chrome extension that replaces the new tab page with:

- Current time and date
- Upcoming events from one or more selected Google Calendars
- Configurable event sync window (next 7, 14, or 30 days)
- Google sign-in, refresh, and sign-out actions

## Features

- Manifest V3 compliant
- Uses `chrome.identity.getAuthToken` for OAuth 2.0 (Chrome-managed token exchange and refresh)
- Uses Google Calendar API `calendarList.list` and `events.list`
- No framework/build step (plain HTML/CSS/JavaScript)

## Files

- `manifest.json`: MV3 configuration and permissions
- `newtab.html`: New tab page layout
- `styles.css`: UI styling
- `newtab.js`: UI logic, clock, and event rendering
- `auth.js`: OAuth flow and token storage
- `calendar.js`: Google Calendar API requests (list calendars + fetch events)
- `config.js` / `config.example.js`: optional local settings (OAuth client ID lives in `manifest.json`)

## Setup

1. Create a Google Cloud project.
2. Enable the **Google Calendar API**.
3. Configure OAuth consent screen.
4. Create OAuth credentials in Google Cloud:
   - Type must be **Chrome extension** (not “Web application” or “Desktop”). `chrome.identity.getAuthToken` only accepts a Chrome-extension OAuth client for your add-on’s ID.
   - **Extension ID**: On `chrome://extensions` (Developer mode on), copy the **ID** string for this extension and paste it into the credential form. It must match exactly—if you change the unpacked folder or remove the manifest `key`, the ID can change and the old client ID will fail with `bad client id`.
   - Note for Chrome Web Store submissions: the Web Store–signed extension can have a different ID than your local `Load unpacked` install. After you install the *published* (or draft) Web Store version, copy its `chrome://extensions` ID and create/update the OAuth client using that ID.
5. In [`manifest.json`](manifest.json), set `oauth2.client_id` to the **Chrome extension** client ID Google shows (ends in `.apps.googleusercontent.com`).

### Chrome Web Store listing vs `Load unpacked`

For an extension **already on the Chrome Web Store**, Google recommends **not** putting a `key` field in [`manifest.json`](manifest.json). The store keeps a fixed extension ID for your listing.

The OAuth client’s **Item ID** in Google Cloud must match `chrome.runtime.id` for the install you are testing. For this product, the Web Store extension ID (and the Item ID on your OAuth client) is:

`anpfninbojfdndpakcljmlepdlmgmpdk`

If you previously added a manifest `key` from another machine or an old package, it can imply a **different** extension ID than the live listing. That mismatch breaks `chrome.identity.getAuthToken` (often reported as OAuth failures). This repo omits `key` so store updates stay aligned with the listing.

**Local development:** `Load unpacked` without `key` usually gives an ID that is **not** `anpfninbojfdndpakcljmlepdlmgmpdk`, so sign-in with the production OAuth client will fail. Test sign-in with the **Web Store–installed** build, or create a separate **Chrome extension** OAuth client for your dev extension ID.

### Before Chrome Web Store upload

Ensure `oauth2.client_id` in [`manifest.json`](manifest.json) matches your Google Cloud **Chrome extension** client. The packaging script refuses to zip if `client_id` still contains the placeholder `YOUR_GOOGLE_OAUTH`.

### If sign-in says `bad client id`

- You almost certainly used a **Web** (or other) client ID, or a Chrome-extension client tied to a **different** extension ID.
- Fix: create a **new** OAuth client ID of type **Chrome extension**, enter the current extension ID from `chrome://extensions`, replace `oauth2.client_id` in the manifest with the new value, then reload the extension.

### If sign-in says `deleted_client`

- The OAuth credential is commonly deleted/disabled in Google Cloud, or it was created for a different extension ID than the one currently installed.
- Fix: create a NEW OAuth client ID of type **Chrome extension** for the installed extension (use the `chrome://extensions` ID for the Web Store-installed version), update `oauth2.client_id` in `manifest.json`, and re-upload a new store package.

## Load extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`new-tab-calendar`).
5. Open a new tab.

## Permissions used

- `identity`: Google OAuth sign-in flow
- `storage`: Settings and cached events (Google tokens are cached by Chrome for the `identity` API)
- `https://www.googleapis.com/*`: Calendar API calls

## Notes

- The extension requests only:
  - `https://www.googleapis.com/auth/calendar.readonly`
- Google access tokens are held in Chrome’s identity cache; sign-out revokes and clears that cache.
- Token refresh is handled by Chrome when you call `getAuthToken` with `interactive: false`.
- Use the settings button in the events header to choose which calendars sync.
- Use the same settings panel to set how far ahead events are synced (7/14/30 days).
