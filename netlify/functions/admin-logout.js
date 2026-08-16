const lib = require('./_admin-lib');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
  if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });
  try {
    const auth = await lib.getSession(event);
    if (auth) await lib.revokeSession(auth);
  } catch (error) { console.error('admin-logout', error); }
  return lib.json(200, { ok: true }, { 'Set-Cookie': lib.clearCookie() });
};
