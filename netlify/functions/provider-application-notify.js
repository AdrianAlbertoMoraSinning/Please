const security = require('./_security-lib');
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validReference(value) {
  return /^PLS-APP-[0-9]{8}-[A-Z0-9]{6}$/.test(value);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function emailAddress(value) {
  const match = String(value || '').trim().match(/<([^<>]+)>\s*$/);
  return (match ? match[1] : String(value || '')).trim().toLowerCase();
}

function isPleaseEmail(value) {
  const domain = (emailAddress(value).split('@')[1] || '');
  return domain === 'pleaseservice.ca' || domain.endsWith('.pleaseservice.ca');
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

async function sendResendEmail(apiKey, payload, idempotencyKey) {
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });

  let body = {};
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) {
    const message = body?.message || body?.error || `Resend returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function applicantHtml(app) {
  return `
<!doctype html>
<html><body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#15283b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden">
        <tr><td style="background:#0b5fa8;padding:26px 30px;color:#fff">
          <div style="font-size:12px;letter-spacing:1.6px;font-weight:700">PLEASE PROFESSIONAL NETWORK</div>
          <div style="font-size:26px;font-weight:700;margin-top:8px">Application received</div>
        </td></tr>
        <tr><td style="padding:30px">
          <p style="margin-top:0">Hello ${escapeHtml(app.full_name)},</p>
          <p>Thank you for your interest in joining the PLEASE Professional Network. We have received your application and our team will review the information you provided.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef6fc;border-radius:10px;margin:22px 0">
            <tr><td style="padding:18px 20px">
              <div style="font-size:12px;color:#59758f;text-transform:uppercase;letter-spacing:1px">Application reference</div>
              <div style="font-size:21px;font-weight:700;color:#0b5fa8;margin-top:5px">${escapeHtml(app.reference)}</div>
              <div style="margin-top:12px"><strong>Service / Trade:</strong> ${escapeHtml(app.service_trade || 'Not specified')}</div>
            </td></tr>
          </table>
          <p>If your experience and services are a potential fit for the network, you will be contacted regarding the next steps. Additional information, photos, certifications or service details may be requested during onboarding.</p>
          <p style="font-size:13px;color:#657687">Submitting an application does not guarantee acceptance into the PLEASE Professional Network and does not create a provider account.</p>
          <p style="margin-bottom:0">PLEASE Services<br><strong>ANY SERVICE IN ONE PLACE!</strong></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function applicantText(app) {
  return `Hello ${app.full_name},\n\nThank you for your interest in joining the PLEASE Professional Network. We have received your application.\n\nApplication reference: ${app.reference}\nService / Trade: ${app.service_trade || 'Not specified'}\n\nOur team will review your information. If there is a potential fit, you will be contacted regarding the next steps. Additional information may be requested during onboarding.\n\nSubmitting an application does not guarantee acceptance into the PLEASE Professional Network and does not create a provider account.\n\nPLEASE Services\nANY SERVICE IN ONE PLACE!`;
}

function internalHtml(app, documentCount, viewUrl) {
  const cta = viewUrl ? `<p style="margin:26px 0"><a href="${escapeHtml(viewUrl)}" style="background:#0b5fa8;color:#fff;text-decoration:none;padding:13px 19px;border-radius:8px;font-weight:700;display:inline-block">VIEW APPLICATION →</a></p>` : '';
  const rows = [
    ['Reference', app.reference],
    ['Applicant', app.full_name],
    ['Company', app.company_name || '—'],
    ['Email', app.email],
    ['Phone', app.phone],
    ['Service / Trade', app.service_trade || app.other_service_description || '—'],
    ['Years of Experience', app.years_experience ?? '—'],
    ['Service Area', app.service_area || '—'],
    ['Licensed / Certified', app.licensed_certified_status || '—'],
    ['Insured', app.insured_status || '—'],
    ['Supporting Documents', String(documentCount)],
    ['Status', app.status]
  ].map(([label, value]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e7edf3;color:#657687;width:38%">${escapeHtml(label)}</td><td style="padding:8px 10px;border-bottom:1px solid #e7edf3;font-weight:600">${escapeHtml(value)}</td></tr>`).join('');

  return `
<!doctype html>
<html><body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#15283b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:28px 12px">
    <tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="background:#0b5fa8;padding:26px 30px;color:#fff"><div style="font-size:12px;letter-spacing:1.5px;font-weight:700">PLEASE — WORK WITH US</div><div style="font-size:25px;font-weight:700;margin-top:8px">New professional application</div></td></tr>
      <tr><td style="padding:28px 30px">
        <p style="margin-top:0">A new professional application has been submitted through the PLEASE Web Portal.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7edf3;border-radius:9px;border-collapse:separate;overflow:hidden">${rows}</table>
        <div style="margin-top:22px"><strong>Experience</strong><div style="margin-top:7px;padding:13px;background:#f7f9fb;border-radius:8px;white-space:pre-wrap">${escapeHtml(app.experience_details || '—')}</div></div>
        ${cta}
        <p style="font-size:13px;color:#657687;margin-bottom:0">Provider activation is not automatic. The application must follow the PLEASE review and developer onboarding process.</p>
      </td></tr>
    </table></td></tr>
  </table>
</body></html>`;
}

function internalText(app, documentCount, viewUrl) {
  return `New professional application\n\nReference: ${app.reference}\nApplicant: ${app.full_name}\nCompany: ${app.company_name || '—'}\nEmail: ${app.email}\nPhone: ${app.phone}\nService / Trade: ${app.service_trade || app.other_service_description || '—'}\nYears of Experience: ${app.years_experience ?? '—'}\nService Area: ${app.service_area || '—'}\nLicensed / Certified: ${app.licensed_certified_status || '—'}\nInsured: ${app.insured_status || '—'}\nSupporting Documents: ${documentCount}\nStatus: ${app.status}\n\nExperience:\n${app.experience_details || '—'}${viewUrl ? `\n\nView application: ${viewUrl}` : ''}\n\nProvider activation is not automatic. The application must follow the PLEASE review and developer onboarding process.`;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!security.sameOrigin(event)) return json(403, { error: 'Invalid request origin' });
  const rl = await security.checkRateLimit(event,{endpoint:'provider-application-notify',limit:20,windowSeconds:3600});
  if(!rl.allowed) return json(429,{error:'Too many notification attempts. Please wait and try again.'},{'Retry-After':String(rl.retryAfter)});

  const supabaseUrl = process.env.PLEASE_SUPABASE_URL;
  const supabaseSecret = process.env.PLEASE_SUPABASE_SECRET_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.PLEASE_EMAIL_FROM;
  const replyTo = process.env.PLEASE_EMAIL_REPLY_TO || 'info@pleaseservice.ca';
  const notifyEmail = process.env.PLEASE_APPLICATION_NOTIFY_EMAIL || 'info@pleaseservice.ca';
  const adminBaseUrl = clean(process.env.PLEASE_ADMIN_APPLICATION_BASE_URL || '', 500).replace(/\/$/, '');

  if (!supabaseUrl || !supabaseSecret) return json(503, { error: 'Application notification service is missing Supabase configuration.' });
  if (!resendApiKey || !emailFrom) {
    return json(503, { error: 'Email delivery is not configured yet.', code: 'EMAIL_NOT_CONFIGURED' });
  }
  if (!isPleaseEmail(emailFrom) || !isPleaseEmail(replyTo) || !isPleaseEmail(notifyEmail)) {
    return json(503, {
      error: 'Email delivery blocked because PLEASE email settings do not use the pleaseservice.ca domain.',
      code: 'EMAIL_DOMAIN_MISMATCH'
    });
  }

  let input = {};
  try { input = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Invalid JSON body.' }); }

  const applicationId = clean(input.application_id, 80);
  const reference = clean(input.reference, 40);
  const applicantEmail = clean(input.email, 254).toLowerCase();

  if (!validUuid(applicationId)) return json(400, { error: 'Invalid application identifier.' });
  if (!validReference(reference)) return json(400, { error: 'Invalid application reference.' });
  if (!validEmail(applicantEmail)) return json(400, { error: 'Invalid application email.' });

  const appPath = `/rest/v1/provider_applications?id=eq.${encodeURIComponent(applicationId)}&reference=eq.${encodeURIComponent(reference)}&email=eq.${encodeURIComponent(applicantEmail)}&select=id,reference,full_name,company_name,phone,email,service_trade,other_service_description,years_experience,service_area,licensed_certified_status,insured_status,experience_details,status,submitted_at&limit=1`;
  const appRes = await supabaseFetch(supabaseUrl, supabaseSecret, appPath, { method: 'GET' });
  if (!appRes.ok) return json(502, { error: 'Could not validate the application.' });
  const apps = await appRes.json();
  if (!Array.isArray(apps) || apps.length !== 1) return json(404, { error: 'Application not found.' });
  const app = apps[0];

  const filesPath = `/rest/v1/provider_application_files?application_id=eq.${encodeURIComponent(applicationId)}&select=id`;
  const filesRes = await supabaseFetch(supabaseUrl, supabaseSecret, filesPath, { method: 'GET' });
  let documentCount = 0;
  if (filesRes.ok) {
    const files = await filesRes.json();
    documentCount = Array.isArray(files) ? files.length : 0;
  }

  const viewUrl = adminBaseUrl ? `${adminBaseUrl}?application=${encodeURIComponent(applicationId)}` : '';

  const applicantPayload = {
    from: emailFrom,
    to: [app.email],
    subject: `PLEASE Professional Network — Application Received (${app.reference})`,
    html: applicantHtml(app),
    text: applicantText(app),
    reply_to: replyTo,
    tags: [
      { name: 'type', value: 'provider_application_confirmation' },
      { name: 'reference', value: app.reference.replace(/[^a-zA-Z0-9_-]/g, '_') }
    ]
  };

  const internalPayload = {
    from: emailFrom,
    to: [notifyEmail],
    subject: `New Professional Application — ${app.reference}`,
    html: internalHtml(app, documentCount, viewUrl),
    text: internalText(app, documentCount, viewUrl),
    reply_to: app.email,
    tags: [
      { name: 'type', value: 'provider_application_internal' },
      { name: 'reference', value: app.reference.replace(/[^a-zA-Z0-9_-]/g, '_') }
    ]
  };

  const results = await Promise.allSettled([
    sendResendEmail(resendApiKey, applicantPayload, `please-applicant-${applicationId}`),
    sendResendEmail(resendApiKey, internalPayload, `please-internal-${applicationId}`)
  ]);

  const applicantSent = results[0].status === 'fulfilled';
  const internalSent = results[1].status === 'fulfilled';
  const errors = results
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.message || 'Email delivery failed');

  if (!applicantSent && !internalSent) return json(502, { error: 'Application saved, but email delivery failed.', applicant_sent: false, internal_sent: false, details: errors });

  return json(200, {
    ok: true,
    applicant_sent: applicantSent,
    internal_sent: internalSent,
    document_count: documentCount,
    warnings: errors
  });
};
