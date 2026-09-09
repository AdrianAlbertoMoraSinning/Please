const lib=require('./_admin-lib');
const notify=require('./_notify-lib');
const clean=v=>String(v??'').slice(0,1500);

async function markQueueError(queueId,message){
  if(!queueId)return;
  await lib.sbJson(`/rest/v1/operational_finance_queue?id=eq.${encodeURIComponent(queueId)}`,{
    method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({
      status:'ERROR',last_error:clean(message),next_attempt_at:new Date(Date.now()+5*60*1000).toISOString(),processing_started_at:null,processing_by:null,updated_at:new Date().toISOString()
    })
  }).catch(e=>console.error('operational-finance-worker:queue-error',e));
}

async function emailIssuedInvoice(row){
  const invoice=await notify.invoiceContext(row.invoice_id);
  if(!invoice?.client_email)throw new Error('Auto-email is enabled but the invoice has no customer email.');
  const sent=await notify.send({
    to:invoice.client_email,
    subject:`PLEASE — Invoice ${invoice.invoice_number}`,
    title:'Your PLEASE invoice is ready',
    intro:`Hi ${invoice.client_name||'there'}, PLEASE has prepared your service invoice.`,
    details:[['Invoice',invoice.invoice_number],['Total',notify.money(invoice.total_amount)],['Due date',invoice.due_date||'Due on receipt'],['Status','ISSUED']],
    ctaLabel:'View & Pay Invoice',
    ctaUrl:`${notify.baseUrl()}/invoice.html?token=${encodeURIComponent(invoice.public_token||'')}`,
    idempotencyKey:`please-step19-auto-invoice-${invoice.id}`
  });
  if(!sent?.sent)throw new Error(sent?.error||'Invoice notification was not sent.');
  const now=new Date().toISOString();
  await lib.sbJson(`/rest/v1/invoices?id=eq.${encodeURIComponent(invoice.id)}&status=eq.ISSUED`,{
    method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'SENT',sent_at:now,updated_at:now})
  });
  await lib.sbJson('/rest/v1/invoice_status_history',{
    method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
      invoice_id:invoice.id,old_status:'ISSUED',new_status:'SENT',old_payment_status:invoice.payment_status||'UNPAID',new_payment_status:invoice.payment_status||'UNPAID',note:'STEP 19 auto-email sent after Auto-Issue.',source:'SYSTEM'
    })
  });
  return true;
}

exports.handler=async()=>{
  try{
    const limit=Math.max(1,Math.min(50,Number(process.env.PLEASE_OPERATIONAL_FINANCE_WORKER_LIMIT||10)));
    const rows=await lib.sbJson('/rest/v1/rpc/operational_finance_process_pending',{
      method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({p_limit:limit,p_worker_id:`netlify-${process.env.DEPLOY_ID||'step19'}`})
    });
    const results=Array.isArray(rows)?rows:[];
    let emailed=0,emailErrors=0;
    for(const row of results.filter(x=>x?.should_email&&x?.invoice_id)){
      try{await emailIssuedInvoice(row);emailed++;}
      catch(e){emailErrors++;console.error('operational-finance-worker:auto-email',e);await markQueueError(row.queue_id,e.message||'Auto-email failed.');}
    }
    return {statusCode:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok:true,processed:results.length,emailed,email_errors:emailErrors,results})};
  }catch(e){
    console.error('operational-finance-worker',e);
    return {statusCode:500,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok:false,error:e.message||'Operational Finance worker failed.'})};
  }
};
