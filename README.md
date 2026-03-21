# New Tab Calendar (Chrome Extension, MV3)

A minimal-dependency Chrome extension that replaces the new tab page with:

- Current time and date
- Upcoming events from your **primary Google Calendar**
- Google sign-in, refresh, and sign-out actions

## Features

- Manifest V3 compliant
- Uses `chrome.identity.launchWebAuthFlow` for OAuth 2.0 sign-in
- Uses Google Calendar API `events.list` for upcoming events
- No framework/build step (plain HTML/CSS/JavaScript)

## Files

- `manifest.json`: MV3 configuration and permissions
- `newtab.html`: New tab page layout
- `styles.css`: UI styling
- `newtab.js`: UI logic, clock, and event rendering
- `auth.js`: OAuth flow and token storage
- `calendar.js`: Google Calendar API request
- `config.js`: local OAuth client ID
- `config.example.js`: template config

## Setup

1. Create a Google Cloud project.
2. Enable the **Google Calendar API**.
3. Configure OAuth consent screen.
4. Create OAuth credentials for a **Chrome Extension** use case.
5. Set extension redirect URI:
   - The extension computes redirect URI from `chrome.identity.getRedirectURL()`.
   - Load the extension once and use that exact URI in Google Cloud allowed redirects.
6. Open `config.js` and set:
   - `googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com"`

## Load extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`new-tab-calendar`).
5. Open a new tab.

## Permissions used

- `identity`: Google OAuth sign-in flow
- `storage`: Save access token and expiry
- `https://www.googleapis.com/*`: Calendar API calls

## Notes

- The extension requests only:
  - `https://www.googleapis.com/auth/calendar.readonly`
- Access tokens are stored locally and cleared on sign-out.
- If a token expires, the extension prompts for sign-in again.
