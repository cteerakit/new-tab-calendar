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
5. In [`manifest.json`](manifest.json), set `oauth2.client_id` to the **Chrome extension** client ID Google shows (ends in `.apps.googleusercontent.com`).

### If sign-in says `bad client id`

- You almost certainly used a **Web** (or other) client ID, or a Chrome-extension client tied to a **different** extension ID.
- Fix: create a **new** OAuth client ID of type **Chrome extension**, enter the current extension ID from `chrome://extensions`, replace `oauth2.client_id` in the manifest with the new value, then reload the extension.

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
