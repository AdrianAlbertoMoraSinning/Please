(()=>{
 const form=document.getElementById('service-request-form'), service=document.getElementById('request-service'), alertBox=document.getElementById('request-alert'), submit=document.getElementById('request-submit'), success=document.getElementById('request-success');
 const show=(msg,type='error')=>{alertBox.hidden=false;alertBox.className=`form-alert ${type}`;alertBox.textContent=msg;};
 async function api(options={}){const r=await fetch('/.netlify/functions/public-service-request',{cache:'no-store',headers:{...(options.body?{'content-type':'application/json'}:{})},...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed.');return d;}
 async function init(){try{const d=await api();service.innerHTML='<option value="">Select service</option>'+d.services.map(s=>`<option value="${s.id}">${String(s.name).replaceAll('&','&amp;').replaceAll('<','&lt;')}</option>`).join('');}catch(e){service.innerHTML='<option value="">Services temporarily unavailable</option>';show(e.message);}
   try{const p=JSON.parse(sessionStorage.getItem('please_request_prefill')||'null');if(p){['first_name','email','phone','work_description'].forEach(k=>{if(p[k]&&form.elements[k])form.elements[k].value=p[k]});sessionStorage.removeItem('please_request_prefill');}}catch{}
 }
 form.addEventListener('submit',async e=>{e.preventDefault();alertBox.hidden=true;submit.disabled=true;submit.textContent='SUBMITTING…';try{const fd=new FormData(form),payload=Object.fromEntries(fd.entries());const d=await api({method:'POST',body:JSON.stringify(payload)});form.hidden=true;success.hidden=false;document.getElementById('request-reference').textContent=d.reference;window.scrollTo({top:0,behavior:'smooth'});}catch(err){show(err.message);}finally{submit.disabled=false;submit.textContent='SUBMIT SERVICE REQUEST →';}});
 init();
})();
