const TOKEN_KEY = "google_access_token";
const TOKEN_EXPIRY_KEY = "google_access_token_expiry";
const REFRESH_TOKEN_KEY = "google_refresh_token";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const OAUTH_STATE_KEY = "oauth_pending_state";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function getConfigClientId() {
  if (globalThis.APP_CONFIG?.googleClientId) {
    return globalThis.APP_CONFIG.googleClientId;
  }
  throw new Error("Google OAuth client ID is missing. Configure APP_CONFIG.googleClientId.");
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

async function sha256Base64Url(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

async function buildAuthUrl(prompt) {
  const clientId = getConfigClientId();
  const redirectUri = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline"
  });
  if (prompt != null && prompt !== "") {
    params.set("prompt", prompt);
  }

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    pending: { state, codeVerifier }
  };
}

async function storePendingOAuthState(pending) {
  await chrome.storage.session.set({ [OAUTH_STATE_KEY]: pending });
}

async function clearPendingOAuthState() {
  await chrome.storage.session.remove([OAUTH_STATE_KEY]);
}

async function exchangeAuthorizationCode(code, codeVerifier) {
  const clientId = getConfigClientId();
  const redirectUri = chrome.identity.getRedirectURL();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error_description || json.error || "Token exchange failed");
  }
  return json;
}

async function persistTokenResponse(json) {
  const access_token = json.access_token;
  const expiresInSeconds = Number(json.expires_in ?? 0);
  const refresh_token = json.refresh_token;
  const expiryTimestampMs = Date.now() + expiresInSeconds * 1000;
  const updates = {
    [TOKEN_KEY]: access_token,
    [TOKEN_EXPIRY_KEY]: expiryTimestampMs
  };
  if (refresh_token) {
    updates[REFRESH_TOKEN_KEY] = refresh_token;
  }
  await chrome.storage.local.set(updates);
  return { token: access_token, expiresInSeconds, expiryTimestampMs };
}

async function parseAndConsumePendingFromRedirect(redirectedTo) {
  const url = new URL(redirectedTo);
  const params = url.searchParams;
  const oauthError = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");
  const data = await chrome.storage.session.get(OAUTH_STATE_KEY);
  const pending = data[OAUTH_STATE_KEY];
  await chrome.storage.session.remove([OAUTH_STATE_KEY]);

  if (oauthError) {
    throw new Error(`OAuth redirect error: ${oauthError}`);
  }
  if (!code) {
    throw new Error("Sign-in completed without an authorization code.");
  }
  if (
    !pending ||
    typeof pending.state !== "string" ||
    typeof pending.codeVerifier !== "string" ||
    !returnedState ||
    returnedState !== pending.state
  ) {
    throw new Error("OAuth state mismatch. Sign in again.");
  }
  return { code, codeVerifier: pending.codeVerifier };
}

async function completeAuthFromRedirect(redirectedTo) {
  const { code, codeVerifier } = await parseAndConsumePendingFromRedirect(redirectedTo);
  const json = await exchangeAuthorizationCode(code, codeVerifier);
  return persistTokenResponse(json);
}

async function refreshAccessTokenWithRefreshToken(refreshToken) {
  const clientId = getConfigClientId();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error_description || json.error || "Token refresh failed");
  }
  const access_token = json.access_token;
  const expiresInSeconds = Number(json.expires_in ?? 0);
  const newRefresh = json.refresh_token;
  const expiryTimestampMs = Date.now() + expiresInSeconds * 1000;
  const updates = {
    [TOKEN_KEY]: access_token,
    [TOKEN_EXPIRY_KEY]: expiryTimestampMs
  };
  if (newRefresh) {
    updates[REFRESH_TOKEN_KEY] = newRefresh;
  }
  await chrome.storage.local.set(updates);
  return access_token;
}

async function clearCredentialStorage() {
  await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY, REFRESH_TOKEN_KEY]);
}

export async function signInWithGoogle() {
  const { url, pending } = await buildAuthUrl("consent");
  await storePendingOAuthState(pending);
  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: true
  });

  if (!redirectedTo) {
    await clearPendingOAuthState();
    throw new Error("Sign-in did not return an OAuth redirect URL.");
  }

  const { token } = await completeAuthFromRedirect(redirectedTo);
  return token;
}

async function readCredentialsFromStorage() {
  const data = await chrome.storage.local.get([TOKEN_KEY, TOKEN_EXPIRY_KEY, REFRESH_TOKEN_KEY]);
  return {
    token: data[TOKEN_KEY],
    expiry: Number(data[TOKEN_EXPIRY_KEY] ?? 0),
    refreshToken: data[REFRESH_TOKEN_KEY]
  };
}

export async function getStoredToken() {
  const { token, expiry, refreshToken } = await readCredentialsFromStorage();
  const now = Date.now();
  const hasAccess = Boolean(token && expiry);
  const accessStale = hasAccess && now >= expiry - TOKEN_REFRESH_BUFFER_MS;

  if (!refreshToken) {
    if (!hasAccess) {
      await clearCredentialStorage();
      return null;
    }
    if (accessStale) {
      await clearCredentialStorage();
      return null;
    }
    return token;
  }

  if (!hasAccess || accessStale) {
    try {
      return await refreshAccessTokenWithRefreshToken(refreshToken);
    } catch {
      await clearCredentialStorage();
      return null;
    }
  }

  return token;
}

async function revokeToken(token) {
  if (!token) {
    return;
  }
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

export async function signOut() {
  const { token, refreshToken } = await readCredentialsFromStorage();
  await clearCredentialStorage();
  await revokeToken(token);
  await revokeToken(refreshToken);
}
