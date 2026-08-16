const lib = require('./_admin-lib');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
  if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });
  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return lib.json(400, { error: 'Email and password are required.' });

    const data = await lib.sbJson('/rest/v1/rpc/admin_portal_authenticate', {
      method: 'POST', body: JSON.stringify({ p_email: email, p_password: password })
    });
    const user = Array.isArray(data) ? data[0] : null;
    const success = Boolean(user && user.role === 'PLEASE_ADMIN');

    // Audit only; intentionally no automatic lockout after a few mistakes.
    await lib.sbFetch('/rest/v1/admin_portal_login_audit', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ email, success, ip_address: lib.requestIp(event) || null, user_agent: lib.requestUserAgent(event) || null })
    }).catch(() => {});

    if (!success) return lib.json(401, { error: 'Invalid administrator email or password.' });
    const session = await lib.createSession(user, event);
    return lib.json(200, { ok: true, user: { email: user.email, display_name: user.display_name, role: user.role } }, {
      'Set-Cookie': lib.sessionCookie(session.token)
    });
  } catch (error) {
    console.error('admin-login', error);
    return lib.json(500, { error: 'Unable to sign in right now.' });
  }
};
