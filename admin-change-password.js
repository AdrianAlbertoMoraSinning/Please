const lib = require('./_admin-lib');
const notify = require('./_notify-lib');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
  if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });
  try {
    const auth = await lib.requireAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const currentPassword = String(body.current_password || '');
    const newPassword = String(body.new_password || '');
    if (newPassword.length < 10) return lib.json(400, { error: 'New password must be at least 10 characters.' });
    await lib.sbJson('/rest/v1/rpc/admin_portal_change_password', { method: 'POST', body: JSON.stringify({ p_actor: auth.user.id, p_current_password: currentPassword, p_new_password: newPassword }) });
    const n=await notify.send({to:auth.user.email,subject:'PLEASE — Administration Password Changed',title:'Your PLEASE password was changed',intro:`Hello ${auth.user.display_name||'PLEASE team member'}, your Administration portal password was changed successfully.`,message:'If you did not make this change, contact the PLEASE system administrator immediately. For security, the password is not included in this email.',ctaLabel:'Administration Login',ctaUrl:`${notify.baseUrl()}/admin-login.html`,idempotencyKey:`please-admin-password-${auth.user.id}-${Date.now()}`});
    return lib.json(200, { ok: true, reauth_required: true, notification_sent:!!n?.sent }, { 'Set-Cookie': lib.clearCookie() });
  } catch (error) {
    console.error('admin-change-password', error);
    return lib.json(error.status === 401 ? 401 : 400, { error: error.status === 401 ? 'Unauthorized' : (error.message || 'Password could not be changed.') });
  }
};
