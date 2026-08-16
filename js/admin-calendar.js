(() => {
  const TZ='America/Edmonton';
  const loading=document.getElementById('admin-loading'), app=document.getElementById('admin-app');
  const grid=document.getElementById('calendar-grid'), alertBox=document.getElementById('calendar-alert');
  const serviceFilter=document.getElementById('calendar-service'), providerFilter=document.getElementById('calendar-provider');
  const drawer=document.getElementById('job-drawer'), backdrop=document.getElementById('calendar-backdrop');
  const form=document.getElementById('job-form'), submitBtn=document.getElementById('job-submit');
  const unassignedBody=document.getElementById('unassigned-body'), unassignedEmpty=document.getElementById('unassigned-empty');
  let data={providers:[],provider_services:[],services:[],availability:[],exceptions:[],assignments:[],needs_assignment:[]};
  let weekStart=startOfWeek(new Date());
  let weekDates=[];

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function api(url, options={}) {
    const r=await fetch(url,{credentials:'same-origin',headers:{'content-type':'application/json',...(options.headers||{})},...options});
    const text=await r.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={error:text};}
    if(r.status===401){location.replace('admin-login.html');throw new Error('Session expired');}
    if(!r.ok) throw new Error(payload.error||`Request failed (${r.status})`);
    return payload;
  }
  async function ensureSession(){const s=await api('/.netlify/functions/admin-session');$('admin-name').textContent=s.user?.display_name||'PLEASE Administrator';$('admin-email').textContent=s.user?.email||'';}
  function showAlert(msg,type='error'){alertBox.textContent=msg;alertBox.className=`form-alert ${type==='success'?'success':''}`;alertBox.hidden=false;window.scrollTo({top:0,behavior:'smooth'});}
  function clearAlert(){alertBox.hidden=true;}

  function startOfWeek(date){
    const d=new Date(date); d.setHours(12,0,0,0); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return d;
  }
  function addDays(date,n){const d=new Date(date);d.setDate(d.getDate()+n);return d;}
  function ymd(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function fmtWeek(){const end=addDays(weekStart,6);return `${weekStart.toLocaleDateString('en-CA',{month:'short',day:'numeric'})} – ${end.toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})}`;}
  function localParts(iso){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
    const o={};parts.forEach(p=>{if(p.type!=='literal')o[p.type]=p.value;});return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`};
  }
  function localToIso(date,time){
    // Convert a Calgary wall-clock time to UTC without relying on the browser's own timezone.
    const [Y,M,D]=date.split('-').map(Number), [h,m]=time.split(':').map(Number);
    const desired=Date.UTC(Y,M-1,D,h,m,0); let guess=desired;
    for(let i=0;i<3;i++){
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
      const o={};parts.forEach(p=>{if(p.type!=='literal')o[p.type]=p.value;});
      const represented=Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute,+o.second);
      guess += desired-represented;
    }
    return new Date(guess).toISOString();
  }
  function time12(t){if(!t)return '';const [hh,mm]=t.slice(0,5).split(':').map(Number);return `${((hh+11)%12)+1}:${String(mm).padStart(2,'0')} ${hh>=12?'PM':'AM'}`;}
  function durationLabel(min){if(!min)return '—';const h=Math.floor(min/60),m=min%60;return [h?`${h}h`:'',m?`${m}m`:''].filter(Boolean).join(' ');}
  function statusLabel(s){return ({PENDING:'Pending',CONFIRMED:'Confirmed',DECLINED:'Declined',CANCELLED:'Cancelled',COMPLETED:'Completed'})[s]||s;}

  function providerServiceIds(pid){return new Set(data.provider_services.filter(x=>x.provider_id===pid&&x.active).map(x=>x.service_id));}
  function providerMatches(pid){const service=serviceFilter.value;return service==='ALL'||providerServiceIds(pid).has(service);}
  function eligibleProviders(serviceId){return data.providers.filter(p=>providerServiceIds(p.id).has(serviceId));}

  function availabilityFor(pid,date){
    const d=new Date(`${date}T12:00:00`), weekday=((d.getDay()+6)%7)+1;
    let windows=data.availability.filter(a=>a.provider_id===pid&&a.weekday===weekday&&a.active).map(a=>({start:a.start_time.slice(0,5),end:a.end_time.slice(0,5),type:'AVAILABLE'}));
    const ex=data.exceptions.filter(e=>e.provider_id===pid&&e.exception_date===date);
    const special=ex.filter(e=>e.exception_type==='AVAILABLE');
    if(special.length) windows.push(...special.map(e=>({start:e.start_time?.slice(0,5)||'00:00',end:e.end_time?.slice(0,5)||'23:59',type:'AVAILABLE',special:true})));
    return {windows,blocked:ex.filter(e=>e.exception_type==='UNAVAILABLE')};
  }
  function assignmentFor(pid,date){return data.assignments.filter(a=>a.provider_id===pid&&localParts(a.scheduled_start).date===date);}
  function providerWindowText(pid,date){const av=availabilityFor(pid,date);if(av.blocked.some(e=>!e.start_time&&!e.end_time))return 'Unavailable all day';if(!av.windows.length)return 'Not scheduled';return av.windows.map(w=>`${time12(w.start)}–${time12(w.end)}`).join(', ');}

  function renderFilters(){
    const currentS=serviceFilter.value,currentP=providerFilter.value;
    serviceFilter.innerHTML='<option value="ALL">All services</option>'+data.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    providerFilter.innerHTML='<option value="ALL">All providers</option>'+data.providers.map(p=>`<option value="${p.id}">${esc(p.display_name)}</option>`).join('');
    if([...serviceFilter.options].some(o=>o.value===currentS))serviceFilter.value=currentS;
    if([...providerFilter.options].some(o=>o.value===currentP))providerFilter.value=currentP;
  }

  function renderCalendar(){
    weekDates=Array.from({length:7},(_,i)=>ymd(addDays(weekStart,i))); $('week-label').textContent=fmtWeek();
    const providers=data.providers.filter(p=>providerMatches(p.id)&&(providerFilter.value==='ALL'||providerFilter.value===p.id));
    const headers=weekDates.map(d=>{const dt=new Date(`${d}T12:00:00`);return `<div class="calendar-day-head"><strong>${dt.toLocaleDateString('en-CA',{weekday:'short'})}</strong><span>${dt.toLocaleDateString('en-CA',{month:'short',day:'numeric'})}</span></div>`}).join('');
    let html=`<div class="calendar-corner">Provider</div>${headers}`;
    if(!providers.length){grid.innerHTML='<div class="admin-empty calendar-empty-wide">No active providers match the selected filters.</div>';return;}
    providers.forEach(p=>{
      const services=[...providerServiceIds(p.id)].map(id=>data.services.find(s=>s.id===id)?.name).filter(Boolean);
      html+=`<div class="calendar-provider-label"><strong>${esc(p.display_name)}</strong><span>${esc(p.public_title||p.company_name||'Service Provider')}</span><small>${esc(services.join(' · '))}</small></div>`;
      weekDates.forEach(date=>{
        const av=availabilityFor(p.id,date), assignments=assignmentFor(p.id,date);
        const fullBlocked=av.blocked.some(e=>!e.start_time&&!e.end_time);
        html+=`<div class="calendar-cell ${fullBlocked?'calendar-cell-blocked':''}" data-provider="${p.id}" data-date="${date}">
          <div class="calendar-availability-line">${esc(providerWindowText(p.id,date))}</div>
          ${av.blocked.filter(e=>e.start_time&&e.end_time).map(e=>`<div class="calendar-block-chip">Unavailable ${time12(e.start_time.slice(0,5))}–${time12(e.end_time.slice(0,5))}</div>`).join('')}
          ${assignments.map(a=>{const lp=localParts(a.scheduled_start),le=localParts(a.scheduled_end),j=a.jobs||{};return `<button type="button" class="calendar-assignment ${a.status.toLowerCase()}" data-assignment="${a.id}"><span>${time12(lp.time)}–${time12(le.time)}</span><strong>${esc(j.service_name||'Service')}</strong><small>${esc(j.reference||'')}</small></button>`}).join('')}
          ${!fullBlocked?'<button type="button" class="calendar-add-slot" aria-label="Create job assignment">+</button>':''}
        </div>`;
      });
    });
    grid.innerHTML=html;
    grid.querySelectorAll('.calendar-add-slot').forEach(btn=>btn.addEventListener('click',()=>{const cell=btn.closest('.calendar-cell');openNewJob({provider_id:cell.dataset.provider,date:cell.dataset.date});}));
    grid.querySelectorAll('.calendar-assignment').forEach(btn=>btn.addEventListener('click',()=>openAssignment(btn.dataset.assignment)));
  }

  function renderUnassigned(){
    const rows=data.needs_assignment||[]; $('needs-assignment-count').textContent=rows.length; unassignedEmpty.hidden=rows.length>0;unassignedBody.innerHTML='';
    rows.forEach(j=>{const c=j.customers||{};const tr=document.createElement('tr');tr.innerHTML=`<td><strong class="admin-reference">${esc(j.reference)}</strong></td><td><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'Customer')}</strong><small>${esc(c.email||c.phone||'')}</small></td><td>${esc(j.service_name)}</td><td>${esc(j.work_address)}</td><td>${esc(durationLabel(j.estimated_duration_minutes))}</td><td><button type="button" class="admin-row-button">Assign</button></td>`;tr.querySelector('button').addEventListener('click',()=>openExistingJob(j));unassignedBody.appendChild(tr);});
  }

  async function loadCalendar(){
    clearAlert(); const from=ymd(weekStart),to=ymd(addDays(weekStart,6));
    data=await api(`/.netlify/functions/admin-calendar-data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    renderFilters();renderCalendar();renderUnassigned();
  }

  function populateJobProviders(serviceId,preferred=''){
    const select=$('job-provider');const providers=eligibleProviders(serviceId);select.innerHTML='<option value="">Select provider</option>'+providers.map(p=>`<option value="${p.id}">${esc(p.display_name)} — ${esc(p.public_title||p.company_name||'Provider')}</option>`).join('');if(providers.some(p=>p.id===preferred))select.value=preferred;updateAvailabilityNote();
  }
  function setExistingMode(existing){
    ['customer-first-name','customer-last-name','customer-email','customer-phone'].forEach(id=>$(id).disabled=existing);
    ['job-service','job-address','job-description','job-internal-notes'].forEach(id=>$(id).disabled=existing);
    $('customer-section').classList.toggle('calendar-section-readonly',existing);
  }
  function resetForm(){form.reset();$('job-existing-id').value='';$('job-drawer-title').textContent='Create & Assign Job';$('job-drawer-eyebrow').textContent='NEW SERVICE REQUEST';setExistingMode(false);$('job-date').value=ymd(new Date());$('job-start').value='09:00';$('job-end').value='11:00';$('job-service').innerHTML='<option value="">Select service</option>'+data.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');populateJobProviders('');}
  function openDrawer(){drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');backdrop.hidden=false;document.body.classList.add('admin-drawer-open');}
  function closeDrawer(){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');backdrop.hidden=true;document.body.classList.remove('admin-drawer-open');}
  function openNewJob(prefill={}){resetForm();if(prefill.date)$('job-date').value=prefill.date;if(prefill.provider_id){const ids=[...providerServiceIds(prefill.provider_id)];if(serviceFilter.value!=='ALL'&&ids.includes(serviceFilter.value))$('job-service').value=serviceFilter.value;else if(ids.length===1)$('job-service').value=ids[0];populateJobProviders($('job-service').value,prefill.provider_id);}openDrawer();updateAvailabilityNote();}
  function openExistingJob(j){resetForm();$('job-existing-id').value=j.id;$('job-drawer-title').textContent=`Assign ${j.reference}`;$('job-drawer-eyebrow').textContent='NEEDS ASSIGNMENT';const c=j.customers||{};$('customer-first-name').value=c.first_name||'';$('customer-last-name').value=c.last_name||'';$('customer-email').value=c.email||'';$('customer-phone').value=c.phone||'';$('job-service').value=j.service_id||'';$('job-address').value=j.work_address||'';$('job-description').value=j.work_description||'';$('job-internal-notes').value='';setExistingMode(true);populateJobProviders(j.service_id||'');openDrawer();updateAvailabilityNote();}

  function updateAvailabilityNote(){const pid=$('job-provider').value,date=$('job-date').value;if(!pid||!date){$('provider-availability-note').textContent='Select a provider and date to see availability.';return;}$('provider-availability-note').textContent=`Published availability: ${providerWindowText(pid,date)}. Existing assignments are also checked before saving.`;}

  async function submitJob(e){
    e.preventDefault();clearAlert();const existing=$('job-existing-id').value;const serviceId=$('job-service').value,providerId=$('job-provider').value,date=$('job-date').value,start=$('job-start').value,end=$('job-end').value;
    if(!serviceId||!providerId||!date||!start||!end)return showAlert('Service, provider, date, start and end are required.');
    let startIso,endIso;try{startIso=localToIso(date,start);endIso=localToIso(date,end);}catch{return showAlert('The selected schedule could not be interpreted.');}
    const payload={provider_id:providerId,service_id:serviceId,scheduled_start:startIso,scheduled_end:endIso,assignment_message:$('job-message').value.trim()};
    let action='ASSIGN_EXISTING';
    if(existing){payload.job_id=existing;} else {action='CREATE_AND_ASSIGN';Object.assign(payload,{customer_first_name:$('customer-first-name').value.trim(),customer_last_name:$('customer-last-name').value.trim(),customer_email:$('customer-email').value.trim(),customer_phone:$('customer-phone').value.trim(),work_address:$('job-address').value.trim(),work_description:$('job-description').value.trim(),internal_notes:$('job-internal-notes').value.trim()});}
    submitBtn.disabled=true;submitBtn.textContent='SENDING…';
    try{
      const result=await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action,payload})});
      closeDrawer();await loadCalendar();showAlert(`${result.job_reference||'Job'} assigned and reserved pending provider confirmation.`,'success');
      if(result.assignment_id){api('/.netlify/functions/provider-assignment-notify',{method:'POST',body:JSON.stringify({assignment_id:result.assignment_id})}).catch(()=>{});}
    }catch(err){showAlert(err.message||'Could not create the assignment.');}
    finally{submitBtn.disabled=false;submitBtn.textContent='SEND ASSIGNMENT →';}
  }

  function openAssignment(id){
    const a=data.assignments.find(x=>x.id===id);if(!a)return;const p=data.providers.find(x=>x.id===a.provider_id),j=a.jobs||{},s=localParts(a.scheduled_start),e=localParts(a.scheduled_end),c=j.customers||{};
    $('assignment-modal-content').innerHTML=`<span class="status-badge status-${a.status.toLowerCase()}">${esc(statusLabel(a.status))}</span><h2>${esc(j.reference||'Assignment')}</h2><div class="admin-detail-grid"><div><span>Provider</span><strong>${esc(p?.display_name||'')}</strong></div><div><span>Service</span><strong>${esc(j.service_name||'')}</strong></div><div><span>Date</span><strong>${esc(s.date)}</strong></div><div><span>Time</span><strong>${time12(s.time)}–${time12(e.time)}</strong></div><div><span>Customer</span><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'—')}</strong></div><div><span>Customer Contact</span><strong>${esc(c.email||c.phone||'—')}</strong></div></div><h3>Work Address</h3><p>${esc(j.work_address||'')}</p><h3>Work Description</h3><p class="admin-prewrap">${esc(j.work_description||'')}</p>${a.assignment_message?`<h3>Message to Provider</h3><p>${esc(a.assignment_message)}</p>`:''}${a.provider_response_note?`<h3>Provider Response</h3><p>${esc(a.provider_response_note)}</p>`:''}<div class="calendar-modal-actions">${['PENDING','CONFIRMED'].includes(a.status)?'<button id="cancel-assignment" class="admin-danger-button" type="button">CANCEL ASSIGNMENT</button>':''}</div>`;
    $('assignment-modal').hidden=false;
    const cancel=$('cancel-assignment');if(cancel)cancel.addEventListener('click',async()=>{if(!confirm('Cancel this assignment and return the job to Needs Assignment?'))return;cancel.disabled=true;try{await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action:'CANCEL_ASSIGNMENT',payload:{assignment_id:a.id,note:'Cancelled by PLEASE administration'}})});$('assignment-modal').hidden=true;await loadCalendar();showAlert('Assignment cancelled. The job now needs reassignment.','success');}catch(err){showAlert(err.message);}finally{cancel.disabled=false;}});
  }

  $('new-job').addEventListener('click',()=>openNewJob());
  $('prev-week').addEventListener('click',()=>{weekStart=addDays(weekStart,-7);loadCalendar().catch(e=>showAlert(e.message));});
  $('next-week').addEventListener('click',()=>{weekStart=addDays(weekStart,7);loadCalendar().catch(e=>showAlert(e.message));});
  $('today-week').addEventListener('click',()=>{weekStart=startOfWeek(new Date());loadCalendar().catch(e=>showAlert(e.message));});
  $('refresh-calendar').addEventListener('click',()=>loadCalendar().catch(e=>showAlert(e.message)));
  serviceFilter.addEventListener('change',renderCalendar);providerFilter.addEventListener('change',renderCalendar);
  $('job-service').addEventListener('change',()=>populateJobProviders($('job-service').value));$('job-provider').addEventListener('change',updateAvailabilityNote);$('job-date').addEventListener('change',updateAvailabilityNote);
  $('job-drawer-close').addEventListener('click',closeDrawer);backdrop.addEventListener('click',closeDrawer);form.addEventListener('submit',submitJob);
  $('assignment-modal-close').addEventListener('click',()=>{$('assignment-modal').hidden=true;});$('assignment-modal').addEventListener('click',e=>{if(e.target===$('assignment-modal'))$('assignment-modal').hidden=true;});
  $('admin-signout').addEventListener('click',async()=>{try{await api('/.netlify/functions/admin-logout',{method:'POST',body:'{}'});}catch{}location.replace('admin-login.html');});

  async function init(){try{await ensureSession();loading.hidden=true;loading.remove();app.hidden=false;await loadCalendar();}catch(e){if(loading)loading.textContent=e.message||'Unable to load secure calendar.';}}
  init();
})();
