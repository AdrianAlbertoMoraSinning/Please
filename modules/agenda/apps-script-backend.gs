/*
  Google Apps Script backend for the reusable agenda module.

  Setup:
  1. Create a Google Sheet.
  2. Extensions > Apps Script.
  3. Paste this file.
  4. In Project Settings > Script Properties set PLEASE_SHEET_ID, PLEASE_OWNER_EMAIL and PLEASE_ADMIN_PIN.
  5. Deploy > New deployment > Web app.
  6. Execute as: Me. Who has access: Anyone.
  7. Copy Web App URL into agenda-config.js > appsScriptUrl.
*/

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = String(props.getProperty('PLEASE_SHEET_ID') || '').trim();
  const ownerEmail = String(props.getProperty('PLEASE_OWNER_EMAIL') || 'info@pleaseservice.ca').trim().toLowerCase();
  const adminPin = String(props.getProperty('PLEASE_ADMIN_PIN') || '').trim();

  if (!sheetId) throw new Error('PLEASE_SHEET_ID is not configured in Apps Script Properties.');
  if (!adminPin) throw new Error('PLEASE_ADMIN_PIN is not configured in Apps Script Properties.');
  if (!/@(?:[a-z0-9-]+\.)*pleaseservice\.ca$/i.test(ownerEmail)) {
    throw new Error('PLEASE_OWNER_EMAIL must use the pleaseservice.ca domain.');
  }
  return { sheetId, ownerEmail, adminPin };
}

const SHEET_NAME = 'appointments';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const sheet = getSheet();

    if (body.action === 'list') return json({ ok:true, data:listAppointments(sheet) });
    if (body.action === 'create') return json({ ok:true, data:createAppointment(sheet, body) });
    if (body.action === 'delete') {
      requireAdmin(body);
      return json({ ok:true, data:updateStatus(sheet, body.id, 'cancelled') });
    }
    if (body.action === 'update') {
      requireAdmin(body);
      return json({ ok:true, data:updateAppointment(sheet, body.id, body.updates || {}) });
    }
    return json({ ok:false, message:'Invalid action' });
  } catch (error) {
    return json({ ok:false, message:error.message });
  }
}

function getSheet() {
  const ss = SpreadsheetApp.openById(getConfig().sheetId);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','appointmentDate','appointmentTime','clientName','clientPhone','clientEmail','clientComment','status','createdAt']);
  }
  return sheet;
}

function listAppointments(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.filter(row => row[0]).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function createAppointment(sheet, body) {
  if (!body.appointmentDate || !body.appointmentTime || !body.clientName || !body.clientPhone) {
    throw new Error('Faltan datos obligatorios.');
  }
  const appointments = listAppointments(sheet);
  const exists = appointments.some(item => item.appointmentDate === body.appointmentDate && item.appointmentTime === body.appointmentTime && item.status !== 'cancelled');
  if (exists) throw new Error('Ese horario ya fue reservado. Selecciona otro horario.');

  const record = {
    id: Utilities.getUuid(),
    appointmentDate: body.appointmentDate,
    appointmentTime: body.appointmentTime,
    clientName: body.clientName,
    clientPhone: body.clientPhone,
    clientEmail: body.clientEmail || '',
    clientComment: body.clientComment || '',
    status: 'active',
    createdAt: new Date().toISOString()
  };
  sheet.appendRow([record.id, record.appointmentDate, record.appointmentTime, record.clientName, record.clientPhone, record.clientEmail, record.clientComment, record.status, record.createdAt]);
  sendOwnerEmail(record, body.companyName || 'Agenda web');
  return record;
}

function sendOwnerEmail(record, companyName) {
  const subject = `Nueva cita agendada - ${companyName}`;
  const message = [
    `Nueva cita agendada desde la página web.`,
    ``,
    `Fecha: ${record.appointmentDate}`,
    `Hora: ${record.appointmentTime}`,
    `Cliente: ${record.clientName}`,
    `Teléfono/WhatsApp: ${record.clientPhone}`,
    `Correo: ${record.clientEmail}`,
    `Comentario: ${record.clientComment}`,
    ``,
    `Panel de administración: abre agenda-admin.html en la web.`
  ].join('\n');
  MailApp.sendEmail(getConfig().ownerEmail, subject, message);
}

function updateStatus(sheet, id, status) {
  const row = findRowById(sheet, id);
  sheet.getRange(row, 8).setValue(status);
  return true;
}

function updateAppointment(sheet, id, updates) {
  const row = findRowById(sheet, id);
  if (typeof updates.clientComment === 'string') sheet.getRange(row, 7).setValue(updates.clientComment);
  return true;
}

function findRowById(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) return i + 1;
  }
  throw new Error('Reserva no encontrada.');
}

function requireAdmin(body) {
  if (body.adminPin !== getConfig().adminPin) throw new Error('Acceso no autorizado.');
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
