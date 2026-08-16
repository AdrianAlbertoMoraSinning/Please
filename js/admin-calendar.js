(() => {
  const TZ='America/Edmonton';
  const loading=document.getElementById('admin-loading'), app=document.getElementById('admin-app');
  const grid=document.getElementById('calendar-grid'), alertBox=document.getElementById('calendar-alert');
  const serviceFilter=document.getElementById('calendar-service'), providerFilter=document.getElementById('calendar-provider');
  const drawer=document.getElementById('job-drawer'), backdrop=document.getElementById('calendar-backdrop');
  const form=document.getElementById('job-form'), submitBtn=document.getElementById('job-submit');
  const unassignedBody=document.getElementById('unassigned-body'), unassignedEmpty=document.getElementById('unassigned-empty');
  let data={providers:[],provider_services:[],services:[],availability:[],exceptions:[],assignments:[],needs_assignment:[],provider_rates:[],job_billing_items:[],schedule_changes:[]};
  let billingItems=[];
  let sourceRequest=null;
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
  function money(n){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(Number(n)||0);}

  function providerRates(pid){return (data.provider_rates||[]).filter(r=>r.provider_id===pid&&r.active);}
  function billingForJob(jobId){return (data.job_billing_items||[]).filter(x=>x.job_id===jobId).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));}
  function providerCostPreview(r,customerRate){const method=String(r?.provider_compensation_method||'NONE').toUpperCase(),v=r?.provider_compensation==null?null:Number(r.provider_compensation);if(method==='FIXED_CAD'&&Number.isFinite(v))return v;if(method==='PERCENT'&&Number.isFinite(v))return Number(customerRate||0)*v/100;return null;}
  function rateLabel(r){const sn=data.services.find(s=>s.id===r.service_id)?.name||'Service',method=String(r.provider_compensation_method||'NONE').toUpperCase(),v=r.provider_compensation==null?null:Number(r.provider_compensation),unit=String(r.billing_unit||'service').replace('_',' ');let cost='Provider rate not set';if(method==='FIXED_CAD'&&Number.isFinite(v))cost=`Provider ${money(v)} / ${unit}`;else if(method==='PERCENT'&&Number.isFinite(v))cost=`Provider ${v.toFixed(2).replace(/\.00$/,'')}% of customer price`;return `${sn} — ${r.rate_name} — ${cost}`;}
  function defaultQtyForRate(r){if(r?.billing_unit!=='hour')return 1;const start=$('job-start')?.value,end=$('job-end')?.value;if(!start||!end)return 1;const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);return Math.max(.25,((eh*60+em)-(sh*60+sm))/60);}
  function renderBillingPicker(){const pid=$('job-provider')?.value,picker=$('job-billing-rate-picker');if(!picker)return;const rates=providerRates(pid);picker.innerHTML='<option value="">Select provider rate item</option>'+rates.map(r=>`<option value="${r.id}">${esc(rateLabel(r))}</option>`).join('');if(!pid)picker.innerHTML='<option value="">Select provider first</option>';else if(!rates.length)picker.innerHTML='<option value="">Provider has no active Service Rates</option>';renderBillingItems();}
  function updateBillingRow(row,i){
    const x=billingItems[i]; if(!x||!row)return;
    const qty=Math.max(0,Number(x.quantity)||0),customerRate=Math.max(0,Number(x.customer_unit_rate??x.unit_rate)||0);
    const r=providerRates($('job-provider')?.value).find(r=>r.id===x.provider_service_rate_id);
    const providerRate=x.provider_unit_rate??providerCostPreview(r,customerRate);
    const customerTotal=qty*customerRate,providerTotal=providerRate==null?null:qty*providerRate,profit=providerTotal==null?null:customerTotal-providerTotal;
    const values=row.querySelectorAll('.billing-financial-snapshot b');
    if(values[0])values[0].textContent=money(customerTotal);
    if(values[1])values[1].textContent=providerTotal==null?'Needs rate':money(providerTotal);
    if(values[2])values[2].textContent=profit==null?'—':money(profit);
  }
  function renderBillingItems(){
    const box=$('job-billing-items'),empty=$('job-billing-empty'),readonly=!!$('job-existing-id')?.value;if(!box)return;
    empty.hidden=billingItems.length>0;
    box.innerHTML=billingItems.map((x,i)=>{
      const qty=Number(x.quantity)||0,customerRate=Number(x.customer_unit_rate??x.unit_rate)||0;
      return `<div class="calendar-billing-row financial" data-index="${i}"><div class="calendar-billing-name"><strong>${esc(x.service_name||'Service')} · ${esc(x.description)}</strong><small>${esc(String(x.unit||'service').replace('_',' '))}</small></div><label>Qty<input class="billing-qty" data-index="${i}" type="number" inputmode="decimal" min="0.01" step="0.01" value="${qty.toFixed(2)}" ${readonly?'disabled':''}></label><label>PLEASE Customer Rate<input class="billing-rate" data-index="${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${customerRate.toFixed(2)}" ${readonly?'disabled':''}></label><div class="billing-financial-snapshot"><span>Customer <b>${money(0)}</b></span><span>Provider <b>—</b></span><span>PLEASE Profit <b>—</b></span></div>${readonly?'':`<button type="button" class="admin-danger-button billing-remove" data-index="${i}">×</button>`}</div>`;
    }).join('');
    box.querySelectorAll('.calendar-billing-row').forEach((row,i)=>updateBillingRow(row,i));
    box.querySelectorAll('.billing-qty,.billing-rate').forEach(el=>{
      el.addEventListener('input',()=>{
        const i=Number(el.dataset.index),raw=el.value;
        // Do not rebuild the row while the user is typing. Re-rendering caused focus/caret loss
        // and made direct decimal entry nearly impossible.
        if(el.classList.contains('billing-qty')){
          if(raw!=='')billingItems[i].quantity=Math.max(0,Number(raw)||0);
        }else if(raw!==''){
          billingItems[i].customer_unit_rate=Math.max(0,Number(raw)||0);
          billingItems[i].unit_rate=billingItems[i].customer_unit_rate;
        }
        updateBillingRow(el.closest('.calendar-billing-row'),i);renderBillingTotals();
      });
      el.addEventListener('focus',()=>{requestAnimationFrame(()=>el.select());});
      el.addEventListener('blur',()=>{
        const i=Number(el.dataset.index);
        if(el.classList.contains('billing-qty')){
          const v=Math.max(.01,Number(el.value)||.01);billingItems[i].quantity=v;el.value=v.toFixed(2);
        }else{
          const v=Math.max(0,Number(el.value)||0);billingItems[i].customer_unit_rate=v;billingItems[i].unit_rate=v;el.value=v.toFixed(2);
        }
        updateBillingRow(el.closest('.calendar-billing-row'),i);renderBillingTotals();
      });
    });
    box.querySelectorAll('.billing-remove').forEach(b=>b.onclick=()=>{billingItems.splice(Number(b.dataset.index),1);renderBillingItems();});
    renderBillingTotals();
  }
  function renderBillingTotals(){const subtotal=billingItems.reduce((n,x)=>n+(Number(x.quantity)||0)*Number((x.customer_unit_rate??x.unit_rate)??0),0),gst=subtotal*.05;if($('job-billing-subtotal'))$('job-billing-subtotal').textContent=money(subtotal);if($('job-billing-gst'))$('job-billing-gst').textContent=money(gst);if($('job-billing-total'))$('job-billing-total').textContent=money(subtotal+gst);}
  function addBillingItem(){const id=$('job-billing-rate-picker')?.value,r=providerRates($('job-provider')?.value).find(x=>x.id===id);if(!r)return showAlert('Select an active Provider Service Rate first.');const method=String(r.provider_compensation_method||'NONE').toUpperCase();if(method==='NONE'||r.provider_compensation==null)return showAlert('This Provider Service Rate does not have a Provider Charge configured.');const defaultCustomer=Number(r.customer_rate)>0?Number(r.customer_rate):(method==='FIXED_CAD'?Number(r.provider_compensation)||0:0);billingItems.push({provider_service_rate_id:r.id,service_id:r.service_id,service_name:data.services.find(s=>s.id===r.service_id)?.name||'Service',description:r.rate_name,quantity:defaultQtyForRate(r),unit:r.billing_unit,customer_unit_rate:defaultCustomer,unit_rate:defaultCustomer});renderBillingItems();}
  function scheduleChangeFor(assignmentId){return (data.schedule_changes||[]).find(r=>r.assignment_id===assignmentId&&r.status==='PENDING');}
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
          ${assignments.map(a=>{const lp=localParts(a.scheduled_start),le=localParts(a.scheduled_end),j=a.jobs||{},change=scheduleChangeFor(a.id);return `<button type="button" class="calendar-assignment ${a.status.toLowerCase()} ${change?'schedule-change-pending':''}" data-assignment="${a.id}"><span>${time12(lp.time)}–${time12(le.time)}</span><strong>${esc(j.service_name||'Service')}</strong><small>${esc(j.reference||'')}</small>${change?'<small>⚠ Schedule change requested</small>':''}</button>`}).join('')}
          ${!fullBlocked?'<button type="button" class="calendar-add-slot" aria-label="Create job assignment">+</button>':''}
        </div>`;
      });
    });
    grid.innerHTML=html;
    grid.querySelectorAll('.calendar-add-slot').forEach(btn=>btn.addEventListener('click',()=>{const cell=btn.closest('.calendar-cell');openNewJob({provider_id:cell.dataset.provider,date:cell.dataset.date});}));
    grid.querySelectorAll('.calendar-assignment').forEach(btn=>btn.addEventListener('click',()=>openAssignment(btn.dataset.assignment)));
  }

  function renderUnassigned(){
    const rows=data.needs_assignment||[]; const activeJobIds=new Set([...(data.assignments||[]).map(a=>a.job_id),...rows.map(j=>j.id)]); $('needs-assignment-count').textContent=activeJobIds.size; unassignedEmpty.hidden=rows.length>0;unassignedBody.innerHTML='';
    rows.forEach(j=>{const c=j.customers||{};const tr=document.createElement('tr');tr.innerHTML=`<td><strong class="admin-reference">${esc(j.reference)}</strong></td><td><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'Customer')}</strong><small>${esc(c.email||c.phone||'')}</small></td><td>${esc(j.service_name)}</td><td>${esc(j.work_address)}</td><td>${esc(durationLabel(j.estimated_duration_minutes))}</td><td><button type="button" class="admin-row-button">Assign</button></td>`;tr.querySelector('button').addEventListener('click',()=>openExistingJob(j));unassignedBody.appendChild(tr);});
  }

  async function loadCalendar(){
    clearAlert(); const from=ymd(weekStart),to=ymd(addDays(weekStart,6));
    data=await api(`/.netlify/functions/admin-calendar-data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    renderFilters();renderCalendar();renderUnassigned();
  }

  function populateJobProviders(serviceId,preferred=''){
    const select=$('job-provider');const providers=eligibleProviders(serviceId);select.innerHTML='<option value="">Select provider</option>'+providers.map(p=>`<option value="${p.id}">${esc(p.display_name)} — ${esc(p.public_title||p.company_name||'Provider')}</option>`).join('');if(providers.some(p=>p.id===preferred))select.value=preferred;updateAvailabilityNote();renderBillingPicker();
  }
  function setExistingMode(existing){
    ['customer-first-name','customer-last-name','customer-email','customer-phone','job-service','job-address','job-description','job-internal-notes'].forEach(id=>$(id).disabled=existing);
    $('billing-section').classList.toggle('calendar-section-readonly',existing);
    $('job-billing-rate-picker').disabled=existing;$('job-add-billing-item').disabled=existing;
    $('customer-section').classList.toggle('calendar-section-readonly',existing);
  }
  function resetForm(){form.reset();billingItems=[];sourceRequest=null;$('job-existing-id').value='';$('job-source-request-id').value='';$('job-source-request-panel').hidden=true;$('job-drawer-title').textContent='Create & Assign Job';$('job-drawer-eyebrow').textContent='NEW SERVICE REQUEST';setExistingMode(false);$('job-date').value=ymd(new Date());$('job-start').value='09:00';$('job-end').value='11:00';$('job-service').innerHTML='<option value="">Select service</option>'+data.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');populateJobProviders('');renderBillingPicker();}
  function openDrawer(){drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');backdrop.hidden=false;document.body.classList.add('admin-drawer-open');}
  function closeDrawer(){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');backdrop.hidden=true;document.body.classList.remove('admin-drawer-open');}
  function openNewJob(prefill={}){resetForm();if(prefill.date)$('job-date').value=prefill.date;if(prefill.provider_id){const ids=[...providerServiceIds(prefill.provider_id)];if(serviceFilter.value!=='ALL'&&ids.includes(serviceFilter.value))$('job-service').value=serviceFilter.value;else if(ids.length===1)$('job-service').value=ids[0];populateJobProviders($('job-service').value,prefill.provider_id);}openDrawer();updateAvailabilityNote();}
  async function openServiceRequestForAssignment(id){
    const d=await api(`/.netlify/functions/admin-service-requests?id=${encodeURIComponent(id)}`),r=d.request;
    if(!r)throw new Error('Service request not found.');
    if(r.status==='ASSIGNED'&&r.job_id){showAlert(`${r.reference} is already assigned to a Job.`);history.replaceState(null,'','admin-calendar.html');return;}
    if(r.status!=='READY_TO_ASSIGN')throw new Error(`${r.reference} must be Ready to Assign before a Job can be created.`);
    resetForm();sourceRequest=r;$('job-source-request-id').value=r.id;$('job-source-request-panel').hidden=false;$('job-source-request-reference').textContent=r.reference;$('job-source-request-preference').textContent=[r.preferred_date||'Flexible date',r.preferred_start_time?.slice(0,5)||'Flexible time',r.scheduling_flexibility].filter(Boolean).join(' · ');$('job-drawer-eyebrow').textContent='CUSTOMER SERVICE REQUEST';$('job-drawer-title').textContent=`Create Job from ${r.reference}`;
    $('customer-first-name').value=r.first_name||'';$('customer-last-name').value=r.last_name||'';$('customer-email').value=r.email||'';$('customer-phone').value=r.phone||'';
    if([...$('job-service').options].some(o=>o.value===r.service_id))$('job-service').value=r.service_id;populateJobProviders($('job-service').value);
    if(r.preferred_date)$('job-date').value=r.preferred_date;if(r.preferred_start_time){$('job-start').value=r.preferred_start_time.slice(0,5);$('job-end').value='';}
    $('job-address').value=[r.street_address,r.city,r.province,r.postal_code].filter(Boolean).join(', ');$('job-description').value=r.work_description||'';$('job-message').value=r.customer_notes||'';$('job-internal-notes').value=r.internal_notes||'';
    openDrawer();updateAvailabilityNote();
  }
  function openExistingJob(j){resetForm();$('job-existing-id').value=j.id;$('job-drawer-title').textContent=`Assign ${j.reference}`;$('job-drawer-eyebrow').textContent='NEEDS ASSIGNMENT';const c=j.customers||{};$('customer-first-name').value=c.first_name||'';$('customer-last-name').value=c.last_name||'';$('customer-email').value=c.email||'';$('customer-phone').value=c.phone||'';$('job-service').value=j.service_id||'';$('job-address').value=j.work_address||'';$('job-description').value=j.work_description||'';$('job-internal-notes').value='';billingItems=billingForJob(j.id).map(x=>({...x}));setExistingMode(true);populateJobProviders(j.service_id||'');renderBillingPicker();openDrawer();updateAvailabilityNote();}

  function updateAvailabilityNote(){
    const pid=$('job-provider').value,date=$('job-date').value,start=$('job-start').value,end=$('job-end').value,note=$('provider-availability-note');
    if(!pid||!date){note.textContent='Select a provider and date to see availability.';note.classList.remove('calendar-availability-warning');return;}
    const published=providerWindowText(pid,date), assignments=assignmentFor(pid,date);
    const overlaps=assignments.filter(a=>{const s=localParts(a.scheduled_start).time,e=localParts(a.scheduled_end).time;return start&&end&&start<e&&end>s;});
    const av=availabilityFor(pid,date);
    const insideWindow=!!(start&&end&&av.windows.some(w=>w.start<=start&&w.end>=end));
    const blocked=av.blocked.some(e=>{if(!e.start_time&&!e.end_time)return true;const bs=e.start_time?.slice(0,5),be=e.end_time?.slice(0,5);return start&&end&&bs&&be&&start<be&&end>bs;});
    if(overlaps.length||blocked||(!insideWindow&&start&&end)){
      const reserved=overlaps.map(a=>{const s=localParts(a.scheduled_start).time,e=localParts(a.scheduled_end).time;return `${time12(s)}–${time12(e)} ${statusLabel(a.status)}`;}).join(', ');
      note.textContent=`NOT AVAILABLE for ${time12(start)}–${time12(end)}. Published availability: ${published}.${reserved?` Reserved by PLEASE: ${reserved}.`:''}`;
      note.classList.add('calendar-availability-warning');
    }else{
      const reserved=assignments.map(a=>{const s=localParts(a.scheduled_start).time,e=localParts(a.scheduled_end).time;return `${time12(s)}–${time12(e)} ${statusLabel(a.status)}`;}).join(', ');
      note.textContent=`Available for the selected time. Published availability: ${published}.${reserved?` Other reserved time: ${reserved}.`:''}`;
      note.classList.remove('calendar-availability-warning');
    }
  }

  async function submitJob(e){
    e.preventDefault();clearAlert();const existing=$('job-existing-id').value;const serviceId=$('job-service').value,providerId=$('job-provider').value,date=$('job-date').value,start=$('job-start').value,end=$('job-end').value;
    if(!serviceId||!providerId||!date||!start||!end)return showAlert('Service, provider, date, start and end are required.');
    let startIso,endIso;try{startIso=localToIso(date,start);endIso=localToIso(date,end);}catch{return showAlert('The selected schedule could not be interpreted.');}
    const payload={provider_id:providerId,service_id:serviceId,scheduled_start:startIso,scheduled_end:endIso,assignment_message:$('job-message').value.trim()};
    if(!existing){if(!billingItems.length)return showAlert('Add at least one Customer Billing item from this Provider’s active Service Rates.');payload.billing_items=billingItems.map(x=>({provider_service_rate_id:x.provider_service_rate_id,quantity:Number(x.quantity),customer_unit_rate:Number(x.customer_unit_rate??x.unit_rate)}));}
    let action='ASSIGN_EXISTING';
    if(existing){payload.job_id=existing;} else {action='CREATE_AND_ASSIGN';Object.assign(payload,{customer_first_name:$('customer-first-name').value.trim(),customer_last_name:$('customer-last-name').value.trim(),customer_email:$('customer-email').value.trim(),customer_phone:$('customer-phone').value.trim(),work_address:$('job-address').value.trim(),work_description:$('job-description').value.trim(),internal_notes:$('job-internal-notes').value.trim()});if(sourceRequest){payload.service_request_id=sourceRequest.id;payload.customer_city=sourceRequest.city||'';payload.customer_province=sourceRequest.province||'AB';payload.customer_postal_code=sourceRequest.postal_code||'';}}
    submitBtn.disabled=true;submitBtn.textContent='SENDING…';
    try{
      const result=await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action,payload})});
      closeDrawer();
      // Move the calendar to the assigned week so PLEASE immediately sees the reserved block.
      weekStart=startOfWeek(new Date(`${date}T12:00:00`));
      await loadCalendar();
      showAlert(`${result.job_reference||'Job'} assigned and reserved pending provider confirmation. The provider is now NOT AVAILABLE during ${time12(start)}–${time12(end)} on ${date}.`,'success');
      if(result.assignment_id){api('/.netlify/functions/provider-assignment-notify',{method:'POST',body:JSON.stringify({assignment_id:result.assignment_id})}).catch(()=>{});}if(result.service_request_assigned)history.replaceState(null,'','admin-calendar.html');
    }catch(err){showAlert(err.message||'Could not create the assignment.');}
    finally{submitBtn.disabled=false;submitBtn.textContent='SEND ASSIGNMENT →';}
  }

  function openAssignment(id){
    const a=data.assignments.find(x=>x.id===id);if(!a)return;const p=data.providers.find(x=>x.id===a.provider_id),j=a.jobs||{},s=localParts(a.scheduled_start),e=localParts(a.scheduled_end),c=j.customers||{},items=billingForJob(j.id),change=scheduleChangeFor(a.id);
    const billHtml=items.length?`<h3>Customer Billing</h3><div class="calendar-modal-billing">${items.map(x=>`<div><span>${esc(x.service_name||'Service')} · ${esc(x.description)} · ${Number(x.quantity).toFixed(2)} ${esc(x.unit)}</span><strong>${money(x.customer_line_total??x.line_total)}</strong><small>Provider ${x.provider_line_total==null?'—':money(x.provider_line_total)} · Profit ${x.gross_profit==null?'—':money(x.gross_profit)}</small></div>`).join('')}<div class="grand"><span>Subtotal</span><strong>${money(items.reduce((n,x)=>n+Number((x.customer_line_total??x.line_total)??0),0))}</strong></div></div>`:'';
    const changeHtml=change?`<div class="admin-detail-section schedule-change-review"><h3>Provider Schedule Change Request</h3><p><b>Current:</b> ${esc(fmtAdmin(change.current_start))} → ${esc(fmtAdmin(change.current_end))}</p><p><b>Proposed:</b> ${esc(fmtAdmin(change.proposed_start))} → ${esc(fmtAdmin(change.proposed_end))}</p>${change.provider_reason?`<p><b>Provider reason:</b> ${esc(change.provider_reason)}</p>`:''}<div class="calendar-modal-actions"><button id="accept-schedule-change" class="btn primary" type="button">ACCEPT CHANGE</button><button id="reject-schedule-change" class="admin-danger-button" type="button">REJECT CHANGE</button></div></div>`:'';
    $('assignment-modal-content').innerHTML=`<span class="status-badge status-${a.status.toLowerCase()}">${esc(statusLabel(a.status))}</span><h2>${esc(j.reference||'Assignment')}</h2><div class="admin-detail-grid"><div><span>Provider</span><strong>${esc(p?.display_name||'')}</strong></div><div><span>Service</span><strong>${esc(j.service_name||'')}</strong></div><div><span>Date</span><strong>${esc(s.date)}</strong></div><div><span>Time</span><strong>${time12(s.time)}–${time12(e.time)}</strong></div><div><span>Customer</span><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'—')}</strong></div><div><span>Customer Contact</span><strong>${esc(c.email||c.phone||'—')}</strong></div></div>${billHtml}<h3>Work Address</h3><p>${esc(j.work_address||'')}</p><h3>Work Description</h3><p class="admin-prewrap">${esc(j.work_description||'')}</p>${a.assignment_message?`<h3>Message to Provider</h3><p>${esc(a.assignment_message)}</p>`:''}${a.provider_response_note?`<h3>Provider Response</h3><p>${esc(a.provider_response_note)}</p>`:''}${changeHtml}<div class="calendar-modal-actions">${['PENDING','CONFIRMED'].includes(a.status)?'<button id="cancel-assignment" class="admin-danger-button" type="button">CANCEL ASSIGNMENT</button>':''}</div>`;
    $('assignment-modal').hidden=false;
    const accept=$('accept-schedule-change');if(accept)accept.onclick=()=>reviewScheduleChange(change.id,'ACCEPT');const reject=$('reject-schedule-change');if(reject)reject.onclick=()=>{const note=prompt('Reason for rejecting the provider schedule change (optional):','')||'';reviewScheduleChange(change.id,'REJECT',note);};
    const cancel=$('cancel-assignment');if(cancel)cancel.addEventListener('click',async()=>{if(!confirm('Cancel this assignment and return the job to Needs Assignment?'))return;cancel.disabled=true;try{await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action:'CANCEL_ASSIGNMENT',payload:{assignment_id:a.id,note:'Cancelled by PLEASE administration'}})});$('assignment-modal').hidden=true;await loadCalendar();showAlert('Assignment cancelled. The job now needs reassignment.','success');}catch(err){showAlert(err.message);}finally{cancel.disabled=false;}});
  }
  function fmtAdmin(v){return v?new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:TZ}).format(new Date(v)):'—';}
  async function reviewScheduleChange(id,action,note=''){try{await api('/.netlify/functions/admin-schedule-change-action',{method:'POST',body:JSON.stringify({request_id:id,action,note})});$('assignment-modal').hidden=true;await loadCalendar();showAlert(`Schedule change ${action==='ACCEPT'?'accepted and calendar updated':'rejected'}.`,'success');}catch(e){showAlert(e.message);}}

  $('new-job').addEventListener('click',()=>openNewJob());
  $('prev-week').addEventListener('click',()=>{weekStart=addDays(weekStart,-7);loadCalendar().catch(e=>showAlert(e.message));});
  $('next-week').addEventListener('click',()=>{weekStart=addDays(weekStart,7);loadCalendar().catch(e=>showAlert(e.message));});
  $('today-week').addEventListener('click',()=>{weekStart=startOfWeek(new Date());loadCalendar().catch(e=>showAlert(e.message));});
  $('refresh-calendar').addEventListener('click',()=>loadCalendar().catch(e=>showAlert(e.message)));
  serviceFilter.addEventListener('change',renderCalendar);providerFilter.addEventListener('change',renderCalendar);
  $('job-service').addEventListener('change',()=>populateJobProviders($('job-service').value));$('job-provider').addEventListener('change',()=>{updateAvailabilityNote();if(!$('job-existing-id').value)billingItems=[];renderBillingPicker();});$('job-date').addEventListener('change',updateAvailabilityNote);$('job-start').addEventListener('change',updateAvailabilityNote);$('job-end').addEventListener('change',updateAvailabilityNote);$('job-add-billing-item').addEventListener('click',addBillingItem);
  $('job-drawer-close').addEventListener('click',closeDrawer);backdrop.addEventListener('click',closeDrawer);form.addEventListener('submit',submitJob);
  $('assignment-modal-close').addEventListener('click',()=>{$('assignment-modal').hidden=true;});$('assignment-modal').addEventListener('click',e=>{if(e.target===$('assignment-modal'))$('assignment-modal').hidden=true;});
  $('admin-signout').addEventListener('click',async()=>{try{await api('/.netlify/functions/admin-logout',{method:'POST',body:'{}'});}catch{}location.replace('admin-login.html');});

  async function init(){try{await ensureSession();loading.hidden=true;loading.remove();app.hidden=false;await loadCalendar();const requestId=new URLSearchParams(location.search).get('request');if(requestId)await openServiceRequestForAssignment(requestId);}catch(e){if(loading)loading.textContent=e.message||'Unable to load secure calendar.';else showAlert(e.message||'Unable to load secure calendar.');}}
  init();
})();
