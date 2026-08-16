const { randomUUID } = require('crypto');

const BUCKET = 'provider-applications';
const MAX_BYTES = 4 * 1024 * 1024; // Netlify binary payloads are base64-encoded; keep below effective 4.5 MB limit.
const ALLOWED = {
  'application/pdf': { ext: 'pdf', magic: 'pdf' },
  'image/jpeg': { ext: 'jpg', magic: 'jpeg' },
  'image/png': { ext: 'png', magic: 'png' },
  'image/webp': { ext: 'webp', magic: 'webp' }
};
const TYPES = new Set(['CERTIFICATION', 'INSURANCE', 'PORTFOLIO']);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    },
    body: JSON.stringify(payload)
  };
}

function safeName(name) {
  const cleaned = String(name || 'document')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 90);
  return cleaned || 'document';
}

function validMagic(buffer, kind) {
  if (kind === 'pdf') return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind === 'jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (kind === 'png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (kind === 'webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

async function supabaseFetch(url, secret, path, options = {}) {
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: secret,
      ...(options.headers || {})
    }
  });
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.PLEASE_SUPABASE_URL;
  const secret = process.env.PLEASE_SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret) return json(503, { error: 'Private upload service is not configured.' });

  const q = event.queryStringParameters || {};
  const applicationId = String(q.application_id || '').trim();
  const reference = String(q.reference || '').trim();
  const email = String(q.email || '').trim().toLowerCase();
  const fileType = String(q.file_type || '').trim().toUpperCase();
  const originalName = safeName(q.filename);
  const contentType = String(event.headers['content-type'] || event.headers['Content-Type'] || '').split(';')[0].trim().toLowerCase();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
    return json(400, { error: 'Invalid application identifier.' });
  }
  if (!/^PLS-APP-[0-9]{8}-[A-Z0-9]{6}$/.test(reference)) return json(400, { error: 'Invalid application reference.' });
  if (!email || !email.includes('@')) return json(400, { error: 'Invalid application email.' });
  if (!TYPES.has(fileType)) return json(400, { error: 'Invalid document type.' });
  if (!ALLOWED[contentType]) return json(415, { error: 'Only PDF, JPG, PNG and WEBP files are accepted.' });

  const buffer = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary');
  if (!buffer.length) return json(400, { error: 'The uploaded file is empty.' });
  if (buffer.length > MAX_BYTES) return json(413, { error: 'Each file must be 4 MB or smaller.' });
  if (!validMagic(buffer, ALLOWED[contentType].magic)) return json(415, { error: 'The file content does not match its declared file type.' });

  // Validate that the application exists and that the caller knows the matching id + reference + email.
  const appQuery = `/rest/v1/provider_applications?id=eq.${encodeURIComponent(applicationId)}&reference=eq.${encodeURIComponent(reference)}&email=eq.${encodeURIComponent(email)}&select=id,reference,email,status&limit=1`;
  const appRes = await supabaseFetch(supabaseUrl, secret, appQuery, { method: 'GET' });
  if (!appRes.ok) return json(502, { error: 'Could not validate the application.' });
  const apps = await appRes.json();
  if (!Array.isArray(apps) || apps.length !== 1) return json(404, { error: 'Application not found.' });
  if (apps[0].status !== 'NEW') return json(409, { error: 'Documents can only be uploaded while the application is new.' });

  // Limit uploads per type: 1 certification, 1 insurance, 5 portfolio files.
  const countPath = `/rest/v1/provider_application_files?application_id=eq.${encodeURIComponent(applicationId)}&file_type=eq.${encodeURIComponent(fileType)}&select=id`;
  const countRes = await supabaseFetch(supabaseUrl, secret, countPath, { method: 'GET' });
  if (!countRes.ok) return json(502, { error: 'Could not validate document limits.' });
  const existing = await countRes.json();
  const maxCount = fileType === 'PORTFOLIO' ? 5 : 1;
  if (Array.isArray(existing) && existing.length >= maxCount) return json(409, { error: `Maximum ${maxCount} ${fileType.toLowerCase()} file${maxCount === 1 ? '' : 's'} allowed.` });

  const suffix = randomUUID();
  const storagePath = `${applicationId}/${fileType.toLowerCase()}/${suffix}-${originalName}`;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');

  const uploadRes = await supabaseFetch(
    supabaseUrl,
    secret,
    `/storage/v1/object/${BUCKET}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-upsert': 'false',
        'cache-control': 'no-store'
      },
      body: buffer
    }
  );

  if (!uploadRes.ok) {
    let detail = '';
    try { detail = (await uploadRes.json()).message || ''; } catch (_) {}
    return json(502, { error: detail || 'Could not store the document.' });
  }

  const metaRes = await supabaseFetch(
    supabaseUrl,
    secret,
    '/rest/v1/provider_application_files',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'prefer': 'return=representation'
      },
      body: JSON.stringify({
        application_id: applicationId,
        file_type: fileType,
        file_name: originalName,
        storage_path: storagePath,
        mime_type: contentType,
        file_size_bytes: buffer.length,
        uploaded_by: null
      })
    }
  );

  if (!metaRes.ok) {
    // Best-effort cleanup if metadata insert fails.
    await supabaseFetch(supabaseUrl, secret, `/storage/v1/object/${BUCKET}/${encodedPath}`, { method: 'DELETE' });
    return json(502, { error: 'The document was not linked to the application.' });
  }

  return json(201, { ok: true, file_type: fileType, file_name: originalName });
};
