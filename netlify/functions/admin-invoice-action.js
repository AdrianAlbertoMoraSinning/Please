const crypto=require('crypto');
const lib=require('./_admin-lib');
const MONEY=n=>Math.round((Number(n)||0)*100)/100;

async function getInvoice(id){
  const rows=await lib.sbJson(`/rest/v1/invoices?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows)?rows[0]:null;
}
async function history(invoice,patch,note,user,source='ADMIN'){
  await lib.sbJson('/rest/v1/invoice_status_history',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
    invoice_id:invoice.id,old_status:invoice.status,new_status:patch.status||invoice.status,old_payment_status:invoice.payment_status,new_payment_status:patch.payment_status||invoice.payment_status,note:note||null,changed_by_admin_portal_user:user?.id||null,source
  })});
}
function invoiceNo(){
  const d=new Date().toISOString().slice(0,10).replaceAll('-','');
  return `PLS-INV-${d}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function cleanItem(x,i){
  const description=String(x?.description||'').trim().slice(0,500);
  const qty=MONEY(x?.qty||1),unit=String(x?.unit||'item').trim().slice(0,30)||'item',unit_rate=MONEY(x?.unit_rate);
  if(!description) throw Object.assign(new Error(`Item ${i+1} needs a description.`),{status:400});
  if(qty<=0||unit_rate<0) throw Object.assign(new Error(`Invalid quantity or rate on item ${i+1}.`),{status:400});
  return {description,qty,unit,unit_rate,line_total:MONEY(qty*unit_rate),sort_order:(i+1)*10};
}

exports.handler=async event=>{
  if(event.httpMethod!=='POST') return lib.json(405,{error:'Method not allowed'});
  try{
    if(!lib.sameOrigin(event)) return lib.json(403,{error:'Invalid origin'});
    const auth=await lib.requireAdmin(event);
    const body=JSON.parse(event.body||'{}');
    const action=String(body.action||'').toUpperCase();

    if(action==='CREATE'){
      let job=null;
      if(body.job_id){
        const jobs=await lib.sbJson(`/rest/v1/jobs?select=id,reference,customer_id,service_name,work_address,work_description,estimated_duration_minutes,billing_type,customer_rate,billable_quantity,billing_unit,quoted_subtotal,status,customers(id,first_name,last_name,email,phone)&id=eq.${encodeURIComponent(body.job_id)}&limit=1`);
        job=Array.isArray(jobs)?jobs[0]:null;
        if(!job) return lib.json(404,{error:'Job not found'});
        if(job.status!=='COMPLETED') return lib.json(409,{error:'Only completed jobs can be invoiced.'});
        const existing=await lib.sbJson(`/rest/v1/invoices?select=id,invoice_number,status&job_id=eq.${encodeURIComponent(job.id)}&status=neq.VOID&limit=1`);
        if(existing?.length) return lib.json(409,{error:`Job is already invoiced as ${existing[0].invoice_number}.`});
      }
      const c=job?.customers||{};
      const name=job?`${c.first_name||''} ${c.last_name||''}`.trim():String(body.client_name||'').trim();
      const payload={invoice_number:invoiceNo(),job_id:job?.id||null,customer_id:job?.customer_id||null,client_name:name||null,client_email:job?c.email||null:body.client_email||null,client_phone:job?c.phone||null:body.client_phone||null,invoice_date:new Date().toISOString().slice(0,10),due_date:new Date().toISOString().slice(0,10),gst_rate:5,status:'DRAFT',payment_status:'UNPAID',currency:'CAD',note:null};
      const created=await lib.sbJson('/rest/v1/invoices',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      const inv=created?.[0];
      if(!inv) throw new Error('Invoice was not created.');
      if(job){
        const billing=await lib.sbJson(`/rest/v1/job_billing_items?select=id,service_name,description,quantity,unit,customer_unit_rate,customer_line_total,unit_rate,line_total,sort_order&job_id=eq.${encodeURIComponent(job.id)}&order=sort_order.asc,id.asc`);
        let invoiceItems=[];
        if(billing?.length){
          invoiceItems=billing.map((x,i)=>({invoice_id:inv.id,description:[x.service_name,x.description].filter(Boolean).join(' — ')||'PLEASE service',qty:MONEY(x.quantity),unit:x.unit||'service',unit_rate:MONEY(x.customer_unit_rate??x.unit_rate),line_total:MONEY(x.customer_line_total??x.line_total),sort_order:(i+1)*10}));
        }else{
          // Legacy STEP 8.1 fallback for historical Jobs created before multi-item billing.
          const qty=Number(job.billable_quantity)>0?Number(job.billable_quantity):(job.billing_type==='HOURLY'?Math.max(0.01,Number(job.estimated_duration_minutes||60)/60):1);
          const unit=job.billing_unit||(job.billing_type==='HOURLY'?'hour':'service'),rate=Number(job.customer_rate)||0;
          invoiceItems=[{invoice_id:inv.id,description:job.service_name||'PLEASE service',qty:MONEY(qty),unit,unit_rate:MONEY(rate),line_total:MONEY(qty*rate),sort_order:10}];
        }
        await lib.sbJson('/rest/v1/invoice_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(invoiceItems)});
        const subtotal=MONEY(invoiceItems.reduce((n,x)=>n+Number(x.line_total||0),0)),gst=MONEY(subtotal*0.05);
        await lib.sbJson(`/rest/v1/invoices?id=eq.${inv.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({subtotal,gst_amount:gst,total_amount:MONEY(subtotal+gst),updated_at:new Date().toISOString()})});
      }
      await history(inv,{status:'DRAFT',payment_status:'UNPAID'},'Invoice created',auth.user);
      return lib.json(200,{ok:true,id:inv.id,invoice_number:inv.invoice_number});
    }

    const id=String(body.invoice_id||'');
    const inv=await getInvoice(id);
    if(!inv) return lib.json(404,{error:'Invoice not found'});

    if(action==='SAVE'){
      if(inv.status==='PAID'||inv.status==='VOID') return lib.json(409,{error:'Paid or void invoices cannot be edited.'});
      const items=(Array.isArray(body.items)?body.items:[]).map(cleanItem);
      if(!items.length) return lib.json(400,{error:'Add at least one invoice item.'});
      const rate=MONEY(body.gst_rate);
      if(rate<0||rate>100) return lib.json(400,{error:'Invalid GST rate.'});
      const patch={client_name:String(body.client_name||'').trim().slice(0,200)||null,client_email:String(body.client_email||'').trim().slice(0,250)||null,client_phone:String(body.client_phone||'').trim().slice(0,80)||null,invoice_date:body.invoice_date||inv.invoice_date,due_date:body.due_date||null,gst_rate:rate,note:String(body.note||'').trim().slice(0,4000)||null,updated_at:new Date().toISOString()};
      await lib.sbJson(`/rest/v1/invoices?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      await lib.sbJson(`/rest/v1/invoice_items?invoice_id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
      await lib.sbJson('/rest/v1/invoice_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(items.map(x=>({...x,invoice_id:id})))});
      // Explicit final calculation avoids any client-side trust.
      const subtotal=MONEY(items.reduce((n,x)=>n+x.line_total,0)),gst=MONEY(subtotal*rate/100),total=MONEY(subtotal+gst);
      await lib.sbJson(`/rest/v1/invoices?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({subtotal,gst_amount:gst,total_amount:total,updated_at:new Date().toISOString()})});
      return lib.json(200,{ok:true});
    }

    if(action==='ISSUE'){
      if(inv.status!=='DRAFT') return lib.json(409,{error:'Only draft invoices can be issued.'});
      if(Number(inv.total_amount)<=0) return lib.json(409,{error:'Invoice total must be greater than zero.'});
      const patch={status:'ISSUED',issued_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      await lib.sbJson(`/rest/v1/invoices?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      await history(inv,patch,'Invoice issued',auth.user);
      return lib.json(200,{ok:true});
    }

    if(action==='MARK_SENT'){
      if(!['ISSUED','SENT','OVERDUE'].includes(inv.status)) return lib.json(409,{error:'Issue the invoice before marking it sent.'});
      const patch={status:'SENT',sent_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      await lib.sbJson(`/rest/v1/invoices?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      await history(inv,patch,'Invoice marked sent',auth.user);
      return lib.json(200,{ok:true});
    }

    if(action==='MARK_PAID'){
      if(inv.status==='VOID') return lib.json(409,{error:'A void invoice cannot be paid.'});
      if(inv.status==='DRAFT') return lib.json(409,{error:'Issue the invoice before recording payment.'});
      if(inv.payment_status==='PAID') return lib.json(409,{error:'Invoice is already paid.'});
      const amount=MONEY(body.amount||inv.total_amount),method=String(body.payment_method||'MANUAL').trim().slice(0,80),ref=String(body.payment_reference||'').trim().slice(0,250)||null,note=String(body.note||'').trim().slice(0,1000)||'Manual payment recorded by PLEASE';
      if(amount<=0) return lib.json(400,{error:'Payment amount must be greater than zero.'});
      const paid=MONEY((Number(inv.amount_paid)||0)+amount),isFull=paid+0.001>=Number(inv.total_amount);
      const patch={amount_paid:paid,payment_method:method,payment_reference:ref,payment_status:isFull?'PAID':'PENDING',status:isFull?'PAID':inv.status,paid_at:isFull?new Date().toISOString():inv.paid_at,updated_at:new Date().toISOString()};
      await lib.sbJson(`/rest/v1/invoices?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      await lib.sbJson('/rest/v1/payment_transactions',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({invoice_id:id,amount,currency:inv.currency||'CAD',provider:'MANUAL',status:'SUCCEEDED',external_reference:ref,note,created_by_admin_portal_user:auth.user.id})});
      await history(inv,patch,note,auth.user);
      return lib.json(200,{ok:true,fully_paid:isFull});
    }

    if(action==='VOID'){
      if(inv.payment_status==='PAID') return lib.json(409,{error:'Paid invoices cannot be voided. Record a refund workflow separately.'});
      if(inv.status==='VOID') return lib.json(409,{error:'Invoice is already void.'});
      const reason=String(body.reason||'').trim().slice(0,1000);
      if(!reason) return lib.json(400,{error:'Void reason is required.'});
      const patch={status:'VOID',voided_at:new Date().toISOString(),void_reason:reason,updated_at:new Date().toISOString()};
      await lib.sbJson(`/rest/v1/invoices?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      await history(inv,patch,reason,auth.user);
      return lib.json(200,{ok:true});
    }

    return lib.json(400,{error:'Unknown action'});
  }catch(e){
    console.error('admin-invoice-action',e);
    return lib.json(e.status||500,{error:e.message||'Invoice action failed.'});
  }
};
