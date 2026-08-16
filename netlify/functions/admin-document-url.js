const lib = require('./_admin-lib');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
  if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });
  try {
    await lib.requireAdmin(event);
    const body = JSON.parse(event.body || '{}');
    const fileId = String(body.file_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) return lib.json(400, { error: 'Invalid file id' });
    const rows = await lib.sbJson(`/rest/v1/provider_application_files?select=id,storage_path&id=eq.${fileId}&limit=1`);
    const file = Array.isArray(rows) ? rows[0] : null;
    if (!file) return lib.json(404, { error: 'Document not found' });
    const path = file.storage_path.split('/').map(encodeURIComponent).join('/');
    const signed = await lib.sbJson(`/storage/v1/object/sign/provider-applications/${path}`, {
      method: 'POST', body: JSON.stringify({ expiresIn: 300 })
    });
    const signedURL = signed?.signedURL || signed?.signedUrl;
    if (!signedURL) throw new Error('Unable to create signed URL');
    const { url } = (() => { const u = process.env.PLEASE_SUPABASE_URL.replace(/\/$/,''); return { url: u }; })();
    return lib.json(200, { url: signedURL.startsWith('http') ? signedURL : `${url}/storage/v1${signedURL}` });
  } catch (error) {
    console.error('admin-document-url', error);
    return lib.json(error.status === 401 ? 401 : 500, { error: error.status === 401 ? 'Unauthorized' : 'Could not open document.' });
  }
};
