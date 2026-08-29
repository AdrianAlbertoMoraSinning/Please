const lib = require('./_admin-lib');
const security = require('./_security-lib');
const notify = require('./_notify-lib');

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const emailOk = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const uuidOk = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

exports.handler = async event => {
  try {
    if (event.httpMethod === 'GET') {
      const services = await lib.sbJson('/rest/v1/services?select=id,slug,name,sort_order&active=eq.true&order=sort_order.asc,name.asc');
      return lib.json(200, { services: services || [] });
    }

    if (event.httpMethod !== 'POST') return lib.json(405, { error: 'Method not allowed' });
    if (!lib.sameOrigin(event)) return lib.json(403, { error: 'Invalid request origin' });

    const rl = await security.checkRateLimit(event, {
      endpoint: 'public-provider-application',
      limit: 8,
      windowSeconds: 3600
    });
    if (!rl.allowed) {
      return lib.json(429, {
        error: 'Too many applications were submitted from this connection. Please wait and try again.'
      }, { 'Retry-After': String(rl.retryAfter) });
    }

    const body = JSON.parse(event.body || '{}');
    const fullName = clean(body.full_name, 160);
    const companyName = clean(body.company_name, 180);
    const phone = clean(body.phone, 80);
    const email = clean(body.email, 220).toLowerCase();
    const serviceId = clean(body.service_id, 60);
    const otherService = clean(body.other_service_description, 300);
    const serviceArea = clean(body.service_area, 250);
    const licenseStatus = clean(body.license_status, 60);
    const insuredStatus = clean(body.insured_status, 60);
    const experienceDescription = clean(body.experience_description, 5000);
    const yearsExperience = Number(body.years_experience);
    const consentAccurate = body.consent_information_accurate === true;
    const consentApplication = body.consent_application_not_guarantee === true;

    if (!fullName || !phone || !email || !serviceArea || !experienceDescription) {
      return lib.json(400, { error: 'Please complete all required fields.' });
    }
    if (!emailOk(email)) return lib.json(400, { error: 'Please enter a valid email address.' });
    if (!Number.isFinite(yearsExperience) || yearsExperience < 0 || yearsExperience > 80) {
      return lib.json(400, { error: 'Please enter valid years of experience.' });
    }
    if (!consentAccurate || !consentApplication) {
      return lib.json(400, { error: 'Please accept the application declarations.' });
    }

    const isOther = serviceId === '__OTHER__' || !serviceId;
    if (isOther && !otherService) {
      return lib.json(400, { error: 'Please describe the service or trade you provide.' });
    }
    if (!isOther && !uuidOk(serviceId)) {
      return lib.json(400, { error: 'Please select a valid service.' });
    }

    let selectedServiceName = '';
    if (!isOther) {
      const rows = await lib.sbJson(`/rest/v1/services?select=id,name&id=eq.${encodeURIComponent(serviceId)}&active=eq.true&limit=1`);
      if (!rows?.[0]) return lib.json(400, { error: 'Selected service is not available.' });
      selectedServiceName = clean(rows[0].name, 180);
    }

    const payload = {
      p_full_name: fullName,
      p_company_name: companyName || null,
      p_phone: phone,
      p_email: email,
      p_service_id: isOther ? null : serviceId,
      p_other_service_description: isOther ? otherService : null,
      p_years_experience: yearsExperience,
      p_service_area: serviceArea,
      p_license_status: licenseStatus,
      p_insured_status: insuredStatus,
      p_experience_description: experienceDescription,
      p_consent_information_accurate: consentAccurate,
      p_consent_application_not_guarantee: consentApplication
    };

    const result = await lib.sbJson('/rest/v1/rpc/submit_provider_application', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.application_reference || !row?.application_id) {
      throw new Error('Application reference was not returned.');
    }

    const serviceTrade = isOther ? otherService : selectedServiceName;
    const details = [
      ['Application', row.application_reference],
      ['Applicant', fullName],
      ['Service / Trade', serviceTrade || 'Not specified'],
      ['Service Area', serviceArea],
      ['Years Experience', String(yearsExperience)]
    ];
    const notifications = [];
    notifications.push(await notify.send({
      to: email,
      subject: `PLEASE Professional Network — Application Received (${row.application_reference})`,
      title: 'Application received',
      intro: `Hello ${fullName}, thank you for your interest in joining the PLEASE Professional Network.`,
      details,
      message: 'Our team will review your information. If there is a potential fit, you will be contacted regarding next steps. Submitting an application does not guarantee acceptance or create a provider account.',
      ctaLabel: 'PLEASE Website',
      ctaUrl: notify.baseUrl(),
      idempotencyKey: `please-applicant-${row.application_id}`
    }));
    notifications.push(await notify.sendAdmins({
      subject: `New Professional Application — ${row.application_reference}`,
      title: 'New professional application',
      intro: `${fullName} submitted an application to the PLEASE Professional Network.`,
      details: [...details, ['Email', email], ['Phone', phone], ['Company', companyName || '—']],
      message: experienceDescription,
      ctaLabel: 'Review Applications',
      ctaUrl: `${notify.baseUrl()}/admin.html#applications`,
      replyToOverride: email,
      idempotencyKey: `please-internal-${row.application_id}`
    }));

    return lib.json(201, {
      ok: true,
      application_id: row.application_id,
      application_reference: row.application_reference,
      email,
      notifications_sent: notifications.filter(x => x?.sent).length,
      email_warning: notifications.some(x => x?.error || x?.skipped) ? 'Application saved; one or more email notifications could not be delivered.' : null
    });
  } catch (error) {
    console.error('public-provider-application', error);
    return lib.json(error.status || 500, {
      error: error.status === 400 ? (error.message || 'Unable to submit application.') : 'Unable to submit application right now. Please try again.'
    });
  }
};
