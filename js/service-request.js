(()=>{
 const form=document.getElementById('service-request-form'),service=document.getElementById('request-service'),alertBox=document.getElementById('request-alert'),submit=document.getElementById('request-submit'),success=document.getElementById('request-success'),selectedWrap=document.getElementById('request-selected-service'),selectedName=document.getElementById('request-selected-service-name'),fallback=document.getElementById('request-service-fallback');
 let services=[];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function show(m,t='error'){alertBox.hidden=false;alertBox.className=`form-alert ${t}`;alertBox.textContent=m;}
 async function api(options={}){
   const method=String(options.method||'GET').toUpperCase();
   const call=async endpoint=>{const r=await fetch(endpoint,{cache:'no-store',headers:{...(options.body?{'content-type':'application/json'}:{})},...options});const d=await r.json().catch(()=>({}));return {r,d};};
   const primary='/.netlify/functions/public-booking',legacy='/.netlify/functions/public-service-request';
   let out;
   try{out=await call(primary);}catch(networkError){if(method!=='GET')throw networkError;out=null;}
   // Catalog GET is safe to retry against the legacy route because it performs no write.
   if(method==='GET'&&(!out||!out.r.ok)){
     try{const fallbackResult=await call(legacy);if(fallbackResult.r.ok||!out)out=fallbackResult;}catch{}
   }
   // POST is retried only when the fresh route is genuinely absent (404), never after a
   // 5xx/network response where the request might already have been stored.
   if(method!=='GET'&&out?.r.status===404)out=await call(legacy);
   if(!out)throw new Error('Unable to reach PLEASE booking service. Please refresh and try again.');
   if(!out.r.ok)throw new Error(out.d.error||`Booking service unavailable (${out.r.status}). Please try again.`);
   return out.d;
 }
 function normName(v){return String(v||'').trim().toLowerCase().replace(/&amp;/g,'&').replace(/^handyman\s*&\s*/,'').replace(/\s+/g,' ');}function selectByName(name){const n=normName(name);let opt=[...service.options].find(o=>normName(o.textContent)===n);if(!opt&&n.includes('furniture assembly'))opt=[...service.options].find(o=>normName(o.textContent).includes('furniture assembly'));if(!opt&&n.includes('custom request'))opt=[...service.options].find(o=>/custom|other|any service/i.test(o.textContent));if(opt){service.value=opt.value;selectedWrap.hidden=false;fallback.hidden=true;selectedName.textContent=name||opt.textContent;service.required=true;return true;}return false;}
 async function init(){
   try{const d=await api();services=d.services||[];service.innerHTML='<option value="">Select service</option>'+services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');}
   catch(e){selectedWrap.hidden=true;fallback.hidden=false;service.innerHTML='<option value="">Unable to load services — please refresh</option>';show(e.message||'Unable to load services. Please refresh the page.');return;}
   let prefill=null;try{prefill=JSON.parse(sessionStorage.getItem('please_request_prefill')||'null');}catch{}
   if(prefill){['first_name','email','phone','work_description'].forEach(k=>{if(prefill[k]&&form.elements[k])form.elements[k].value=prefill[k]});if(!selectByName(prefill.service_type)){fallback.hidden=false;selectedWrap.hidden=true;}sessionStorage.removeItem('please_request_prefill');}
   else {fallback.hidden=false;selectedWrap.hidden=true;}
 }
 service.addEventListener('change',()=>{if(!fallback.hidden&&service.value){selectedName.textContent=service.options[service.selectedIndex]?.textContent||'';}});
 form.addEventListener('submit',async e=>{e.preventDefault();alertBox.hidden=true;if(!service.value)return show('Please select a service.');const hours=Number(form.elements.estimated_hours?.value),time=String(form.elements.preferred_start_time?.value||'');if(!Number.isFinite(hours)||hours<0.25||hours>72)return show('Please enter the estimated number of hours.');if(!/^\d{2}:(00|15|30|45)$/.test(time))return show('Please select a start time in 15-minute increments.');
   submit.disabled=true;submit.textContent='SUBMITTING…';
   try{const f=new FormData(form),payload=Object.fromEntries(f.entries());payload.service_id=service.value;const d=await api({method:'POST',body:JSON.stringify(payload)});form.hidden=true;success.hidden=false;document.getElementById('request-reference').textContent=d.reference;const a=document.getElementById('request-track-link'),u=d.tracking_url||`track-request.html?token=${encodeURIComponent(d.tracking_token||'')}`;a.href=u;const es=document.getElementById('request-email-status');if(es){if(d.email_sent){es.innerHTML='<strong>✓ Confirmation email sent successfully. Please check your inbox.</strong>';}else{es.innerHTML=`<strong>⚠ Your request was saved successfully, but the confirmation email could not be delivered. Please save your tracking link.${d.email_warning?` (${esc(d.email_warning)})`:''}</strong>`;}}document.getElementById('request-copy-track').onclick=async()=>{try{await navigator.clipboard.writeText(new URL(u,location.href).href);document.getElementById('request-copy-track').textContent='LINK COPIED ✓';}catch{prompt('Copy tracking link:',new URL(u,location.href).href);}};success.scrollIntoView({behavior:'smooth',block:'start'});}
   catch(err){show(err.message);}
   finally{submit.disabled=false;submit.textContent='BOOK YOUR SERVICE →';}
 });
 init();
})();