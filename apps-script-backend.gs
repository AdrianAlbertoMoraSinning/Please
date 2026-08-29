/*
  PLEASE reusable agenda — dormant template.

  This module is NOT linked from the production Service Request flow. If it is
  activated later, configure these Google Apps Script > Project Settings >
  Script Properties before deploying the Web App:

    PLEASE_SHEET_ID
    PLEASE_OWNER_EMAIL = info@pleaseservice.ca
    PLEASE_ADMIN_PIN
    PLEASE_RESEND_API_KEY
    PLEASE_EMAIL_FROM = PLEASE Services <notifications@pleaseservice.ca>
    PLEASE_EMAIL_REPLY_TO = info@pleaseservice.ca

  Email is sent through the verified PLEASE Resend domain. MailApp/GmailApp is
  intentionally not used, preventing the Apps Script owner's personal Gmail
  identity from becoming the sender.
*/

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = String(props.getProperty('PLEASE_SHEET_ID') || '').trim();
  const ownerEmail = String(props.getProperty('PLEASE_OWNER_EMAIL') || 'info@pleaseservice.ca').trim().toLowerCase();
  const adminPin = String(props.getProperty('PLEASE_ADMIN_PIN') || '').trim();
  const resendApiKey = String(props.getProperty('PLEASE_RESEND_API_KEY') || '').trim();
  const emailFrom = String(props.getProperty('PLEASE_EMAIL_FROM') || 'PLEASE Services <notifications@pleaseservice.ca>').trim();
  const emailReplyTo = String(props.getProperty('PLEASE_EMAIL_REPLY_TO') || 'info@pleaseservice.ca').trim().toLowerCase();

  if (!sheetId) throw new Error('PLEASE_SHEET_ID is not configured in Apps Script Properties.');
  if (!adminPin) throw new Error('PLEASE_ADMIN_PIN is not configured in Apps Script Properties.');
  if (!resendApiKey) throw new Error('PLEASE_RESEND_API_KEY is not configured in Apps Script Properties.');
  if (!/@(?:[a-z0-9-]+\.)*pleaseservice\.ca$/i.test(ownerEmail)) throw new Error('PLEASE_OWNER_EMAIL must use the pleaseservice.ca domain.');
  if (!/@(?:[a-z0-9-]+\.)*pleaseservice\.ca>?$/i.test(emailFrom)) throw new Error('PLEASE_EMAIL_FROM must use the pleaseservice.ca domain.');
  if (!/@(?:[a-z0-9-]+\.)*pleaseservice\.ca$/i.test(emailReplyTo)) throw new Error('PLEASE_EMAIL_REPLY_TO must use the pleaseservice.ca domain.');
  return { sheetId, ownerEmail, adminPin, resendApiKey, emailFrom, emailReplyTo };
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
      const record = getAppointment(sheet, body.id);
      updateStatus(sheet, body.id, 'cancelled');
      notifyCancellation(record);
      return json({ ok:true, data:true });
    }
    if (body.action === 'update') {
      requireAdmin(body);
      const record = getAppointment(sheet, body.id);
      updateAppointment(sheet, body.id, body.updates || {});
      notifyUpdate(record, body.updates || {});
      return json({ ok:true, data:true });
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
  if (sheet.getLastRow() === 0) sheet.appendRow(['id','appointmentDate','appointmentTime','clientName','clientPhone','clientEmail','clientComment','status','createdAt']);
  return sheet;
}

function listAppointments(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.filter(row => row[0]).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function getAppointment(sheet,id){
  const row=findRowById(sheet,id),headers=sheet.getRange(1,1,1,9).getValues()[0],values=sheet.getRange(row,1,1,9).getValues()[0];
  return Object.fromEntries(headers.map((h,i)=>[h,values[i]]));
}

function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());}

