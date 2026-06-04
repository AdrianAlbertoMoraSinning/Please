/*
  Google Apps Script backend for the reusable agenda module.

  Setup:
  1. Create a Google Sheet.
  2. Extensions > Apps Script.
  3. Paste this file.
  4. Set SHEET_ID and OWNER_EMAIL.
  5. Deploy > New deployment > Web app.
  6. Execute as: Me. Who has access: Anyone.
  7. Copy Web App URL into agenda-config.js > appsScriptUrl.
*/

const SHEET_ID = '1SGt-Br7K-pMlfVDVxDEB219hYeBDUC3AEuf_DviL1s';
const SHEET_NAME = 'appointments';
const OWNER_EMAIL = 'abogadosasociadosap4@mail.com';
const ADMIN_PIN = '3108030751';

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
  const ss = SpreadsheetApp.openById(SHEET_ID);
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
  MailApp.sendEmail(OWNER_EMAIL, subject, message);
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
  if (body.adminPin !== ADMIN_PIN) throw new Error('Acceso no autorizado.');
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
