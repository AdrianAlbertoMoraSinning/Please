const crypto = require('crypto');

const COOKIE_NAME = 'please_admin_session';
const SESSION_SECONDS = 12 * 60 * 60;

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function config() {
  const url = process.env.PLEASE_SUPABASE_URL;
  const secret = process.env.PLEASE_SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('Admin backend is not configured.');
  return { url: url.replace(/\/$/, ''), secret };
}

async function sbFetch(path, options = {}) {
  const { url, secret } = config();
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: secret,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  return response;
}

async function sbJson(path, options = {}) {
  const response = await sbFetch(path, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error || data?.hint || `Supabase request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

function parseCookies(header = '') {
  return String(header).split(';').reduce((out, item) => {
    const i = item.indexOf('=');
    if (i > -1) out[item.slice(0, i).trim()] = decodeURIComponent(item.slice(i + 1).trim());
    return out;
  }, {});
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function requestIp(event) {
  return String(event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 120);
}

function requestUserAgent(event) {
  return String(event.headers['user-agent'] || '').slice(0, 500);
}

function sameOrigin(event) {
  const origin = event.headers.origin;
  if (!origin) return true;
  const host = event.headers.host;
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function createSession(user, event) {
  const token = newToken();
  const hash = tokenHash(token);
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await sbJson('/rest/v1/admin_portal_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: user.id,
      token_hash: hash,
      expires_at: expires,
      ip_address: requestIp(event) || null,
      user_agent: requestUserAgent(event) || null
    })
  });
  return { token, expires };
}

async function getSession(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const hash = tokenHash(token);
  const now = encodeURIComponent(new Date().toISOString());
  const sessions = await sbJson(`/rest/v1/admin_portal_sessions?select=id,user_id,expires_at&token_hash=eq.${hash}&revoked_at=is.null&expires_at=gt.${now}&limit=1`);
  const session = Array.isArray(sessions) ? sessions[0] : null;
  if (!session) return null;
  const users = await sbJson(`/rest/v1/admin_portal_users?select=id,email,display_name,role,active&id=eq.${session.user_id}&active=eq.true&limit=1`);
  const user = Array.isArray(users) ? users[0] : null;
  if (!user) return null;
  // Non-blocking last-seen refresh.
  sbFetch(`/rest/v1/admin_portal_sessions?id=eq.${session.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_seen_at: new Date().toISOString() })
  }).catch(() => {});
  return { session, user, tokenHash: hash };
}

async function requireAdmin(event) {
  const auth = await getSession(event);
  if (!auth || auth.user.role !== 'PLEASE_ADMIN') {
    const err = new Error('Unauthorized'); err.status = 401; throw err;
  }
  return auth;
}

async function revokeSession(auth) {
  if (!auth?.session?.id) return;
  await sbJson(`/rest/v1/admin_portal_sessions?id=eq.${auth.session.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() })
  });
}

module.exports = {
  COOKIE_NAME, SESSION_SECONDS, json, sbFetch, sbJson, sameOrigin,
  requestIp, requestUserAgent, sessionCookie, clearCookie,
  createSession, getSession, requireAdmin, revokeSession
};
