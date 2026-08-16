(() => {
  const loading = document.getElementById('admin-loading');
  const app = document.getElementById('admin-app');
  const tbody = document.getElementById('applications-body');
  const empty = document.getElementById('applications-empty');
  const alertBox = document.getElementById('admin-alert');
  const searchInput = document.getElementById('application-search');
  const statusFilter = document.getElementById('application-status-filter');
  const drawer = document.getElementById('application-drawer');
  const backdrop = document.getElementById('application-drawer-backdrop');
  const detailDocuments = document.getElementById('detail-documents');
  const detailHistory = document.getElementById('detail-history');
  const detailActions = document.getElementById('detail-actions');

  let allApplications = [];
  let selected = null;

  const statusLabels = {
    NEW: 'New', UNDER_REVIEW: 'Under Review', REFERRED_TO_DEVELOPER: 'Referred', ONBOARDING: 'Onboarding',
    APPROVED: 'Approved', ACTIVATED: 'Activated', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn'
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function showAlert(message, type = 'error') {
    alertBox.hidden = false;
    alertBox.className = `form-alert ${type}`;
    alertBox.textContent = message;
  }

  function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    return new Intl.DateTimeFormat('en-CA', withTime ? {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Edmonton'
    } : { dateStyle: 'medium', timeZone: 'America/Edmonton' }).format(date);
  }

  function statusBadge(status) {
    return `<span class="status-badge status-${esc(status.toLowerCase().replaceAll('_','-'))}">${esc(statusLabels[status] || status)}</span>`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store',
      headers: { ...(options.body ? {'content-type':'application/json'} : {}), ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('admin-login.html');
      throw new Error('Session expired.');
    }
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function ensureAdminSession() {
    const data = await api('/.netlify/functions/admin-session');
    document.getElementById('admin-name').textContent = data.user?.display_name || 'PLEASE Administrator';
    document.getElementById('admin-email').textContent = data.user?.email || '';
    return data.user;
  }

  async function loadApplications() {
    alertBox.hidden = true;
    const data = await api('/.netlify/functions/admin-applications');
    allApplications = data.applications || [];
    renderStats();
    renderTable();
    if (selected) {
      const refreshed = allApplications.find(row => row.id === selected.id);
      if (refreshed) await openApplication(refreshed, false);
    }
  }

  function renderStats() {
    const count = status => allApplications.filter(row => row.status === status).length;
    document.getElementById('stat-new').textContent = count('NEW');
    document.getElementById('stat-review').textContent = count('UNDER_REVIEW');
    document.getElementById('stat-referred').textContent = count('REFERRED_TO_DEVELOPER');
    document.getElementById('stat-total').textContent = allApplications.length;
    document.getElementById('sidebar-new-count').textContent = count('NEW');
  }

  function filteredApplications() {
    const q = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    return allApplications.filter(row => {
      const matchesStatus = status === 'ALL' || row.status === status;
      const haystack = [row.reference,row.full_name,row.company_name,row.email,row.phone,row.service_trade,row.other_service_description].join(' ').toLowerCase();
      return matchesStatus && (!q || haystack.includes(q));
    });
  }

  function renderTable() {
    const rows = filteredApplications();
    tbody.innerHTML = '';
    empty.hidden = rows.length > 0;
    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong class="admin-reference">${esc(row.reference)}</strong></td>
        <td><strong>${esc(row.full_name)}</strong><small>${esc(row.company_name || row.email)}</small></td>
        <td>${esc(row.service_trade || row.other_service_description || '—')}</td>
        <td>${row.years_experience ?? '—'} yrs</td>
        <td>${esc(formatDate(row.submitted_at))}</td>
        <td>${statusBadge(row.status)}</td>
        <td><button class="admin-row-button" type="button">View</button></td>`;
      tr.querySelector('button').addEventListener('click', () => openApplication(row));
      tbody.appendChild(tr);
    });
  }

  async function loadDetail(applicationId) {
    return api(`/.netlify/functions/admin-applications?id=${encodeURIComponent(applicationId)}`);
  }

  async function loadDocuments(files) {
    if (!files?.length) {
      detailDocuments.innerHTML = '<span class="admin-muted">No supporting documents were uploaded.</span>';
      return;
    }
    detailDocuments.innerHTML = '';
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'admin-document-row';
      item.innerHTML = `<div><strong>${esc(file.file_type)}</strong><span>${esc(file.file_name)}</span></div><button type="button" class="admin-row-button">Open</button>`;
      item.querySelector('button').addEventListener('click', async () => {
        const btn = item.querySelector('button');
        btn.disabled = true; btn.textContent = 'Opening…';
        try {
          const result = await api('/.netlify/functions/admin-document-url', { method:'POST', body:JSON.stringify({ file_id:file.id }) });
          window.open(result.url, '_blank', 'noopener,noreferrer');
        } catch (error) { showAlert(error.message || 'Could not open the private document.'); }
        finally { btn.disabled = false; btn.textContent = 'Open'; }
      });
      detailDocuments.appendChild(item);
    });
  }

  function loadHistory(history) {
    detailHistory.innerHTML = (history || []).map(row => `
      <div class="admin-history-row">
        <span>${esc(formatDate(row.created_at, true))}</span>
        <strong>${esc(row.old_status || 'START')} → ${esc(row.new_status)}</strong>
        ${row.note ? `<p>${esc(row.note)}</p>` : ''}
      </div>`).join('') || '<span class="admin-muted">No history available.</span>';
  }

  function renderActions(row) {
    detailActions.innerHTML = '';
    const add = (label, className, handler) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = className; button.textContent = label;
      button.addEventListener('click', handler); detailActions.appendChild(button);
    };
    if (row.status === 'NEW') {
      add('START REVIEW →', 'btn primary', () => transition('START_REVIEW', row.id));
      add('DECLINE', 'admin-danger-button', () => decline(row));
    } else if (row.status === 'UNDER_REVIEW') {
      add('REFER TO DEVELOPER →', 'btn primary', () => transition('REFER_TO_DEVELOPER', row.id));
      add('DECLINE', 'admin-danger-button', () => decline(row));
    } else {
      const note = document.createElement('span');
      note.className = 'admin-muted';
      note.textContent = row.status === 'REFERRED_TO_DEVELOPER'
        ? 'Referred. Developer onboarding is now responsible for the next workflow step.'
        : `No PLEASE workflow action is available while this application is ${statusLabels[row.status] || row.status}.`;
      detailActions.appendChild(note);
    }
  }

  async function transition(action, id, value = null) {
    detailActions.querySelectorAll('button').forEach(btn => btn.disabled = true);
    try {
      await api('/.netlify/functions/admin-application-action', { method:'POST', body:JSON.stringify({ application_id:id, action, value }) });
      await loadApplications();
    } catch (error) { showAlert(error.message || 'The application status could not be changed.'); renderActions(selected); }
  }

  async function decline(row) {
    const reason = window.prompt('Enter the internal reason for declining this application:');
    if (reason === null) return;
    if (!reason.trim()) return showAlert('A decline reason is required.');
    await transition('DECLINE', row.id, reason.trim());
  }

  async function openApplication(row, openDrawer = true) {
    selected = row;
    detailDocuments.innerHTML = '<span class="admin-muted">Loading documents…</span>';
    detailHistory.innerHTML = '<span class="admin-muted">Loading history…</span>';
    const detail = await loadDetail(row.id);
    row = detail.application; selected = row;
    document.getElementById('detail-reference').textContent = row.reference;
    document.getElementById('detail-name').textContent = row.full_name;
    const badge = document.getElementById('detail-status');
    badge.className = `status-badge status-${row.status.toLowerCase().replaceAll('_','-')}`;
    badge.textContent = statusLabels[row.status] || row.status;
    document.getElementById('detail-experience').textContent = row.experience_details || '—';
    document.getElementById('detail-notes').value = row.internal_notes || '';
    const details = [
      ['Company', row.company_name || '—'], ['Email', row.email], ['Phone', row.phone],
      ['Service / Trade', row.service_trade || row.other_service_description || '—'],
      ['Years of Experience', row.years_experience ?? '—'], ['Service Area', row.service_area || '—'],
      ['Licensed / Certified', row.licensed_certified_status || '—'], ['Insured', row.insured_status || '—'],
      ['Submitted', formatDate(row.submitted_at, true)], ['Reviewed', formatDate(row.reviewed_at, true)],
      ['Referred to Developer', formatDate(row.referred_to_developer_at, true)]
    ];
    document.getElementById('detail-content').innerHTML = details.map(([label,value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    renderActions(row); loadDocuments(detail.files); loadHistory(detail.history);
    if (openDrawer) {
      drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); backdrop.hidden=false; document.body.classList.add('admin-drawer-open');
    }
  }

  function closeDrawer() {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); backdrop.hidden=true; document.body.classList.remove('admin-drawer-open');
  }

  document.getElementById('save-notes').addEventListener('click', async () => {
    if (!selected) return;
    const button = document.getElementById('save-notes'); button.disabled = true;
    try {
      await api('/.netlify/functions/admin-application-action', { method:'POST', body:JSON.stringify({ application_id:selected.id, action:'SAVE_NOTES', value:document.getElementById('detail-notes').value }) });
      showAlert('Internal notes saved.', 'success'); await loadApplications();
    } catch (error) { showAlert(error.message || 'Internal notes could not be saved.'); }
    finally { button.disabled=false; }
  });

  document.getElementById('admin-signout').addEventListener('click', async () => {
    try { await api('/.netlify/functions/admin-logout', { method:'POST', body:'{}' }); } catch (_) {}
    window.location.replace('admin-login.html');
  });
  document.getElementById('refresh-applications').addEventListener('click', () => loadApplications().catch(error => showAlert(error.message)));
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  searchInput.addEventListener('input', renderTable);
  statusFilter.addEventListener('change', renderTable);

  async function init() {
    try {
      await ensureAdminSession(); loading.hidden=true; loading.remove(); app.hidden=false; await loadApplications();
      const idFromUrl = new URLSearchParams(window.location.search).get('application');
      if (idFromUrl) { const match=allApplications.find(row=>row.id===idFromUrl); if (match) await openApplication(match); }
    } catch (error) { if (!location.href.includes('admin-login')) loading.textContent = error?.message || 'Unable to load secure administration portal.'; }
  }
  init();
})();
