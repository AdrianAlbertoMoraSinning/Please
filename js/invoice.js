(async()=>{
 const box=document.getElementById('invoice-public'),params=new URLSearchParams(location.search),token=params.get('token')||'',sessionId=params.get('session_id')||'',payment=params.get('payment')||'';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c='CAD')=>new Intl.NumberFormat('en-CA',{style:'currency',currency:String(c||'CAD').toUpperCase()}).format(Number(n)||0);
 const date=v=>{if(!v)return '';try{return new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch{return String(v)}};
 function banner(i){
   if(payment==='cancelled')return `<div class="invoice-result-banner warn"><strong>Payment cancelled.</strong><span>Your invoice is still outstanding. You can pay whenever you are ready.</span></div>`;
   if(payment==='success'||sessionId)return `<div class="invoice-result-banner info"><strong>Payment submitted.</strong><span>Stripe confirmation is checked automatically. Paid invoices remain visible from this link.</span></div>`;
   if(i.payment_status==='PENDING')return `<div class="invoice-result-banner info"><strong>Payment in progress.</strong><span>A Stripe Checkout session was opened for this invoice. If you did not finish, you can safely start again.</span></div>`;
   return '';
 }
 function paymentPanel(i,p,balance){
   const cur=i.currency||'CAD';
   if(i.is_paid||i.payment_status==='PAID')return `<div class="invoice-payment-panel paid-panel"><h3>Payment received</h3><p>This invoice has been paid. Thank you.</p>${i.paid_at?`<p><strong>Paid on:</strong> ${esc(date(i.paid_at))}</p>`:''}${i.payment_reference?`<p><strong>Stripe confirmation:</strong> ${esc(i.payment_reference)}</p>`:''}${p.latest_transaction?.note?.includes('Receipt URL:')?`<p class="small-muted">A Stripe receipt was generated and is available in the payment record.</p>`:''}</div>`;
   if(p.stripe_enabled)return `<div class="invoice-payment-panel"><h3>Pay securely online</h3><p>Card payment is processed on Stripe-hosted checkout.</p><button id="pay-now" class="btn primary" type="button">${payment==='cancelled'?'PAY AGAIN':'PAY'} ${money(balance,cur)} →</button><div id="pay-error" class="form-alert" hidden></div></div>`;
   return `<div class="invoice-payment-panel"><h3>Payment</h3><p>Online card payment is not activated yet. Please contact PLEASE Services for payment instructions.</p><a class="btn primary" href="mailto:info@pleaseservice.ca?subject=Payment%20for%20${encodeURIComponent(i.invoice_number)}">CONTACT PLEASE</a></div>`;
 }
 async function load(){
   const query=new URLSearchParams();
   if(token)query.set('token',token);
   if(sessionId)query.set('session_id',sessionId);
   const r=await fetch('/.netlify/functions/public-invoice?'+query.toString(),{cache:'no-store'});
   const p=await r.json();
   if(!r.ok)throw Error(p.error||'Invoice unavailable');
   return p;
 }
 try{
   const p=await load(),i=p.invoice,payToken=token||i.public_token||'',balance=Math.max(0,Number(i.balance??i.total_amount)-Number(i.balance!=null?0:i.amount_paid||0));
   const cur=i.currency||'CAD';
   box.innerHTML=`${banner(i)}<div class="invoice-public-head"><img src="images/please-logo.png" alt="PLEASE Services"><div class="invoice-public-meta"><h1>${esc(i.invoice_number)}</h1><p>Invoice date: ${esc(i.invoice_date)}<br>${i.due_date?`Due date: ${esc(i.due_date)}<br>`:''}</p>${i.is_paid||i.payment_status==='PAID'?'<span class="invoice-paid-badge">PAID</span>':'<span class="invoice-unpaid-badge">PAYMENT DUE</span>'}</div></div><hr><h3>Bill To</h3><p>${esc(i.client_name||'Customer')}</p><table class="invoice-public-table"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${(p.items||[]).map(x=>`<tr><td>${esc(x.description)}</td><td>${Number(x.qty)}</td><td>${money(x.unit_rate,cur)}</td><td>${money(x.line_total,cur)}</td></tr>`).join('')}</tbody></table><div class="invoice-totals"><div class="invoice-total-line"><span>Subtotal</span><strong>${money(i.subtotal,cur)}</strong></div><div class="invoice-total-line"><span>GST (${Number(i.gst_rate)}%)</span><strong>${money(i.gst_amount,cur)}</strong></div><div class="invoice-total-line grand"><span>Total</span><strong>${money(i.total_amount,cur)}</strong></div>${Number(i.amount_paid)>0?`<div class="invoice-total-line"><span>Paid</span><strong>${money(i.amount_paid,cur)}</strong></div><div class="invoice-total-line grand"><span>Balance</span><strong>${money(balance,cur)}</strong></div>`:''}</div>${i.note?`<p><strong>Note:</strong> ${esc(i.note)}</p>`:''}${paymentPanel(i,p,balance)}<p style="margin-top:24px">PLEASE Services · Calgary, Alberta · info@pleaseservice.ca · 587-836-2866</p>`;
   const b=document.getElementById('pay-now');
   if(b)b.onclick=async()=>{b.disabled=true;b.textContent='Opening secure checkout…';try{const rr=await fetch('/.netlify/functions/invoice-checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:payToken})}),pp=await rr.json();if(!rr.ok)throw Error(pp.error||'Unable to start payment');location.href=pp.url}catch(e){const a=document.getElementById('pay-error');a.textContent=e.message;a.hidden=false;b.disabled=false;b.textContent=(payment==='cancelled'?'PAY AGAIN ':'PAY ')+money(balance,cur)+' →'}};
 }catch(e){
   box.innerHTML=`<div class="invoice-result-banner danger"><strong>Invoice unavailable</strong><span>${esc(e.message||'This invoice link is invalid or expired.')}</span></div><p>Please contact PLEASE Services if you believe this invoice should be available.</p><a class="btn secondary" href="index.html">Back to PLEASE Services</a>`;
 }
})();
