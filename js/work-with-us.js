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

  const url = window.PLEASE_SUPABASE_URL;
  const key = window.PLEASE_SUPABASE_ANON_KEY;
  const configured = Boolean(
    url && key &&
    !url.includes('PASTE_') &&
    !key.includes('PASTE_') &&
    window.supabase?.createClient
  );

  let client = null;

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
    if (!configured) {
      renderServices(fallbackServices().map(([slug, name]) => ({ id: '', slug, name })));
      serviceSelect.querySelectorAll('option').forEach((option, index) => {
        if (index > 0 && option.value !== '__OTHER__') option.disabled = true;
      });
      showAlert('The Work With Us page is ready, but Supabase browser configuration still needs to be added before applications can be submitted.', 'setup');
      submitButton.disabled = true;
      return;
    }

    client = window.supabase.createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { data, error } = await client
      .from('services')
      .select('id,slug,name,sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      renderServices([]);
      showAlert('We could not load the professional service list. Please refresh the page or contact PLEASE.', 'error');
      submitButton.disabled = true;
      return;
    }

    renderServices(data || []);
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

    if (!configured || !client) {
      showAlert('Applications cannot be submitted until the Supabase public configuration is completed.', 'setup');
      return;
    }

    if (!form.reportValidity()) return;

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
      const { data: result, error } = await client.rpc('submit_provider_application', payload);
      if (error) throw error;

      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.application_reference) throw new Error('Application reference was not returned.');

      referenceTarget.textContent = row.application_reference;
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
