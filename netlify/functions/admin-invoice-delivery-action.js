const lib=require('./_admin-lib');
const notify=require('./_notify-lib');

const REVIEW_HISTORY_MARKER='STEP19.1 GOOGLE REVIEW REQUEST SENT';
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const enc=v=>encodeURIComponent(String(v||''));

async function getInvoice(id){
  const rows=await lib.sbJson(`/rest/v1/invoices?select=*&id=eq.${enc(id)}&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}

async function addHistory(invoice,patch,note,user){
  await lib.sbJson('/rest/v1/invoice_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
    invoice_id:invoice.id,
    old_status:invoice.status,
    new_status:patch?.status||invoice.status,
    old_payment_status:invoice.payment_status,
    new_payment_status:patch?.payment_status||invoice.payment_status,
    note:clean(note,1000)||null,
    changed_by_admin_portal_user:user?.id||null,
    source:'ADMIN'
  })});
}

function greetingName(value){
  const first=clean(value,200).split(/\s+/).filter(Boolean)[0]||'';
  return first||'there';
}

function eTransferEmail(){
  const value=clean(process.env.PLEASE_ETRANSFER_EMAIL||'info@pleaseservice.ca',250).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:'';
}

const DEFAULT_GOOGLE_REVIEW_URL='https://www.google.com/search?q=Please+Services+Calgary&ludocid=11821370300392660033#lrd=0x0:0xa40df1a7e941dc41,3,,,';

function googleReviewUrl(){
  const configured=clean(process.env.PLEASE_GOOGLE_REVIEW_URL||DEFAULT_GOOGLE_REVIEW_URL,700);
  return /^https:\/\//i.test(configured)?configured:'';
}

async function invoiceEmail(invoice,user){
  let inv=invoice;
  if(inv.status==='DRAFT'){
    if(Number(inv.total_amount)<=0)throw Object.assign(new Error('Invoice total must be greater than zero before it can be sent.'),{status:409});
    const patch={status:'ISSUED',issued_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    await lib.sbJson(`/rest/v1/invoices?id=eq.${enc(inv.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
    await addHistory(inv,patch,'STEP 19.1 — Final customer values approved; invoice issued for delivery.',user);
    inv={...inv,...patch};
  }
  if(!['ISSUED','OVERDUE'].includes(inv.status)){
    throw Object.assign(new Error(inv.status==='SENT'?'Invoice has already been sent to the customer.':'This invoice is not ready for customer delivery.'),{status:409});
  }
  if(!inv.client_email)throw Object.assign(new Error('Customer email is required before sending the invoice.'),{status:400});

  const context=await notify.invoiceContext(inv.id).catch(()=>inv);
  const fresh={...inv,...(context||{})};
  const job=fresh.job_id?await notify.jobContext(fresh.job_id).catch(()=>null):null;
  const transfer=eTransferEmail();
  const invoiceUrl=`${notify.baseUrl()}/invoice.html?token=${encodeURIComponent(fresh.public_token||'')}`;
  const service=job?.service_name||'PLEASE service';
  const customerFirstName=greetingName(job?.customers?.first_name||fresh.client_name);
  const delivery=await notify.send({
    to:fresh.client_email,
    subject:`PLEASE — Your service is complete · Invoice ${fresh.invoice_number}`,
    title:`Your service is complete — Invoice ${fresh.invoice_number}`,
    intro:`Hi ${customerFirstName}, your service is complete and your final PLEASE invoice is ready.`,
    details:[
      ['Service',service],
      ['Invoice',fresh.invoice_number],
      ['Total',notify.money(fresh.total_amount)],
      ['Due date',fresh.due_date||'Due on receipt']
    ],
    message:`PAYMENT OPTIONS\n\nCard / Debit: click PAY NOW to securely pay online.${transfer?`\n\ne-Transfer: send payment to ${transfer} and include ${fresh.invoice_number} as the payment reference. PLEASE will confirm the invoice as paid after the transfer is received.`:''}`,
    ctaLabel:'PAY NOW',
    ctaUrl:invoiceUrl,
    idempotencyKey:`please-step19-2-invoice-delivery-${fresh.id}`
  });

  if(!delivery?.sent){
    const reason=delivery?.error||delivery?.reason||'Email delivery failed.';
    throw Object.assign(new Error(`Invoice was issued, but the customer email was not delivered. No payment data was lost. Use SEND TO CUSTOMER to retry. ${reason}`),{status:502});
  }

  const sentPatch={status:'SENT',sent_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  await lib.sbJson(`/rest/v1/invoices?id=eq.${enc(fresh.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(sentPatch)});
  await addHistory(fresh,sentPatch,'STEP 19.1 — Invoice emailed directly to customer with PAY NOW and e-Transfer instructions.',user);
  return {ok:true,status:'SENT',notification_sent:true,invoice_number:fresh.invoice_number};
}

async function reviewEmail(invoice,user){
  if(!(invoice.status==='PAID'||invoice.payment_status==='PAID')){
    throw Object.assign(new Error('Review requests are available after the invoice is paid.'),{status:409});
  }
  if(!invoice.client_email)throw Object.assign(new Error('Customer email is required before sending a review request.'),{status:400});
  const prior=await lib.sbJson(`/rest/v1/invoice_status_history?select=id,note&invoice_id=eq.${enc(invoice.id)}&note=ilike.*${enc(REVIEW_HISTORY_MARKER)}*&limit=1`).catch(()=>[]);
  if(prior?.length)throw Object.assign(new Error('A Google review request was already sent for this invoice.'),{status:409});

  const job=invoice.job_id?await notify.jobContext(invoice.job_id).catch(()=>null):null;
  const reviewUrl=googleReviewUrl();
  if(!reviewUrl)throw Object.assign(new Error('Google Review link is unavailable. Verify PLEASE_GOOGLE_REVIEW_URL or the PLEASE Google Business Profile review link.'),{status:503});
  const delivery=await notify.send({
    to:invoice.client_email,
    subject:'PLEASE — How did we do?',
    title:'Thank you for choosing PLEASE',
    intro:`Hi ${greetingName(invoice.client_name)}, thank you for trusting PLEASE with your recent service.`,
    details:[['Service',job?.service_name||'PLEASE service'],['Invoice',invoice.invoice_number]],
    message:'★★★★★\n\nReviews from clients like you help other Calgary customers find reliable help. If you were happy with your service, we would really appreciate a Google review.',
    ctaLabel:'LEAVE A GOOGLE REVIEW',
    ctaUrl:reviewUrl,
    idempotencyKey:`please-step19-1-google-review-${invoice.id}`
  });
  if(!delivery?.sent){
    const reason=delivery?.error||delivery?.reason||'Email delivery failed.';
    throw Object.assign(new Error(`Review request was not delivered. ${reason}`),{status:502});
  }
  await addHistory(invoice,{},`${REVIEW_HISTORY_MARKER} — ${reviewUrl}`,user);
  return {ok:true,notification_sent:true,review_url:reviewUrl};
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event))return lib.json(403,{error:'Invalid origin'});
    const auth=await lib.requireAdmin(event);
    const body=JSON.parse(event.body||'{}');
    const action=String(body.action||'').trim().toUpperCase();
    const id=String(body.invoice_id||'').trim();
    if(!id)return lib.json(400,{error:'Invoice id is required.'});
    const invoice=await getInvoice(id);
    if(!invoice)return lib.json(404,{error:'Invoice not found.'});
    if(action==='SEND_INVOICE')return lib.json(200,await invoiceEmail(invoice,auth.user));
    if(action==='SEND_REVIEW')return lib.json(200,await reviewEmail(invoice,auth.user));
    return lib.json(400,{error:'Unknown delivery action.'});
  }catch(e){
    console.error('admin-invoice-delivery-action',e);
    return lib.json(e.status||500,{error:e.message||'Invoice delivery action failed.'});
  }
};
