export const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;

export function createTokenCache() {
  return new Map();
}

export async function exchangeOAuthCode({ code, clientId, clientSecret, fetchImpl = fetch }) {
  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "authorization_code");
  body.set("code", code);

  const response = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Discord token exchange failed (${response.status}): ${detail}`);
  }

  return response.json();
}

export async function getUserIdFromToken({ accessToken, cache, fetchImpl = fetch }) {
  const cached = cache.get(accessToken);
  if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
    return cached.userId;
  }

  const response = await fetchImpl("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Discord /users/@me failed (${response.status})`);
  }

  const { id } = await response.json();
  cache.set(accessToken, { userId: id, cachedAt: Date.now() });
  return id;
}
