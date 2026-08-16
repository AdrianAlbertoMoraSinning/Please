const lib = require('./_admin-lib');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
  if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });
  try {
    const auth = await lib.requireAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const applicationId = String(body.application_id || '').trim();
    const action = String(body.action || '').trim().toUpperCase();
    const value = body.value == null ? null : String(body.value);
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return lib.json(400, { error: 'Invalid application id' });
    if (!['START_REVIEW','REFER_TO_DEVELOPER','DECLINE','SAVE_NOTES'].includes(action)) return lib.json(400, { error: 'Invalid action' });
    await lib.sbJson('/rest/v1/rpc/admin_portal_application_action', {
      method: 'POST',
      body: JSON.stringify({ p_actor: auth.user.id, p_application_id: applicationId, p_action: action, p_value: value })
    });
    return lib.json(200, { ok: true });
  } catch (error) {
    console.error('admin-application-action', error);
    const status = error.status === 401 ? 401 : 400;
    return lib.json(status, { error: error.status === 401 ? 'Unauthorized' : (error.message || 'Action failed') });
  }
};
