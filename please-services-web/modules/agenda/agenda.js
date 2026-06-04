const config = window.AGENDA_CONFIG;

const calendarGrid = document.getElementById('calendarGrid');
const weekLabel = document.getElementById('weekLabel');
const prevWeekBtn = document.getElementById('prevWeek');
const nextWeekBtn = document.getElementById('nextWeek');
const bookingForm = document.getElementById('bookingForm');
const selectedSlotTitle = document.getElementById('selectedSlotTitle');
const bookingMessage = document.getElementById('bookingMessage');

let weekOffset = 0;
let bookedSlots = [];

const pad = value => String(value).padStart(2, '0');

const dateKey = date =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const timeSlots = () => {
  const slots = [];

  for (
    let hour = config.startHour;
    hour < config.endHour;
    hour += config.slotMinutes / 60
  ) {
    slots.push(`${pad(Math.floor(hour))}:${pad((hour % 1) * 60)}`);
  }

  return slots;
};

function loadLeadData() {
  const lead = JSON.parse(localStorage.getItem('please_lead') || '{}');

  const nameInput = document.getElementById('clientName');
  const phoneInput = document.getElementById('clientPhone');
  const emailInput = document.getElementById('clientEmail');

  if (lead.name) {
    nameInput.value = lead.name;
    nameInput.readOnly = true;
  }

  if (lead.phone) {
    phoneInput.value = lead.phone;
    phoneInput.readOnly = true;
  }

  if (lead.email) {
    emailInput.value = lead.email;
    emailInput.readOnly = true;
  }
}

function mondayOfWeek(baseDate) {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  date.setDate(date.getDate() + diff + weekOffset * 7);
  date.setHours(0, 0, 0, 0);

  return date;
}

function displayDate(date) {
  return date.toLocaleDateString('en-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

async function api(action, payload = {}) {
  if (!config.appsScriptUrl || config.appsScriptUrl.includes('PASTE_GOOGLE')) {
    const demo = JSON.parse(localStorage.getItem('agenda_demo_bookings') || '[]');

    if (action === 'list') return demo;

    if (action === 'create') {
      const exists = demo.some(item =>
        item.appointmentDate === payload.appointmentDate &&
        item.appointmentTime === payload.appointmentTime &&
        item.status !== 'cancelled'
      );

      if (exists) {
        throw new Error('This time slot has already been booked. Please select another one.');
      }

      const record = {
        id: crypto.randomUUID(),
        status: 'active',
        createdAt: new Date().toISOString(),
        ...payload
      };

      demo.push(record);
      localStorage.setItem('agenda_demo_bookings', JSON.stringify(demo));

      return record;
    }
  }

  const response = await fetch(config.appsScriptUrl, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.message || 'Unable to complete the request.');
  }

  return data.data;
}

async function loadBookings() {
  bookedSlots = await api('list');
}

function isBooked(date, time) {
  const key = dateKey(date);

  const normalizeHour = value =>
    Number(String(value).split(':')[0]);

  return bookedSlots.some(item =>
    String(item.appointmentDate).trim() === key &&
    normalizeHour(item.appointmentTime) === normalizeHour(time) &&
    String(item.status).toLowerCase() !== 'cancelled'
  );
}

function renderCalendar() {
  const monday = mondayOfWeek(new Date());
  const friday = new Date(monday);

  friday.setDate(monday.getDate() + 4);

  weekLabel.textContent =
    `${monday.toLocaleDateString('en-CA', { day: 'numeric', month: 'short' })} - ` +
    `${friday.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  prevWeekBtn.disabled = weekOffset <= 0;
  calendarGrid.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);

    const dayCard = document.createElement('article');
    dayCard.className = 'calendar-day';

    dayCard.innerHTML = `
      <h3>
        ${displayDate(day)}
        <small>${dateKey(day)}</small>
      </h3>
      <div class="slot-list"></div>
    `;

    const list = dayCard.querySelector('.slot-list');

    timeSlots().forEach(time => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'slot-button';
      button.textContent = time;

      if (isBooked(day, time)) {
        button.classList.add('booked');
        button.textContent = `${time} booked`;
        button.disabled = true;
      } else {
        button.addEventListener('click', () => selectSlot(day, time, button));
      }

      list.appendChild(button);
    });

    calendarGrid.appendChild(dayCard);
  }
}

function selectSlot(date, time, button) {
  document
    .querySelectorAll('.slot-button.selected')
    .forEach(btn => btn.classList.remove('selected'));

  button.classList.add('selected');

  document.getElementById('appointmentDate').value = dateKey(date);
  document.getElementById('appointmentTime').value = time;

  selectedSlotTitle.textContent = `Appointment on ${displayDate(date)} at ${time}`;
  bookingMessage.textContent = '';

  document.getElementById('clientComment').focus();
}

bookingForm.addEventListener('submit', async event => {
  event.preventDefault();

  const appointmentDate = document.getElementById('appointmentDate').value;
  const appointmentTime = document.getElementById('appointmentTime').value;

  if (!appointmentDate || !appointmentTime) {
    bookingMessage.textContent = 'Please select an available date and time first.';
    return;
  }

  const payload = {
    appointmentDate,
    appointmentTime,
    clientName: document.getElementById('clientName').value.trim(),
    clientPhone: document.getElementById('clientPhone').value.trim(),
    clientEmail: document.getElementById('clientEmail').value.trim(),
    clientComment: document.getElementById('clientComment').value.trim(),
    companyName: config.companyName,
    ownerEmail: config.ownerEmail,
    ownerWhatsapp: config.ownerWhatsapp
  };

  try {
    bookingMessage.textContent = 'Saving appointment...';

    await api('create', payload);

    bookingMessage.textContent =
      'Appointment confirmed. The PLEASE team has been notified.';

    bookingForm.reset();
    loadLeadData();

    selectedSlotTitle.textContent = 'Select a time';

    await loadBookings();
    renderCalendar();
  } catch (error) {
    bookingMessage.textContent = error.message;
  }
});

prevWeekBtn.addEventListener('click', async () => {
  weekOffset--;
  renderCalendar();
});

nextWeekBtn.addEventListener('click', async () => {
  weekOffset++;
  renderCalendar();
});

(async function init() {
  try {
    loadLeadData();

    await loadBookings();
    renderCalendar();

    if (!config.appsScriptUrl || config.appsScriptUrl.includes('PASTE_GOOGLE')) {
      bookingMessage.textContent =
        'Demo mode: appointments are stored only in this browser until Google Sheets is connected.';
    }
  } catch (error) {
    bookingMessage.textContent = error.message;
  }
})();
