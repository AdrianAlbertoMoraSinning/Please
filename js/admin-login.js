(() => {
  const form = document.getElementById('admin-login-form');
  const alertBox = document.getElementById('login-alert');
  const submit = document.getElementById('login-submit');

  function show(message, type = 'error') {
    alertBox.hidden = false;
    alertBox.className = `form-alert ${type}`;
    alertBox.textContent = message;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function redirectIfAuthorized() {
    try {
      const response = await fetch('/.netlify/functions/admin-session', { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok) window.location.replace('admin.html');
    } catch (_) {}
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    alertBox.hidden = true;
    submit.disabled = true;
    submit.textContent = 'SIGNING IN…';
    try {
      await api('/.netlify/functions/admin-login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('login-email').value.trim().toLowerCase(),
          password: document.getElementById('login-password').value
        })
      });
      window.location.replace('admin.html');
    } catch (error) {
      show(error.message || 'Unable to sign in.');
      submit.disabled = false;
      submit.textContent = 'SIGN IN →';
    }
  });

  redirectIfAuthorized();
})();
