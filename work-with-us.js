(() => {
  const form = document.getElementById('provider-application-form');
  if (!form) return;

  const alertBox = document.getElementById('application-alert');
  const serviceSelect = document.getElementById('service-select');
  const otherWrap = document.getElementById('other-service-wrap');
  const otherInput = document.getElementById('other-service-input');
  const submitButton = document.getElementById('application-submit');
  const successPanel = document.getElementById('application-success');
  const referenceTarget = document.getElementById('application-reference');
  const uploadResult = document.getElementById('document-upload-result');
  const certificationFile = document.getElementById('certification-file');
  const insuranceFile = document.getElementById('insurance-file');
  const portfolioFiles = document.getElementById('portfolio-files');

  let servicesLoaded = false;

  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  function collectUploadFiles() {
    const items = [];
    if (certificationFile?.files?.[0]) items.push({ file: certificationFile.files[0], type: 'CERTIFICATION' });
    if (insuranceFile?.files?.[0]) items.push({ file: insuranceFile.files[0], type: 'INSURANCE' });
    Array.from(portfolioFiles?.files || []).slice(0, 5).forEach(file => items.push({ file, type: 'PORTFOLIO' }));
    return items;
  }

  function validateUploadFiles() {
    const portfolioCount = portfolioFiles?.files?.length || 0;
    if (portfolioCount > 5) return 'Please select no more than 5 portfolio files.';

    for (const { file } of collectUploadFiles()) {
      if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 4 MB.`;
      if (!ALLOWED_TYPES.has(file.type)) return `${file.name} is not an accepted PDF or image file.`;
    }
    return null;
  }

  async function uploadApplicationFile({ file, type }, application) {
    const params = new URLSearchParams({
      application_id: application.application_id,
      reference: application.application_reference,
      email: application.email,
      file_type: type,
      filename: file.name
    });

    const response = await fetch(`/.netlify/functions/provider-application-upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });

    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(body.error || `Upload failed for ${file.name}`);
    return body;
  }

  async function uploadSupportingDocuments(application) {
    const files = collectUploadFiles();
    if (!files.length) return { uploaded: 0, failed: 0 };

    const results = await Promise.allSettled(files.map(item => uploadApplicationFile(item, application)));
    return {
      uploaded: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    };
  }

  function showAlert(message, type = 'error') {
    alertBox.hidden = false;
    alertBox.className = `form-alert ${type}`;
    alertBox.textContent = message;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
    alertBox.className = 'form-alert';
  }

  function fallbackServices() {
    return [
      ['moving', 'Moving'],
      ['delivery-pickup', 'Delivery & Pickup'],
      ['cleaning', 'Cleaning'],
      ['junk-removal', 'Junk Removal'],
      ['car-detailing', 'Car Detailing'],
      ['furniture-assembly', 'Furniture Assembly'],
      ['outdoor-services', 'Outdoor Services'],
      ['plumbing', 'Plumbing'],
      ['electrical', 'Electrical'],
      ['renovations', 'Renovations'],
      ['painting', 'Painting'],
      ['drywall', 'Drywall'],
      ['home-repairs', 'Home Repairs / Handyman'],
      ['interior-design-consultation', 'Interior Design']
    ];
  }

  function renderServices(rows = []) {
    serviceSelect.innerHTML = '<option value="">Select your service / trade</option>';
    rows.forEach(row => {
      const option = document.createElement('option');
      option.value = row.id || '';
      option.textContent = row.name;
      option.dataset.slug = row.slug || '';
      serviceSelect.appendChild(option);
    });
    const other = document.createElement('option');
    other.value = '__OTHER__';
    other.textContent = 'Other / More';
    serviceSelect.appendChild(other);
  }

  async function loadServices() {
    try {
      const response = await fetch('/.netlify/functions/public-provider-application', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      let body = {};
      try { body = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(body.error || 'Unable to load services.');
      renderServices(body.services || []);
      servicesLoaded = true;
      submitButton.disabled = false;
    } catch (error) {
      console.error('work-with-us:services', error);
      renderServices(fallbackServices().map(([slug, name]) => ({ id: '', slug, name })));
      serviceSelect.querySelectorAll('option').forEach((option, index) => {
        if (index > 0 && option.value !== '__OTHER__') option.disabled = true;
      });
      showAlert('We could not load the professional service list right now. Please refresh the page or contact PLEASE.', 'error');
      submitButton.disabled = true;
    }
  }

  serviceSelect.addEventListener('change', () => {
    const isOther = serviceSelect.value === '__OTHER__';
    otherWrap.hidden = !isOther;
    otherInput.required = isOther;
    if (!isOther) otherInput.value = '';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    clearAlert();

    if (!servicesLoaded) {
      showAlert('The application form is still loading. Please wait a moment and try again.', 'error');
      return;
    }

    if (!form.reportValidity()) return;

    const uploadValidationError = validateUploadFiles();
    if (uploadValidationError) {
      showAlert(uploadValidationError);
      return;
    }

    const data = new FormData(form);
    const serviceValue = data.get('service_id');
    const isOther = serviceValue === '__OTHER__';

    if (isOther && !String(data.get('other_service_description') || '').trim()) {
      showAlert('Please describe the service or trade you provide.');
      otherInput.focus();
      return;
    }

    submitButton.disabled = true;
    const originalText = submitButton.textContent;
    submitButton.textContent = 'SUBMITTING…';

    const payload = {
      p_full_name: String(data.get('full_name') || '').trim(),
      p_company_name: String(data.get('company_name') || '').trim() || null,
      p_phone: String(data.get('phone') || '').trim(),
      p_email: String(data.get('email') || '').trim().toLowerCase(),
      p_service_id: isOther ? null : serviceValue,
      p_other_service_description: isOther ? String(data.get('other_service_description') || '').trim() : null,
      p_years_experience: Number(data.get('years_experience')),
      p_service_area: String(data.get('service_area') || '').trim(),
      p_license_status: String(data.get('license_status') || ''),
      p_insured_status: String(data.get('insured_status') || ''),
      p_experience_description: String(data.get('experience_description') || '').trim(),
      p_consent_information_accurate: data.get('consent_information_accurate') === 'on',
      p_consent_application_not_guarantee: data.get('consent_application_not_guarantee') === 'on'
    };

    try {
      const submitResponse = await fetch('/.netlify/functions/public-provider-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: payload.p_full_name,
          company_name: payload.p_company_name,
          phone: payload.p_phone,
          email: payload.p_email,
          service_id: isOther ? '__OTHER__' : payload.p_service_id,
          other_service_description: payload.p_other_service_description,
          years_experience: payload.p_years_experience,
          service_area: payload.p_service_area,
          license_status: payload.p_license_status,
          insured_status: payload.p_insured_status,
          experience_description: payload.p_experience_description,
          consent_information_accurate: payload.p_consent_information_accurate,
          consent_application_not_guarantee: payload.p_consent_application_not_guarantee
        })
      });
      let result = {};
      try { result = await submitResponse.json(); } catch (_) {}
      if (!submitResponse.ok) throw new Error(result.error || 'Unable to submit application.');
      if (!result?.application_reference) throw new Error('Application reference was not returned.');

      const applicationContext = {
        application_id: result.application_id,
        application_reference: result.application_reference,
        email: result.email || payload.p_email
      };

      const uploadSummary = await uploadSupportingDocuments(applicationContext);

      // Applicant and Administration notifications are sent server-side by public-provider-application.

      referenceTarget.textContent = result.application_reference;
      if (uploadResult) {
        if (uploadSummary.uploaded > 0 && uploadSummary.failed === 0) {
          uploadResult.hidden = false;
          uploadResult.className = 'document-upload-result success';
          uploadResult.textContent = `${uploadSummary.uploaded} supporting document${uploadSummary.uploaded === 1 ? '' : 's'} uploaded privately with your application.`;
        } else if (uploadSummary.failed > 0) {
          uploadResult.hidden = false;
          uploadResult.className = 'document-upload-result warning';
          uploadResult.textContent = `Your application was received, but ${uploadSummary.failed} document${uploadSummary.failed === 1 ? '' : 's'} could not be uploaded. PLEASE may contact you if supporting documents are needed.`;
        }
      }
      form.hidden = true;
      successPanel.hidden = false;
      successPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      console.error('Provider application error:', error);
      showAlert(error?.message || 'We could not submit your application. Please try again or contact PLEASE.');
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });

  loadServices();
})();
