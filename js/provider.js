(()=>{
 const loading=document.getElementById('provider-loading'),app=document.getElementById('provider-app'),alertBox=document.getElementById('provider-alert');let data=null;
 const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const fmt=v=>v?new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Edmonton'}).format(new Date(v)):'—';
 const RESPONSE_MAX=500;
 const responseDrafts=new Map();
 function responseDraft(id){return responseDrafts.get(id)||'';}
 function isEditingResponse(){return document.activeElement?.classList?.contains('provider-response-note')||false;}
 function snapshotResponseDrafts(){document.querySelectorAll('.provider-response-note').forEach(el=>responseDrafts.set(el.dataset.id,el.value.slice(0,RESPONSE_MAX)));}
 function show(msg,type='error'){alertBox.hidden=false;alertBox.className=`form-alert ${type}`;alertBox.textContent=msg;window.scrollTo({top:0,behavior:'smooth'});}
 async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{...(opt.body?{'content-type':'application/json'}:{}),...(opt.headers||{})},...opt}),d=await r.json().catch(()=>({}));if(r.status===401){location.replace('provider-login.html');throw new Error('Session expired.');}if(!r.ok)throw new Error(d.error||'Request failed.');return d;}
 function statusBadge(s){return `<span class="status-badge status-${String(s).toLowerCase().replaceAll('_','-')}">${esc(s)}</span>`;}
 function assignmentCard(a,showActions=false){
  const j=a.jobs||{},draft=responseDraft(a.id);
  return `<article class="provider-job-card"><div class="provider-job-card-head"><div><strong>${esc(j.reference||'PLEASE Job')}</strong><span>${esc(j.service_name||'Service')}</span></div>${statusBadge(a.status)}</div><div class="provider-job-meta"><span><b>Date:</b> ${esc(fmt(a.scheduled_start))}</span><span><b>End:</b> ${esc(fmt(a.scheduled_end))}</span><span><b>Address:</b> ${esc(j.work_address||'—')}</span><span><b>Duration:</b> ${j.estimated_duration_minutes?`${esc(j.estimated_duration_minutes)} min`:'—'}</span></div><p>${esc(j.work_description||'')}</p>${a.assignment_message?`<div class="provider-job-note"><b>PLEASE note:</b> ${esc(a.assignment_message)}</div>`:''}${a.provider_response_note?`<div class="provider-job-note"><b>Your response:</b> ${esc(a.provider_response_note)}</div>`:''}${showActions&&a.status==='PENDING'?`<div class="provider-job-actions provider-response-actions"><label class="provider-response-field"><span>Optional response to PLEASE</span><textarea class="provider-response-note" data-id="${a.id}" maxlength="${RESPONSE_MAX}" rows="3" placeholder="Optional response note">${esc(draft)}</textarea><small><span class="provider-response-count" data-id="${a.id}">${draft.length}</span> / ${RESPONSE_MAX}</small></label><div class="provider-response-buttons"><button class="btn primary provider-confirm" data-id="${a.id}">CONFIRM</button><button class="admin-danger-button provider-decline" data-id="${a.id}">DECLINE</button></div></div>`:''}</article>`;
 }
 function stats(){const as=data.assignments||[];document.getElementById('provider-stat-pending').textContent=as.filter(x=>x.status==='PENDING').length;document.getElementById('provider-stat-confirmed').textContent=as.filter(x=>x.status==='CONFIRMED').length;document.getElementById('provider-stat-completed').textContent=as.filter(x=>x.status==='COMPLETED').length;document.getElementById('provider-stat-services').textContent=(data.services||[]).length;document.getElementById('provider-pending-count').textContent=as.filter(x=>x.status==='PENDING').length;}
 function renderOverview(){const now=Date.now(),next=(data.assignments||[]).filter(x=>['PENDING','CONFIRMED'].includes(x.status)&&new Date(x.scheduled_end).getTime()>=now).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start)).slice(0,4);document.getElementById('provider-next-assignments').innerHTML=next.length?next.map(x=>assignmentCard(x,false)).join(''):'<p class="admin-muted">No upcoming assignments.</p>';const sv=(data.services||[]);document.getElementById('provider-services').innerHTML=sv.length?sv.map(s=>`<article><strong>${esc(s.name)}</strong><p>${esc(s.short_description||'')}</p></article>`).join(''):'<p class="admin-muted">No assigned services.</p>';}
 function bindAssignmentActions(){
  document.querySelectorAll('.provider-response-note').forEach(el=>{
    const id=el.dataset.id;
    el.addEventListener('input',()=>{
      if(el.value.length>RESPONSE_MAX)el.value=el.value.slice(0,RESPONSE_MAX);
      responseDrafts.set(id,el.value);
      const counter=document.querySelector(`.provider-response-count[data-id="${id}"]`);
      if(counter)counter.textContent=String(el.value.length);
    });
  });
  document.querySelectorAll('.provider-confirm').forEach(b=>b.onclick=()=>respond(b.dataset.id,'CONFIRM'));
  document.querySelectorAll('.provider-decline').forEach(b=>b.onclick=()=>{if(confirm('Decline this assignment? PLEASE will need to reassign the job.'))respond(b.dataset.id,'DECLINE');});
 }
 function renderAssignments(){const as=(data.assignments||[]).filter(x=>['PENDING','CONFIRMED'].includes(x.status)).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start));document.getElementById('provider-assignments').innerHTML=as.length?as.map(x=>assignmentCard(x,true)).join(''):'<p class="admin-muted">No pending or confirmed assignments.</p>';bindAssignmentActions();}
 function renderHistory(){const as=(data.assignments||[]).filter(x=>['COMPLETED','DECLINED','CANCELLED'].includes(x.status)||new Date(x.scheduled_end).getTime()<Date.now()).sort((a,b)=>new Date(b.scheduled_start)-new Date(a.scheduled_start));document.getElementById('provider-history').innerHTML=as.length?as.map(x=>assignmentCard(x,false)).join(''):'<p class="admin-muted">No service history yet.</p>';}
 function weeklyUI(){
  const map=new Map((data.availability||[]).map(x=>[Number(x.weekday),x]));
  document.getElementById('provider-weekly-availability').innerHTML=weekdays.map((day,i)=>{const x=map.get(i+1);return `<div class="developer-availability-row"><label><input type="checkbox" class="provider-day-active" data-day="${i+1}" ${x?'checked':''}> ${day}</label><input type="time" class="provider-day-start" data-day="${i+1}" value="${x?String(x.start_time).slice(0,5):'08:00'}"><span>to</span><input type="time" class="provider-day-end" data-day="${i+1}" value="${x?String(x.end_time).slice(0,5):'17:00'}"></div>`}).join('');
  const blocking=(data.assignments||[]).filter(x=>['PENDING','CONFIRMED'].includes(x.status)).sort((a,b)=>new Date(a.scheduled_start)-new Date(b.scheduled_start));
  const target=document.getElementById('provider-reserved-times');
  if(target){
    target.innerHTML=blocking.length?blocking.map(a=>{const j=a.jobs||{}, pending=a.status==='PENDING';return `<article class="provider-reserved-card ${pending?'pending':'confirmed'}"><div><strong>NOT AVAILABLE · ${esc(fmt(a.scheduled_start))}</strong><span>until ${esc(fmt(a.scheduled_end))}</span><p>${esc(j.reference||'PLEASE assignment')} · ${esc(j.service_name||'Service')} · ${pending?'Pending your confirmation':'Confirmed job'}</p></div>${statusBadge(a.status)}</article>`}).join(''):'<p class="admin-muted">No PLEASE-reserved times at the moment.</p>';
  }
 }
 function exceptionsUI(){const ex=data.exceptions||[];document.getElementById('provider-exceptions').innerHTML=ex.length?ex.map(x=>`<article class="provider-exception-card"><div><strong>${esc(x.exception_date)} · ${esc(x.exception_type)}</strong><span>${x.start_time?`${esc(String(x.start_time).slice(0,5))}–${esc(String(x.end_time).slice(0,5))}`:'All day'}</span><p>${esc(x.reason||'')}</p></div><button class="admin-danger-button provider-delete-exception" data-id="${x.id}">Remove</button></article>`).join(''):'<p class="admin-muted">No date exceptions.</p>';document.querySelectorAll('.provider-delete-exception').forEach(b=>b.onclick=()=>deleteException(b.dataset.id));}
 function renderProfile(){const p=data.provider||{};document.getElementById('provider-profile').innerHTML=[['Provider Reference',p.reference],['Display Name',p.display_name],['Company',p.company_name||'—'],['Public Title',p.public_title||'—'],['Service Area',p.service_area||'—'],['Licensed / Certified',p.licensed_certified?'Yes':'No'],['Insured',p.insured?'Yes':'No'],['Public Landing',p.public_visible?'Enabled':'Hidden']].map(([l,v])=>`<div><span>${esc(l)}</span><strong>${esc(v||'—')}</strong></div>`).join('');document.getElementById('provider-profile-services').innerHTML=(data.services||[]).map(s=>`<article><strong>${esc(s.name)}</strong><p>${esc(s.short_description||'')}</p></article>`).join('')||'<p class="admin-muted">No assigned services.</p>';}
 function render(){document.getElementById('provider-name').textContent=data.user.display_name;document.getElementById('provider-email').textContent=data.user.email;document.getElementById('provider-welcome').textContent=`Welcome, ${data.provider.display_name}`;stats();renderOverview();renderAssignments();renderHistory();weeklyUI();exceptionsUI();renderProfile();}
 let lastPendingIds=new Set();
 async function load({silent=false}={}){
   snapshotResponseDrafts();
   const next=await api('/.netlify/functions/provider-dashboard');
   const pendingIds=new Set((next.assignments||[]).filter(x=>x.status==='PENDING').map(x=>x.id));
   const hasNew=[...pendingIds].some(id=>!lastPendingIds.has(id));
   // Remove drafts only for assignments that are no longer pending.
   for(const id of [...responseDrafts.keys()])if(!pendingIds.has(id))responseDrafts.delete(id);
   data=next; render(); lastPendingIds=pendingIds;
   if(hasNew&&!silent) show('New PLEASE assignment received. The scheduled time is now reserved and you are unavailable for another PLEASE service during that window.','success');
 }
 async function respond(id,action){
   const el=document.querySelector(`.provider-response-note[data-id="${id}"]`);
   const note=(el?.value??responseDraft(id)).slice(0,RESPONSE_MAX);
   if(note.length>RESPONSE_MAX)return show(`Response must be ${RESPONSE_MAX} characters or fewer.`);
   try{
     await api('/.netlify/functions/provider-assignment-action',{method:'POST',body:JSON.stringify({assignment_id:id,action,note})});
     responseDrafts.delete(id);
     show(`Assignment ${action==='CONFIRM'?'confirmed':'declined'}.`,'success');
     await load();
   }catch(e){show(e.message);}
 }
 async function saveWeekly(){const availability=[...document.querySelectorAll('.provider-day-active:checked')].map(x=>{const d=x.dataset.day;return{weekday:Number(d),start_time:document.querySelector(`.provider-day-start[data-day="${d}"]`).value,end_time:document.querySelector(`.provider-day-end[data-day="${d}"]`).value,active:true}});try{await api('/.netlify/functions/provider-availability-action',{method:'POST',body:JSON.stringify({action:'SAVE_WEEKLY',payload:{availability}})});show('Weekly availability saved.','success');await load();}catch(e){show(e.message);}}
 async function addException(){const payload={exception_date:document.getElementById('provider-exception-date').value,exception_type:document.getElementById('provider-exception-type').value,start_time:document.getElementById('provider-exception-start').value,end_time:document.getElementById('provider-exception-end').value,reason:document.getElementById('provider-exception-reason').value};try{await api('/.netlify/functions/provider-availability-action',{method:'POST',body:JSON.stringify({action:'ADD_EXCEPTION',payload})});show('Availability exception added.','success');await load();}catch(e){show(e.message);}}
 async function deleteException(id){try{await api('/.netlify/functions/provider-availability-action',{method:'POST',body:JSON.stringify({action:'DELETE_EXCEPTION',payload:{exception_id:id}})});show('Availability exception removed.','success');await load();}catch(e){show(e.message);}}
 function exportCsv(){const rows=[['Job Reference','Service','Start','End','Address','Assignment Status','Job Status']];for(const a of data.assignments||[]){const j=a.jobs||{};rows.push([j.reference||'',j.service_name||'',a.scheduled_start||'',a.scheduled_end||'',j.work_address||'',a.status||'',j.status||'']);}const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n'),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`PLEASE-provider-history-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);}
 function tab(name){document.querySelectorAll('.provider-tab').forEach(x=>x.hidden=true);document.getElementById(`provider-tab-${name}`).hidden=false;document.querySelectorAll('[data-provider-tab]').forEach(x=>x.classList.toggle('active',x.dataset.providerTab===name));history.replaceState(null,'',`#${name}`);}
 document.querySelectorAll('[data-provider-tab]').forEach(x=>x.onclick=e=>{e.preventDefault();tab(x.dataset.providerTab);});document.getElementById('provider-refresh').onclick=()=>load({silent:true}).then(()=>show('Portal refreshed.','success')).catch(e=>show(e.message));document.getElementById('provider-save-weekly').onclick=saveWeekly;document.getElementById('provider-add-exception').onclick=addException;document.getElementById('provider-export-csv').onclick=exportCsv;document.getElementById('provider-signout').onclick=async()=>{try{await api('/.netlify/functions/provider-logout',{method:'POST',body:'{}'});}catch(_){}location.replace('provider-login.html');};
 (async()=>{try{await api('/.netlify/functions/provider-session');loading.remove();app.hidden=false;await load({silent:true});const h=location.hash.slice(1);if(['overview','assignments','availability','history','profile'].includes(h))tab(h);
   // Keep an already-open provider portal synchronized with PLEASE assignments.
   // Never re-render while the provider is actively typing a response; this prevents lost text.
   setInterval(()=>{if(!document.hidden&&!isEditingResponse())load({silent:false}).catch(()=>{});},15000);
   document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!isEditingResponse())load({silent:false}).catch(()=>{});});
  }catch(e){if(loading?.isConnected)loading.textContent=e.message||'Unable to load provider portal.';}})();
})();