function createAppointment(sheet, body) {
  if (!body.appointmentDate || !body.appointmentTime || !body.clientName || !body.clientPhone) throw new Error('Faltan datos obligatorios.');
  const appointments = listAppointments(sheet);
  const exists = appointments.some(item => item.appointmentDate === body.appointmentDate && item.appointmentTime === body.appointmentTime && item.status !== 'cancelled');
  if (exists) throw new Error('Ese horario ya fue reservado. Selecciona otro horario.');

  const record = {id:Utilities.getUuid(),appointmentDate:body.appointmentDate,appointmentTime:body.appointmentTime,clientName:body.clientName,clientPhone:body.clientPhone,clientEmail:body.clientEmail||'',clientComment:body.clientComment||'',status:'active',createdAt:new Date().toISOString()};
  sheet.appendRow([record.id,record.appointmentDate,record.appointmentTime,record.clientName,record.clientPhone,record.clientEmail,record.clientComment,record.status,record.createdAt]);
  notifyCreated(record,body.companyName||'PLEASE Services');
  return record;
}

function sendPleaseEmail(to,subject,text,replyToOverride) {
  if(!validEmail(to)) return false;
  const cfg=getConfig();
  const payload={from:cfg.emailFrom,to:[String(to).trim().toLowerCase()],subject:String(subject).slice(0,300),text:String(text),reply_to:String(replyToOverride||cfg.emailReplyTo).trim().toLowerCase()};
  const response=UrlFetchApp.fetch('https://api.resend.com/emails',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+cfg.resendApiKey},payload:JSON.stringify(payload),muteHttpExceptions:true});
  const status=response.getResponseCode();
  if(status<200||status>=300) throw new Error('Resend email failed ('+status+'): '+response.getContentText().slice(0,250));
  return true;
}

function notifyCreated(record, companyName) {
  const cfg=getConfig();
  const detail=[`Fecha: ${record.appointmentDate}`,`Hora: ${record.appointmentTime}`,`Cliente: ${record.clientName}`,`Teléfono/WhatsApp: ${record.clientPhone}`,`Correo: ${record.clientEmail}`,`Comentario: ${record.clientComment}`].join('\n');
  sendPleaseEmail(cfg.ownerEmail,`PLEASE — New agenda appointment (${record.appointmentDate})`,`A new appointment was created in the reusable PLEASE agenda.\n\n${detail}\n\nOpen the agenda administration page to review it.`,record.clientEmail||cfg.emailReplyTo);
  if(validEmail(record.clientEmail)) sendPleaseEmail(record.clientEmail,'PLEASE — Appointment Request Received',`Hello ${record.clientName},\n\nPLEASE received your appointment request.\n\n${detail}\n\nPLEASE will contact you if any confirmation or adjustment is required.\n\nPLEASE Services`);
}

function notifyCancellation(record){
  if(validEmail(record.clientEmail)) sendPleaseEmail(record.clientEmail,'PLEASE — Appointment Cancelled',`Hello ${record.clientName},\n\nYour PLEASE appointment for ${record.appointmentDate} at ${record.appointmentTime} was cancelled by PLEASE Administration.\n\nReply to this email if you need help arranging another time.\n\nPLEASE Services`);
}
function notifyUpdate(record,updates){
  if(validEmail(record.clientEmail)) sendPleaseEmail(record.clientEmail,'PLEASE — Appointment Updated',`Hello ${record.clientName},\n\nPLEASE Administration updated your appointment record for ${record.appointmentDate} at ${record.appointmentTime}.\n\n${updates.clientComment?`Updated note: ${updates.clientComment}\n\n`:''}Reply to this email if you have questions.\n\nPLEASE Services`);
}

function updateStatus(sheet, id, status) { const row=findRowById(sheet,id);sheet.getRange(row,8).setValue(status);return true; }
function updateAppointment(sheet, id, updates) { const row=findRowById(sheet,id);if(typeof updates.clientComment==='string')sheet.getRange(row,7).setValue(updates.clientComment);return true; }
function findRowById(sheet,id){const values=sheet.getDataRange().getValues();for(let i=1;i<values.length;i++)if(values[i][0]===id)return i+1;throw new Error('Reserva no encontrada.');}
function requireAdmin(body){if(body.adminPin!==getConfig().adminPin)throw new Error('Acceso no autorizado.');}
function json(payload){return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);}
