(()=>{
 const form=document.getElementById('service-request-form'),service=document.getElementById('request-service'),alertBox=document.getElementById('request-alert'),submit=document.getElementById('request-submit'),success=document.getElementById('request-success'),selectedWrap=document.getElementById('request-selected-service'),selectedName=document.getElementById('request-selected-service-name'),fallback=document.getElementById('request-service-fallback'),moving=document.getElementById('moving-request-fields');
 let services=[];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function show(m,t='error'){alertBox.hidden=false;alertBox.className=`form-alert ${t}`;alertBox.textContent=m;}
 async function api(options={}){const r=await fetch('/.netlify/functions/public-service-request',{cache:'no-store',headers:{...(options.body?{'content-type':'application/json'}:{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed.');return d;}
 function isMoving(){const opt=service.options[service.selectedIndex];return String(opt?.textContent||'').trim().toLowerCase()==='moving';}
 function syncMoving(){const on=isMoving();moving.hidden=!on;['moving_bedrooms','moving_square_feet','moving_inventory'].forEach(n=>{const el=form.elements[n];if(el)el.required=on;});}
 function normName(v){return String(v||'').trim().toLowerCase().replace(/&amp;/g,'&').replace(/^handyman\s*&\s*/,'').replace(/\s+/g,' ');}function selectByName(name){const n=normName(name);let opt=[...service.options].find(o=>normName(o.textContent)===n);if(!opt&&n.includes('furniture assembly'))opt=[...service.options].find(o=>normName(o.textContent).includes('furniture assembly'));if(!opt&&n.includes('custom request'))opt=[...service.options].find(o=>/custom|other|any service/i.test(o.textContent));if(opt){service.value=opt.value;selectedWrap.hidden=false;fallback.hidden=true;selectedName.textContent=name||opt.textContent;service.required=true;return true;}return false;}
 async function init(){
   try{const d=await api();services=d.services||[];service.innerHTML='<option value="">Select service</option>'+services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');}
   catch(e){service.innerHTML='<option value="">Services temporarily unavailable</option>';show(e.message);return;}
   let prefill=null;try{prefill=JSON.parse(sessionStorage.getItem('please_request_prefill')||'null');}catch{}
   if(prefill){['first_name','email','phone','work_description'].forEach(k=>{if(prefill[k]&&form.elements[k])form.elements[k].value=prefill[k]});if(!selectByName(prefill.service_type)){fallback.hidden=false;selectedWrap.hidden=true;}sessionStorage.removeItem('please_request_prefill');}
   else {fallback.hidden=false;selectedWrap.hidden=true;}
   syncMoving();
 }
 service.addEventListener('change',()=>{if(!fallback.hidden&&service.value){selectedName.textContent=service.options[service.selectedIndex]?.textContent||'';}syncMoving();});
 form.addEventListener('submit',async e=>{e.preventDefault();alertBox.hidden=true;if(!service.value)return show('Please select a service.');if(isMoving()){const b=Number(form.elements.moving_bedrooms.value),sf=Number(form.elements.moving_square_feet.value),inv=form.elements.moving_inventory.value.trim();if(!Number.isFinite(b)||b<0||!Number.isFinite(sf)||sf<=0||!inv)return show('Please complete all Moving details.');}
   submit.disabled=true;submit.textContent='SUBMITTING…';
   try{const f=new FormData(form),payload=Object.fromEntries(f.entries());payload.service_id=service.value;const d=await api({method:'POST',body:JSON.stringify(payload)});form.hidden=true;success.hidden=false;document.getElementById('request-reference').textContent=d.reference;const a=document.getElementById('request-track-link'),u=d.tracking_url||`track-request.html?token=${encodeURIComponent(d.tracking_token||'')}`;a.href=u;document.getElementById('request-copy-track').onclick=async()=>{try{await navigator.clipboard.writeText(new URL(u,location.href).href);document.getElementById('request-copy-track').textContent='LINK COPIED ✓';}catch{prompt('Copy tracking link:',new URL(u,location.href).href);}};success.scrollIntoView({behavior:'smooth',block:'start'});}
   catch(err){show(err.message);}
   finally{submit.disabled=false;submit.textContent='SUBMIT SERVICE REQUEST →';}
 });
 init();
})();