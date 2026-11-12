// Small read-only Gmail client and helpers for pulling Muse digests. No dependencies.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Exchange a long-lived refresh token for a short-lived access token.
export async function getAccessToken({ clientId, clientSecret, refreshToken }, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const why = [body.error, body.error_description].filter(Boolean).join(': ') || 'no access token';
    const hint = body.error === 'invalid_client'
      ? ' (check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET: both from the same Web application client, no spaces or quotes)'
      : body.error === 'invalid_grant'
        ? ' (the refresh token was revoked, expired, or issued to a different client: get a new one)'
        : '';
    throw new Error(`Gmail token refresh failed (${res.status}): ${why}${hint}`);
  }
  return body.access_token;
}

export function gmailClient(accessToken, fetchImpl = fetch) {
  async function get(path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Gmail ${path} failed (${res.status}): ${await res.text()}`);
    return res.json();
  }
  return {
    // All message ids matching a Gmail search query, following pagination.
    async listMessageIds(q, max = 500) {
      const ids = [];
      let pageToken;
      do {
        const page = await get('/messages', { q, pageToken, maxResults: 100 });
        for (const m of page.messages || []) ids.push(m.id);
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < max);
      return ids.slice(0, max);
    },
    getMessage: (id, format = 'full') => get(`/messages/${id}`, { format }),
  };
}

// File name for a digest: received time in UTC, e.g. 2026-11-11T1902Z.
// Seconds are dropped to match the hand-saved files; a same-minute clash gets the message id appended.
export function digestFileName(internalDateMs) {
  const d = new Date(Number(internalDateMs));
  if (Number.isNaN(d.getTime())) throw new Error(`Bad internalDate: ${internalDateMs}`);
  const iso = d.toISOString(); // 2026-11-11T19:02:54.000Z
  return `${iso.slice(0, 13)}${iso.slice(14, 16)}Z`;
}

export function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Walk a MIME tree and return the first part with the given type.
function findPart(part, mimeType) {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const p of part.parts || []) {
    const hit = findPart(p, mimeType);
    if (hit) return hit;
  }
  return null;
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Plain-text body of a Gmail API message (format=full), falling back to stripped HTML.
export function messageText(message) {
  const plain = findPart(message.payload, 'text/plain');
  if (plain) return decodeBase64Url(plain.body.data);
  const html = findPart(message.payload, 'text/html');
  if (html) return htmlToText(decodeBase64Url(html.body.data));
  return '';
}

export function header(message, name) {
  const h = (message.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// The text saved to data/raw: same header lines as the hand-saved digests, then the body.
export function digestFileText(message) {
  const received = new Date(Number(message.internalDate)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `Subject: ${header(message, 'Subject') || ''}\nReceived: ${received}\nGmail-Id: ${message.id}\n\n${messageText(message).trim()}\n`;
}
