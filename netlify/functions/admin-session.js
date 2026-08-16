const lib = require('./_admin-lib');
exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return lib.json(405, { error: 'Method not allowed' });
  try {
    const auth = await lib.requireAdmin(event);
    return lib.json(200, { authenticated: true, user: auth.user });
  } catch (error) {
    return lib.json(401, { authenticated: false }, { 'Set-Cookie': lib.clearCookie() });
  }
};
