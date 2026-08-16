const lib = require('./_admin-lib');
const LIST_FIELDS = 'id,reference,full_name,company_name,phone,email,service_trade,other_service_description,years_experience,service_area,licensed_certified_status,insured_status,experience_details,status,internal_notes,reviewed_at,referred_to_developer_at,onboarding_started_at,approved_at,declined_at,decline_reason,activated_provider_id,submitted_at,updated_at';

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return lib.json(405, { error: 'Method not allowed' });
  try {
    await lib.requireAdmin(event);
    const id = String(event.queryStringParameters?.id || '').trim();
    if (!id) {
      const rows = await lib.sbJson(`/rest/v1/provider_applications?select=${LIST_FIELDS}&order=submitted_at.desc`);
      return lib.json(200, { applications: rows || [] });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return lib.json(400, { error: 'Invalid application id' });
    const apps = await lib.sbJson(`/rest/v1/provider_applications?select=${LIST_FIELDS}&id=eq.${id}&limit=1`);
    const application = Array.isArray(apps) ? apps[0] : null;
    if (!application) return lib.json(404, { error: 'Application not found' });
    const [files, history] = await Promise.all([
      lib.sbJson(`/rest/v1/provider_application_files?select=id,file_type,file_name,storage_path,mime_type,file_size_bytes,created_at&application_id=eq.${id}&order=created_at.asc`),
      lib.sbJson(`/rest/v1/provider_application_status_history?select=id,old_status,new_status,changed_by,changed_by_portal_user,note,created_at&application_id=eq.${id}&order=created_at.desc`)
    ]);
    return lib.json(200, { application, files: files || [], history: history || [] });
  } catch (error) {
    console.error('admin-applications', error);
    return lib.json(error.status === 401 ? 401 : 500, { error: error.status === 401 ? 'Unauthorized' : 'Unable to load applications.' });
  }
};
