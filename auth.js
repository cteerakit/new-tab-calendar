/**
 * Uses chrome.identity.getAuthToken so Google performs token exchange and refresh.
 * Manual PKCE + fetch(token) fails for Chrome Extension OAuth clients ("client_secret is missing").
 */

function getManifestClientId() {
  const id = chrome.runtime.getManifest().oauth2?.client_id;
  if (!id || String(id).includes("YOUR_GOOGLE_OAUTH")) {
    throw new Error(
      "Set oauth2.client_id in manifest.json to your Chrome Extension OAuth client ID."
    );
  }
  return id;
}

function explainIdentityOAuthError(message) {
  if (typeof message !== "string") {
    return message;
  }
  const extId = chrome.runtime.id;
  if (/bad client id/i.test(message)) {
    return `${message} In Google Cloud Console, create credentials of type "Chrome extension" (not Web application), paste this Extension ID in the form, then put the new client ID in manifest.json oauth2.client_id. This extension’s ID: ${extId}`;
  }
  if (/deleted[_ ]client/i.test(message)) {
    return `${message}. Often the OAuth client is fine in Google Cloud but the Chrome extension OAuth "Item ID" does not match this install’s id (${extId}). Use chrome://extensions on the Web Store build and ensure that id matches the OAuth client; remove a mismatched manifest "key" for store updates. If the client was deleted, create a new Chrome extension OAuth client and update manifest.json oauth2.client_id.`;
  }
  return message;
}

function getAuthTokenDetails(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(explainIdentityOAuthError(chrome.runtime.lastError.message)));
        return;
      }
      resolve(token ?? null);
    });
  });
}

function removeCachedAuthTokenPromise(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

function clearAllCachedAuthTokensPromise() {
  return new Promise((resolve) => {
    if (typeof chrome.identity.clearAllCachedAuthTokens === "function") {
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
    } else {
      resolve();
    }
  });
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

export async function signInWithGoogle() {
  getManifestClientId();
  const token = await getAuthTokenDetails(true);
  if (!token) {
    throw new Error("Sign-in did not return an access token.");
  }
  return token;
}

export async function getStoredToken() {
  try {
    getManifestClientId();
    return await getAuthTokenDetails(false);
  } catch {
    return null;
  }
}

/**
 * After a 401, drop the cached token so the next getAuthToken(false) can mint a fresh one.
 */
export async function recoverSessionAfterUnauthorized() {
  try {
    const old = await getAuthTokenDetails(false);
    if (old) {
      await removeCachedAuthTokenPromise(old);
    }
  } catch {
    // No cached token or already invalid.
  }
  try {
    return await getAuthTokenDetails(false);
  } catch {
    return null;
  }
}

export async function signOut() {
  let token = null;
  try {
    token = await getAuthTokenDetails(false);
  } catch {
    // ignore
  }
  if (token) {
    await revokeToken(token);
    await removeCachedAuthTokenPromise(token);
  }
  await clearAllCachedAuthTokensPromise();
}
