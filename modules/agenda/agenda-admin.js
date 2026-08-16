const config = window.AGENDA_CONFIG;

const loginCard = document.getElementById('loginCard');
const adminPanel = document.getElementById('adminPanel');
const adminLogin = document.getElementById('adminLogin');
const adminLoginMessage = document.getElementById('adminLoginMessage');
const adminBookings = document.getElementById('adminBookings');
const refreshBookings = document.getElementById('refreshBookings');

async function api(action, payload = {}) {

  if (!config.appsScriptUrl || config.appsScriptUrl.includes('PASTE_GOOGLE')) {

    const demo = JSON.parse(
      localStorage.getItem('agenda_demo_bookings') || '[]'
    );

    if (action === 'list') {
      return demo;
    }

    if (action === 'delete') {
      const updated = demo.map(item =>
        item.id === payload.id
          ? { ...item, status: 'cancelled' }
          : item
      );

      localStorage.setItem(
        'agenda_demo_bookings',
        JSON.stringify(updated)
      );

      return true;
    }

    if (action === 'update') {
      const updated = demo.map(item =>
        item.id === payload.id
          ? { ...item, ...payload.updates }
          : item
      );

      localStorage.setItem(
        'agenda_demo_bookings',
        JSON.stringify(updated)
      );

      return true;
    }
  }

  const response = await fetch(config.appsScriptUrl, {
    method: 'POST',
    body: JSON.stringify({
      action,
      adminPin: config.adminPin,
      ...payload
    })
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.message || 'Unable to complete the request.'
    );
  }

  return data.data;
}

function formatBooking(item) {
  return `${item.appointmentDate} · ${item.appointmentTime}`;
}

async function renderBookings() {

  adminBookings.innerHTML =
    '<p>Loading appointments...</p>';

  const bookings = await api('list');

  const active = bookings
    .filter(item => item.status !== 'cancelled')
    .sort((a, b) =>
      `${a.appointmentDate} ${a.appointmentTime}`.localeCompare(
        `${b.appointmentDate} ${b.appointmentTime}`
      )
    );

  if (!active.length) {
    adminBookings.innerHTML =
      '<p>No active appointments found.</p>';
    return;
  }

  adminBookings.innerHTML = '';

  active.forEach(item => {

    const card = document.createElement('article');

    card.className = 'admin-booking';

    card.innerHTML = `
      <strong>${formatBooking(item)}</strong>

      <span><b>Client:</b> ${item.clientName || ''}</span>

      <span><b>Phone:</b> ${item.clientPhone || ''}</span>

      <span><b>Email:</b> ${item.clientEmail || ''}</span>

      <span><b>Comments:</b> ${item.clientComment || ''}</span>

      <div class="admin-actions">
        <button class="edit" type="button">
          Edit Comment
        </button>

        <button class="delete" type="button">
          Cancel Appointment
        </button>
      </div>
    `;

    card.querySelector('.delete').addEventListener(
      'click',
      async () => {

        const confirmed = confirm(
          'Cancel this appointment and free the time slot?'
        );

        if (!confirmed) return;

        await api('delete', {
          id: item.id
        });

        await renderBookings();
      }
    );

    card.querySelector('.edit').addEventListener(
      'click',
      async () => {

        const clientComment = prompt(
          'Update comment:',
          item.clientComment || ''
        );

        if (clientComment === null) return;

        await api('update', {
          id: item.id,
          updates: {
            clientComment
          }
        });

        await renderBookings();
      }
    );

    adminBookings.appendChild(card);
  });
}

adminLogin.addEventListener('submit', async event => {

  event.preventDefault();

  const pin =
    document.getElementById('adminPin').value.trim();

  if (pin !== config.adminPin) {

    adminLoginMessage.textContent =
      'Invalid PIN.';

    return;
  }

  sessionStorage.setItem(
    'agenda_admin_ok',
    '1'
  );

  loginCard.classList.add('hidden');
  adminPanel.classList.remove('hidden');

  await renderBookings();
});

refreshBookings.addEventListener(
  'click',
  renderBookings
);

if (
  sessionStorage.getItem('agenda_admin_ok') === '1'
) {
  loginCard.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  renderBookings();
}
