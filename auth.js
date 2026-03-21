const TOKEN_KEY = "google_access_token";
const TOKEN_EXPIRY_KEY = "google_access_token_expiry";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const OAUTH_STATE_KEY = "oauth_pending_state";

function getConfigClientId() {
  if (globalThis.APP_CONFIG?.googleClientId) {
    return globalThis.APP_CONFIG.googleClientId;
  }
  throw new Error("Google OAuth client ID is missing. Configure APP_CONFIG.googleClientId.");
}

function buildAuthUrl(prompt) {
  const clientId = getConfigClientId();
  const redirectUri = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    include_granted_scopes: "true",
    state
  });
  if (prompt != null && prompt !== "") {
    params.set("prompt", prompt);
  }

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state
  };
}

async function storePendingOAuthState(state) {
  await chrome.storage.session.set({ [OAUTH_STATE_KEY]: state });
}

async function clearPendingOAuthState() {
  await chrome.storage.session.remove([OAUTH_STATE_KEY]);
}

async function parseTokenFromRedirect(redirectedTo) {
  const hash = new URL(redirectedTo).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const oauthError = params.get("error");
  const token = params.get("access_token");
  const expiresInSeconds = Number(params.get("expires_in") ?? 0);
  const returnedState = params.get("state");
  const data = await chrome.storage.session.get(OAUTH_STATE_KEY);
  const expectedState = data[OAUTH_STATE_KEY];
  await chrome.storage.session.remove([OAUTH_STATE_KEY]);

  if (oauthError) {
    throw new Error(`OAuth redirect error: ${oauthError}`);
  }
  if (!token) {
    throw new Error("Sign-in completed without an access token.");
  }
  if (!expectedState || !returnedState || returnedState !== expectedState) {
    throw new Error("OAuth state mismatch. Sign in again.");
  }
  return { token, expiresInSeconds };
}

async function persistTokenFromRedirect(redirectedTo) {
  const { token, expiresInSeconds } = await parseTokenFromRedirect(redirectedTo);
  const expiryTimestampMs = Date.now() + expiresInSeconds * 1000;
  await chrome.storage.local.set({
    [TOKEN_KEY]: token,
    [TOKEN_EXPIRY_KEY]: expiryTimestampMs
  });
  return { token, expiresInSeconds, expiryTimestampMs };
}

async function refreshTokenSilently() {
  const { url, state } = buildAuthUrl("none");
  await storePendingOAuthState(state);
  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: false
  });
  if (!redirectedTo) {
    await clearPendingOAuthState();
    throw new Error("Silent token refresh did not return an OAuth redirect URL.");
  }
  const { token } = await persistTokenFromRedirect(redirectedTo);
  return token;
}

/** When prompt=none fails (common with implicit flow), re-auth with a visible flow; omit prompt so Google can reuse session. */
async function refreshTokenInteractive() {
  const { url, state } = buildAuthUrl();
  await storePendingOAuthState(state);
  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: true
  });
  if (!redirectedTo) {
    await clearPendingOAuthState();
    throw new Error("Interactive token refresh did not return an OAuth redirect URL.");
  }
  const { token } = await persistTokenFromRedirect(redirectedTo);
  return token;
}

export async function signInWithGoogle() {
  const { url, state } = buildAuthUrl("consent");
  await storePendingOAuthState(state);
  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: true
  });

  if (!redirectedTo) {
    await clearPendingOAuthState();
    throw new Error("Sign-in did not return an OAuth redirect URL.");
  }

  const { token } = await persistTokenFromRedirect(redirectedTo);
  return token;
}

async function readCredentialsFromStorage() {
  const data = await chrome.storage.local.get([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
  return {
    token: data[TOKEN_KEY],
    expiry: Number(data[TOKEN_EXPIRY_KEY] ?? 0)
  };
}

export async function getStoredToken() {
  const { token, expiry } = await readCredentialsFromStorage();
  const now = Date.now();
  const isMissingToken = !token || !expiry;
  const shouldRefresh = !isMissingToken && now >= expiry - TOKEN_REFRESH_BUFFER_MS;
  if (isMissingToken) {
    await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
    return null;
  }

  if (shouldRefresh) {
    try {
      return await refreshTokenSilently();
    } catch {
      try {
        return await refreshTokenInteractive();
      } catch {
        await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
        return null;
      }
    }
  }
  return token;
}

export async function signOut() {
  const { token } = await readCredentialsFromStorage();
  await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);

  if (token) {
    const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;
    try {
      await fetch(revokeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
    } catch {
      // Local sign-out should still work if revoke fails.
    }
  }
}
