export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path, { method = "GET", accessToken, body } = {}) {
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }
  return parsed;
}

export function exchangeAuthCode(code) {
  return apiFetch("/api/discord/token", { method: "POST", body: { code } });
}

export function getSessionState(token, accessToken) {
  return apiFetch(`/api/sessions/${encodeURIComponent(token)}`, { accessToken });
}

export function resolveCurrentSession(accessToken, channelId) {
  const query =
    channelId != null && channelId !== ""
      ? `?channel_id=${encodeURIComponent(channelId)}`
      : "";
  return apiFetch(`/api/sessions/current${query}`, { accessToken });
}

export function toggleDate(token, dateKey, accessToken) {
  return apiFetch(`/api/sessions/${encodeURIComponent(token)}/toggle`, {
    method: "POST",
    accessToken,
    body: { dateKey }
  });
}

export function publishPoll(token, accessToken) {
  return apiFetch(`/api/sessions/${encodeURIComponent(token)}/publish`, {
    method: "POST",
    accessToken
  });
}
