(() => {
  const TZ='America/Edmonton';
  const loading=document.getElementById('admin-loading'), app=document.getElementById('admin-app');
  const grid=document.getElementById('calendar-grid'), alertBox=document.getElementById('calendar-alert');
  const serviceFilter=document.getElementById('calendar-service'), providerFilter=document.getElementById('calendar-provider');
  const drawer=document.getElementById('job-drawer'), backdrop=document.getElementById('calendar-backdrop');
  const form=document.getElementById('job-form'), submitBtn=document.getElementById('job-submit');
  const unassignedBody=document.getElementById('unassigned-body'), unassignedEmpty=document.getElementById('unassigned-empty');
  let data={providers:[],provider_services:[],services:[],availability:[],exceptions:[],assignments:[],needs_assignment:[],reassignment_assignments:[],provider_rates:[],job_billing_items:[],schedule_changes:[]};
  let billingItems=[];
  let teamAssignments=[];
  let sourceRequest=null;
  let reassignmentTargetAssignment=null;
  let assignmentCatalogLoaded=false;
  let weekStart=startOfWeek(new Date());
  let weekDates=[];

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function api(url, options={}) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const r=await fetch(url,{credentials:'same-origin',headers:{'content-type':'application/json',...(options.headers||{})},...options,signal:controller.signal});
      const text=await r.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={error:text};}
      if(r.status===401){location.replace('admin-login.html');throw new Error('Session expired');}
      if(!r.ok) throw new Error(payload.error||`Request failed (${r.status})`);
      return payload;
    } catch (error) {
      if(error?.name==='AbortError') throw new Error('The secure Administration request timed out. Refresh the page and try again.');
      throw error;
    } finally { clearTimeout(timeout); }
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
  function requestBookingMeta(notes){const text=String(notes||'');const dropoff=text.match(/^Drop-off address:\s*(.+)$/mi)?.[1]?.trim()||'';const hours=Number(text.match(/^Estimated hours requested:\s*([0-9.]+)/mi)?.[1]||0);return{dropoff,hours:Number.isFinite(hours)&&hours>0?hours:0};}

  function money(n){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(Number(n)||0);}

  function providerRates(pid){return (data.provider_rates||[]).filter(r=>r.provider_id===pid&&r.active);}
  function billingForJob(jobId){return (data.job_billing_items||[]).filter(x=>x.job_id===jobId).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));}
  function providerCostPreview(r,customerRate,item=null){
    const method=String(item?.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase();
    const raw=item?.provider_compensation_value??r?.provider_compensation;
    const v=raw==null?null:Number(raw);
    if(method==='FIXED_CAD'&&Number.isFinite(v))return v;
    if(method==='PERCENT'&&Number.isFinite(v))return Number(customerRate||0)*v/100;
    return null;
  }
  function providerRateEditValue(r,item){const raw=item?.provider_compensation_value??r?.provider_compensation;return raw==null?'':Number(raw);}
  function providerRateEditLabel(r,item){const method=String(item?.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase();return method==='PERCENT'?'Provider %':'Provider Rate';}
  function rateLabel(r){const sn=data.services.find(s=>s.id===r.service_id)?.name||'Service',method=String(r.provider_compensation_method||'NONE').toUpperCase(),v=r.provider_compensation==null?null:Number(r.provider_compensation),unit=String(r.billing_unit||'service').replace('_',' ');let cost='Provider rate not set';if(method==='FIXED_CAD'&&Number.isFinite(v))cost=`Provider ${money(v)} / ${unit}`;else if(method==='PERCENT'&&Number.isFinite(v))cost=`Provider ${v.toFixed(2).replace(/\.00$/,'')}% of customer price`;return `${sn} — ${r.rate_name} — ${cost}`;}
  function defaultQtyForRate(r){if(r?.billing_unit!=='hour')return 1;const start=$('job-start')?.value,end=$('job-end')?.value;if(!start||!end)return 1;const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);return Math.max(.25,((eh*60+em)-(sh*60+sm))/60);}
  function renderBillingPicker(){const pid=$('job-provider')?.value,picker=$('job-billing-rate-picker');if(!picker)return;const rates=providerRates(pid);picker.innerHTML='<option value="">Select provider rate item</option>'+rates.map(r=>`<option value="${r.id}">${esc(rateLabel(r))}</option>`).join('');if(!pid)picker.innerHTML='<option value="">Select provider first</option>';else if(!rates.length)picker.innerHTML='<option value="">Provider has no active Service Rates</option>';renderBillingItems();}
  function updateBillingRow(row,i){
    const x=billingItems[i]; if(!x||!row)return;
    const qty=Math.max(0,Number(x.quantity)||0),customerRate=Math.max(0,Number(x.customer_unit_rate??x.unit_rate)||0);
    const r=providerRates($('job-provider')?.value).find(r=>r.id===x.provider_service_rate_id);
    const providerRate=providerCostPreview(r,customerRate,x);
    const customerTotal=qty*customerRate,providerTotal=providerRate==null?null:qty*providerRate,profit=providerTotal==null?null:customerTotal-providerTotal;
    const values=row.querySelectorAll('.billing-financial-snapshot b');
    if(values[0])values[0].textContent=money(customerTotal);
    if(values[1])values[1].textContent=providerTotal==null?'Needs rate':money(providerTotal);
    if(values[2])values[2].textContent=profit==null?'—':money(profit);
  }
  function renderBillingItems(){
    const box=$('job-billing-items'),empty=$('job-billing-empty');if(!box)return;
    empty.hidden=billingItems.length>0;
    const selectedProvider=$('job-provider')?.value||'';
    box.innerHTML=billingItems.map((x,i)=>{
      const qty=Number(x.quantity)||0,customerRate=Number(x.customer_unit_rate??x.unit_rate)||0;
      const r=providerRates(selectedProvider).find(z=>z.id===x.provider_service_rate_id);
      const method=String(x.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase();
      const pv=providerRateEditValue(r,x);
      return `<div class="calendar-billing-row financial provider-rate-edit-row" data-index="${i}"><div class="calendar-billing-name"><strong>${esc(x.service_name||'Service')} · ${esc(x.description||r?.rate_name||'Rate')}</strong><small>${esc(String(x.unit||r?.billing_unit||'service').replace('_',' '))}</small></div><label>Qty<input class="billing-qty" data-index="${i}" type="number" inputmode="decimal" min="${String(x.unit||r?.billing_unit||'').toLowerCase()==='hour'?'0.25':'0.01'}" step="${String(x.unit||r?.billing_unit||'').toLowerCase()==='hour'?'0.25':'0.01'}" value="${qty.toFixed(2)}"></label><label>PLEASE Customer Rate<input class="billing-rate" data-index="${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${customerRate.toFixed(2)}"></label><label class="provider-rate-edit">${esc(providerRateEditLabel(r,x))}<input class="billing-provider-rate" data-index="${i}" type="number" inputmode="decimal" min="0" ${method==='PERCENT'?'max="100"':''} step="0.01" value="${pv===''?'':Number(pv).toFixed(2)}"><small>${method==='PERCENT'?'Percent of customer rate':'CAD per '+esc(String(x.unit||r?.billing_unit||'service').replace('_',' '))} · saved to this Provider</small></label><div class="billing-financial-snapshot"><span>Customer <b>${money(0)}</b></span><span>Provider <b>—</b></span><span>PLEASE Profit <b>—</b></span></div><button type="button" class="admin-danger-button billing-remove" data-index="${i}">×</button></div>`;
    }).join('');
    box.querySelectorAll('.calendar-billing-row').forEach((row,i)=>updateBillingRow(row,i));
    box.querySelectorAll('.billing-qty,.billing-rate,.billing-provider-rate').forEach(el=>{
      el.addEventListener('input',()=>{
        const i=Number(el.dataset.index),raw=el.value,x=billingItems[i];if(!x)return;
        if(el.classList.contains('billing-qty')){if(raw!=='')x.quantity=Math.max(0,Number(raw)||0);}
        else if(el.classList.contains('billing-rate')){if(raw!==''){x.customer_unit_rate=Math.max(0,Number(raw)||0);x.unit_rate=x.customer_unit_rate;}}
        else if(raw!==''){x.provider_compensation_value=Math.max(0,Number(raw)||0);}
        updateBillingRow(el.closest('.calendar-billing-row'),i);renderBillingTotals();
      });
      el.addEventListener('focus',()=>{requestAnimationFrame(()=>el.select());});
      el.addEventListener('blur',()=>{
        const i=Number(el.dataset.index),x=billingItems[i];if(!x)return;
        if(el.classList.contains('billing-qty')){const min=String(x.unit||'').toLowerCase()==='hour'?.25:.01,v=Math.max(min,Number(el.value)||min);x.quantity=v;el.value=v.toFixed(2);}
        else if(el.classList.contains('billing-rate')){const v=Math.max(0,Number(el.value)||0);x.customer_unit_rate=v;x.unit_rate=v;el.value=v.toFixed(2);}
        else {const r=providerRates($('job-provider')?.value).find(z=>z.id===x.provider_service_rate_id),method=String(x.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase();let v=Math.max(0,Number(el.value)||0);if(method==='PERCENT')v=Math.min(100,v);x.provider_compensation_method=method;x.provider_compensation_value=v;el.value=v.toFixed(2);}
        updateBillingRow(el.closest('.calendar-billing-row'),i);renderBillingTotals();
      });
    });
    box.querySelectorAll('.billing-remove').forEach(b=>b.onclick=()=>{billingItems.splice(Number(b.dataset.index),1);renderBillingItems();});
    renderBillingTotals();
  }
  function renderBillingTotals(){
    let subtotal=0,provider=0;
    const pid=$('job-provider')?.value||'';
    for(const x of billingItems){const q=Number(x.quantity)||0,cr=Number((x.customer_unit_rate??x.unit_rate)??0),r=providerRates(pid).find(z=>z.id===x.provider_service_rate_id),pr=providerCostPreview(r,cr,x);subtotal+=q*cr;if(pr!=null)provider+=q*pr;}
    const gst=subtotal*.05;
    if($('job-billing-subtotal'))$('job-billing-subtotal').textContent=money(subtotal);
    if($('job-billing-provider-cost'))$('job-billing-provider-cost').textContent=money(provider);
    if($('job-billing-profit'))$('job-billing-profit').textContent=money(subtotal-provider);
    if($('job-billing-gst'))$('job-billing-gst').textContent=money(gst);
    if($('job-billing-total'))$('job-billing-total').textContent=money(subtotal+gst);
  }
  function addBillingItem(){const id=$('job-billing-rate-picker')?.value,r=providerRates($('job-provider')?.value).find(x=>x.id===id);if(!r)return showAlert('Select an active Provider Service Rate first.');const method=String(r.provider_compensation_method||'NONE').toUpperCase();if(method==='NONE'||r.provider_compensation==null)return showAlert('This Provider Service Rate does not have a Provider Charge configured.');const defaultCustomer=Number(r.customer_rate)>0?Number(r.customer_rate):0;billingItems.push({provider_service_rate_id:r.id,service_id:r.service_id,service_name:data.services.find(s=>s.id===r.service_id)?.name||'Service',description:r.rate_name,quantity:defaultQtyForRate(r),unit:r.billing_unit,customer_unit_rate:defaultCustomer,unit_rate:defaultCustomer,provider_compensation_method:method,provider_compensation_value:Number(r.provider_compensation)});renderBillingItems();}
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

  function scheduleChangeContext(change){
    const a=(data.assignments||[]).find(x=>x.id===change.assignment_id);
    const p=(data.providers||[]).find(x=>x.id===change.provider_id)||null;
    const j=a?.jobs||null;
    return {a,p,j};
  }
  function renderPendingScheduleChanges(){
    const changes=(data.schedule_changes||[]).filter(x=>x.status==='PENDING');
    const count=$('schedule-change-count'),empty=$('schedule-change-empty'),wrap=$('schedule-change-table-wrap'),body=$('schedule-change-body');
    if(count)count.textContent=String(changes.length); if(!empty||!wrap||!body)return;
    empty.hidden=changes.length>0;wrap.hidden=changes.length===0;
    body.innerHTML=changes.map(ch=>{
      const {a,p,j}=scheduleChangeContext(ch),customer=j?.customers||{};
      const customerName=[customer.first_name,customer.last_name].filter(Boolean).join(' ')||'Customer';
      return `<tr data-change="${esc(ch.id)}"><td><strong class="admin-reference">${esc(j?.reference||'Job')}</strong><small>${esc(p?.display_name||'Provider')} · ${esc(j?.service_name||'Service')} · ${esc(customerName)}</small></td><td>${esc(fmtAdmin(ch.current_start))}<small>to ${esc(fmtAdmin(ch.current_end))}</small></td><td><strong>${esc(fmtAdmin(ch.proposed_start))}</strong><small>to ${esc(fmtAdmin(ch.proposed_end))}</small></td><td>${esc(ch.provider_reason||'No reason provided')}</td><td><div class="schedule-change-queue-actions"><button type="button" class="admin-primary-button sc-approve">APPROVE</button><button type="button" class="admin-outline-button sc-team">APPROVE TEAM</button><button type="button" class="admin-danger-button sc-reject">REJECT</button></div></td></tr>`;
    }).join('');
    body.querySelectorAll('tr[data-change]').forEach(row=>{
      const id=row.dataset.change;
      row.querySelector('.sc-approve').onclick=()=>reviewScheduleChange(id,'ACCEPT','',false);
      row.querySelector('.sc-team').onclick=()=>{if(confirm('Apply this same requested date and time to every active Provider assignment on this Job?'))reviewScheduleChange(id,'ACCEPT','Applied to remaining service team by PLEASE Administration.',true);};
      row.querySelector('.sc-reject').onclick=()=>{const note=prompt('Reason for rejecting this Provider schedule change (optional):','');if(note!==null)reviewScheduleChange(id,'REJECT',note,false);};
    });
  }

  function renderUnassigned(){
    const rows=data.needs_assignment||[]; const activeJobIds=new Set([...(data.assignments||[]).map(a=>a.job_id),...rows.map(j=>j.id)]); $('needs-assignment-count').textContent=activeJobIds.size; unassignedEmpty.hidden=rows.length>0;unassignedBody.innerHTML='';
    rows.forEach(j=>{const c=j.customers||{};const tr=document.createElement('tr');tr.innerHTML=`<td><strong class="admin-reference">${esc(j.reference)}</strong></td><td><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'Customer')}</strong><small>${esc(c.email||c.phone||'')}</small></td><td>${esc(j.service_name)}</td><td>${esc(j.work_address)}</td><td>${esc(durationLabel(j.estimated_duration_minutes))}</td><td><button type="button" class="admin-row-button">Assign</button></td>`;tr.querySelector('button').addEventListener('click',()=>openExistingJob(j));unassignedBody.appendChild(tr);});
  }

  function teamDefault(date=null,start=null,end=null){
    const d=date||$('job-date')?.value||ymd(new Date()), st=start||'09:00', en=end||'11:00';
    return {provider_id:'',date:d,start:st,end:en,assignment_message:'',billing_items:[]};
  }
  function teamRateProviderCost(r,customerRate,item=null){const method=String(item?.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase();const raw=item?.provider_compensation_value??r?.provider_compensation;const v=raw==null?null:Number(raw);if(method==='FIXED_CAD'&&Number.isFinite(v))return v;if(method==='PERCENT'&&Number.isFinite(v))return Number(customerRate||0)*v/100;return null;}
  function teamProviderRateValue(r,item){const raw=item?.provider_compensation_value??r?.provider_compensation;return raw==null?'':Number(raw);}
  function teamProviderRateLabel(r,item){const method=String(item?.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase();return method==='PERCENT'?'Provider %':'Provider Rate';}
  function teamTotals(){
    let customer=0,provider=0;
    for(const a of teamAssignments)for(const x of a.billing_items||[]){const q=Number(x.quantity)||0,cr=Number(x.customer_unit_rate)||0,r=providerRates(a.provider_id).find(z=>z.id===x.provider_service_rate_id),pr=teamRateProviderCost(r,cr,x);customer+=q*cr;if(pr!=null)provider+=q*pr;}
    const gst=customer*.05;$('team-customer-subtotal').textContent=money(customer);$('team-provider-cost').textContent=money(provider);$('team-profit').textContent=money(customer-provider);$('team-gst').textContent=money(gst);$('team-customer-total').textContent=money(customer+gst);
  }
  function teamAvailability(a){
    if(!a.provider_id||!a.date)return 'Select a provider and date to see availability.';
    const av=availabilityFor(a.provider_id,a.date),assigns=assignmentFor(a.provider_id,a.date),over=assigns.some(x=>{const s=localParts(x.scheduled_start).time,e=localParts(x.scheduled_end).time;return a.start<e&&a.end>s;}),inside=av.windows.some(w=>w.start<=a.start&&w.end>=a.end),blocked=av.blocked.some(e=>{if(!e.start_time&&!e.end_time)return true;const s=e.start_time?.slice(0,5),en=e.end_time?.slice(0,5);return s&&en&&a.start<en&&a.end>s;});
    return (over||blocked||!inside)?`NOT AVAILABLE for ${time12(a.start)}–${time12(a.end)}. Published: ${providerWindowText(a.provider_id,a.date)}.`:`Available for ${time12(a.start)}–${time12(a.end)}. Published: ${providerWindowText(a.provider_id,a.date)}.`;
  }
  function renderTeam(){
    const box=$('job-team-assignments');if(!box)return;const eligible=eligibleProviders($('job-service').value||'');
    box.innerHTML=teamAssignments.map((a,i)=>{
      const rates=providerRates(a.provider_id),primary=i===0;
      const bill=(a.billing_items||[]).map((x,j)=>{const r=rates.find(z=>z.id===x.provider_service_rate_id),q=Number(x.quantity)||0,cr=Number(x.customer_unit_rate)||0,pr=teamRateProviderCost(r,cr,x),method=String(x.provider_compensation_method||r?.provider_compensation_method||'NONE').toUpperCase(),pv=teamProviderRateValue(r,x);return `<div class="calendar-billing-row financial team-billing-row provider-rate-edit-row" data-ai="${i}" data-bi="${j}"><div class="calendar-billing-name"><strong>${esc(x.service_name||'Service')} · ${esc(x.description||'Rate')}</strong><small>${esc(String(x.unit||'service').replace('_',' '))}</small></div><label>Qty<input class="team-bill-qty" type="number" inputmode="decimal" min="${String(x.unit||'').toLowerCase()==='hour'?'0.25':'0.01'}" step="${String(x.unit||'').toLowerCase()==='hour'?'0.25':'0.01'}" value="${q.toFixed(2)}"></label><label>PLEASE Customer Rate<input class="team-bill-rate" type="number" min="0" step="0.01" value="${cr.toFixed(2)}"></label><label class="provider-rate-edit">${esc(teamProviderRateLabel(r,x))}<input class="team-provider-rate" type="number" inputmode="decimal" min="0" ${method==='PERCENT'?'max="100"':''} step="0.01" value="${pv===''?'':Number(pv).toFixed(2)}"><small>${method==='PERCENT'?'Percent of customer rate':'CAD per '+esc(String(x.unit||'service').replace('_',' '))} · saved to this Provider</small></label><div class="billing-financial-snapshot"><span>Customer <b>${money(q*cr)}</b></span><span>Provider <b>${pr==null?'Needs rate':money(q*pr)}</b></span><span>PLEASE Profit <b>${pr==null?'—':money(q*(cr-pr))}</b></span></div><button type="button" class="admin-danger-button team-bill-remove">×</button></div>`}).join('');
      return `<article class="multi-provider-card" data-index="${i}"><div class="multi-provider-card-head"><div><span class="admin-reference">${primary?'PRIMARY PROVIDER':`PROVIDER ${i+1}`}</span><h4>${primary?'Shown first in Customer Tracking':'Additional service team member'}</h4></div>${teamAssignments.length>1?'<button type="button" class="admin-danger-button team-remove-provider">REMOVE</button>':''}</div><div class="calendar-form-grid two"><label>Provider *<select class="team-provider"><option value="">Select provider</option>${eligible.map(p=>`<option value="${p.id}" ${p.id===a.provider_id?'selected':''}>${esc(p.display_name)} — ${esc(p.public_title||p.company_name||'Provider')}</option>`).join('')}</select></label><label>Date *<input class="team-date" type="date" value="${esc(a.date)}"></label></div><div class="calendar-form-grid two"><label>Start *<input class="team-start" type="time" step="900" value="${esc(a.start)}"></label><label>End *<input class="team-end" type="time" step="900" value="${esc(a.end)}"></label></div><div class="calendar-availability-note ${teamAvailability(a).startsWith('NOT')?'calendar-availability-warning':''}">${esc(teamAvailability(a))}</div><label>Message to this Provider<textarea class="team-message" rows="2">${esc(a.assignment_message||'')}</textarea></label><div class="calendar-billing-picker"><label>Provider Service Rate<select class="team-rate-picker"><option value="">${a.provider_id?'Select provider rate item':'Select provider first'}</option>${rates.map(r=>`<option value="${r.id}">${esc(rateLabel(r))}</option>`).join('')}</select></label><button type="button" class="admin-outline-button team-add-rate">ADD BILLING ITEM</button></div>${bill||'<p class="admin-muted">No billing items added for this Provider.</p>'}</article>`;
    }).join('');
    box.querySelectorAll('.multi-provider-card').forEach(card=>{const i=Number(card.dataset.index),a=teamAssignments[i];
      card.querySelector('.team-provider').onchange=e=>{a.provider_id=e.target.value;a.billing_items=[];renderTeam();};
      card.querySelector('.team-date').onchange=e=>{a.date=e.target.value;renderTeam();};card.querySelector('.team-start').onchange=e=>{a.start=e.target.value;renderTeam();};card.querySelector('.team-end').onchange=e=>{a.end=e.target.value;renderTeam();};card.querySelector('.team-message').oninput=e=>a.assignment_message=e.target.value;
      card.querySelector('.team-remove-provider')?.addEventListener('click',()=>{teamAssignments.splice(i,1);renderTeam();});
      card.querySelector('.team-add-rate').onclick=()=>{const id=card.querySelector('.team-rate-picker').value,r=providerRates(a.provider_id).find(z=>z.id===id);if(!r)return showAlert('Select an active Provider Service Rate first.');const method=String(r.provider_compensation_method||'NONE').toUpperCase();if(method==='NONE'||r.provider_compensation==null)return showAlert('This Provider Service Rate does not have a Provider Charge configured.');const def=Number(r.customer_rate)>0?Number(r.customer_rate):0;let qty=1;if(r.billing_unit==='hour'){const [sh,sm]=a.start.split(':').map(Number),[eh,em]=a.end.split(':').map(Number);qty=Math.max(.25,((eh*60+em)-(sh*60+sm))/60);}a.billing_items.push({provider_service_rate_id:r.id,service_id:r.service_id,service_name:data.services.find(s=>s.id===r.service_id)?.name||'Service',description:r.rate_name,quantity:qty,unit:r.billing_unit,customer_unit_rate:def,provider_compensation_method:String(r.provider_compensation_method||'NONE').toUpperCase(),provider_compensation_value:r.provider_compensation==null?'':Number(r.provider_compensation)});renderTeam();};
      card.querySelectorAll('.team-billing-row').forEach(row=>{const j=Number(row.dataset.bi),x=a.billing_items[j];row.querySelector('.team-bill-qty').onchange=e=>{const isHour=String(x.unit||'').toLowerCase()==='hour';let v=Number(e.target.value);if(!Number.isFinite(v))v=isHour?.25:.01;if(isHour)v=Math.max(.25,Math.round(v*4)/4);else v=Math.max(.01,v);x.quantity=v;renderTeam();};row.querySelector('.team-bill-rate').onchange=e=>{x.customer_unit_rate=Math.max(0,Number(e.target.value)||0);renderTeam();};const pri=row.querySelector('.team-provider-rate');if(pri)pri.onchange=e=>{const rate=providerRates(a.provider_id).find(z=>z.id===x.provider_service_rate_id),method=String(x.provider_compensation_method||rate?.provider_compensation_method||'NONE').toUpperCase();let v=Number(e.target.value);if(!Number.isFinite(v)||v<0)v=0;if(method==='PERCENT')v=Math.min(100,v);x.provider_compensation_method=method;x.provider_compensation_value=Math.round(v*100)/100;renderTeam();};row.querySelector('.team-bill-remove').onclick=()=>{a.billing_items.splice(j,1);renderTeam();};});
    });teamTotals();
  }
  function setMultiMode(on){$('multi-provider-section').hidden=!on;$('legacy-assignment-section').hidden=on;['job-provider','job-date','job-start','job-end'].forEach(id=>{const el=$(id);if(el)el.required=!on;});}
  async function loadCalendar(){
    clearAlert(); const from=ymd(weekStart),to=ymd(addDays(weekStart,6));
    const fresh=await api(`/.netlify/functions/admin-calendar-data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    data={...data,...fresh};
    if((fresh.providers||[]).length&&(fresh.services||[]).length)assignmentCatalogLoaded=true;
    renderFilters();renderPendingScheduleChanges();renderCalendar();renderUnassigned();if(data.warnings?.length)showAlert(`Master Calendar loaded with limited auxiliary data (${data.warnings.join(', ')}). Assignment can still retry its catalog independently.`);
  }
  async function ensureAssignmentCatalog(force=false){
    if(assignmentCatalogLoaded&&!force&&data.providers?.length&&data.services?.length)return;
    const d=await api('/.netlify/functions/admin-assignment-form-data');
    data.providers=d.providers||[];data.provider_services=d.provider_services||[];data.services=d.services||[];data.provider_rates=d.provider_rates||[];assignmentCatalogLoaded=true;
    if(d.warnings?.length)showAlert(`Assignment catalog loaded with warnings (${d.warnings.join(', ')}).`);
  }

  function populateJobProviders(serviceId,preferred=''){
    const select=$('job-provider');const providers=eligibleProviders(serviceId);select.innerHTML='<option value="">Select provider</option>'+providers.map(p=>`<option value="${p.id}">${esc(p.display_name)} — ${esc(p.public_title||p.company_name||'Provider')}</option>`).join('');if(providers.some(p=>p.id===preferred))select.value=preferred;updateAvailabilityNote();renderBillingPicker();
  }
  function setExistingMode(existing){
    ['customer-first-name','customer-last-name','customer-email','customer-phone','job-service','job-address','job-description','job-internal-notes'].forEach(id=>$(id).disabled=existing);
    // STEP 15.8.6.3: NEEDS_ASSIGNMENT is a controlled correction point. Customer/work
    // identity stays read-only, while Provider, schedule and billing are intentionally editable.
    $('billing-section').classList.remove('calendar-section-readonly');
    $('job-billing-rate-picker').disabled=false;$('job-add-billing-item').disabled=false;
    $('customer-section').classList.toggle('calendar-section-readonly',existing);
  }
  function resetForm(){form.reset();billingItems=[];teamAssignments=[teamDefault()];sourceRequest=null;reassignmentTargetAssignment=null;$('job-existing-id').value='';$('job-source-request-id').value='';$('job-source-request-panel').hidden=true;$('job-drawer-title').textContent='Create & Assign Job';$('job-drawer-eyebrow').textContent='NEW SERVICE REQUEST';setExistingMode(false);setMultiMode(true);$('job-date').value=ymd(new Date());$('job-start').value='09:00';$('job-end').value='11:00';$('job-service').innerHTML='<option value="">Select service</option>'+data.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');populateJobProviders('');renderBillingPicker();renderTeam();}
  function openDrawer(){drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');backdrop.hidden=false;document.body.classList.add('admin-drawer-open');}
  function closeDrawer(){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');backdrop.hidden=true;document.body.classList.remove('admin-drawer-open');}
  function openNewJob(prefill={}){resetForm();if(prefill.date){$('job-date').value=prefill.date;teamAssignments[0].date=prefill.date;}if(prefill.provider_id){teamAssignments[0].provider_id=prefill.provider_id;const ids=[...providerServiceIds(prefill.provider_id)];if(serviceFilter.value!=='ALL'&&ids.includes(serviceFilter.value))$('job-service').value=serviceFilter.value;else if(ids.length===1)$('job-service').value=ids[0];populateJobProviders($('job-service').value,prefill.provider_id);renderTeam();}openDrawer();updateAvailabilityNote();}
  async function openServiceRequestForAssignment(id,cachedRequest=null){
    let r=cachedRequest;
    if(!r||r.id!==id){
      const d=await api(`/.netlify/functions/admin-service-requests?id=${encodeURIComponent(id)}`);
      r=d.request;
    }
    if(!r)throw new Error('Service request not found.');
    if(r.status==='ASSIGNED'&&r.job_id){showAlert(`${r.reference} is already assigned to a Job.`);history.replaceState(null,'','admin-calendar.html');try{sessionStorage.removeItem('pleasePendingServiceRequest');}catch{}return;}
    if(r.status!=='READY_TO_ASSIGN')throw new Error(`${r.reference} must be Ready to Assign before a Job can be created.`);
    // The assignment drawer has its own lightweight catalog endpoint. A calendar-side
    // timeout must never prevent Administration from assigning a valid Service Request.
    await ensureAssignmentCatalog(true);

    resetForm();
    sourceRequest=r;
    $('job-source-request-id').value=r.id||'';
    $('job-source-request-panel').hidden=false;
    $('job-source-request-reference').textContent=r.reference||'Service Request';
    $('job-source-request-preference').textContent=[r.preferred_date||'Flexible date',r.preferred_start_time?.slice(0,5)||'Flexible time',r.scheduling_flexibility].filter(Boolean).join(' · ');
    $('job-drawer-eyebrow').textContent='CUSTOMER SERVICE REQUEST';
    $('job-drawer-title').textContent=`Create Job from ${r.reference||'Service Request'}`;

    $('customer-first-name').value=r.first_name||'';
    $('customer-last-name').value=r.last_name||'';
    $('customer-email').value=r.email||'';
    $('customer-phone').value=r.phone||'';

    // Prefer the exact service UUID, but fall back to the service name so older
    // request rows remain convertible if service identifiers changed during setup.
    let selectedService='';
    if(r.service_id&&[...$('job-service').options].some(o=>o.value===r.service_id)) selectedService=r.service_id;
    if(!selectedService&&r.service_name){
      const byName=data.services.find(x=>String(x.name||'').trim().toLowerCase()===String(r.service_name).trim().toLowerCase());
      if(byName)selectedService=byName.id;
    }
    $('job-service').value=selectedService;
    populateJobProviders(selectedService);

    if(r.preferred_date)$('job-date').value=r.preferred_date;
    if(r.preferred_start_time){
      const start=r.preferred_start_time.slice(0,5);
      $('job-start').value=start;
      // Use the customer's estimated hours when available; otherwise keep the 2-hour default.
      const [hh,mm]=start.split(':').map(Number),meta=requestBookingMeta(r.customer_notes);
      const requestedMinutes=meta.hours?Math.max(15,Math.round(meta.hours*4)*15):120;
      const total=((hh*60+mm+requestedMinutes)%(24*60));
      $('job-end').value=`${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
    }
    const bookingMeta=requestBookingMeta(r.customer_notes);
    $('job-address').value=[r.street_address,r.city,r.province,r.postal_code].filter(Boolean).join(', ');
    $('job-description').value=[r.work_description||'',bookingMeta.dropoff?`Drop-off Address: ${bookingMeta.dropoff}`:''].filter(Boolean).join('\n\n');
    $('job-message').value=r.customer_notes||'';
    $('job-internal-notes').value=r.internal_notes||'';
    const td=$('job-date').value,ts=$('job-start').value,te=$('job-end').value;teamAssignments=[teamDefault(td,ts,te)];renderTeam();

    openDrawer();
    updateAvailabilityNote();
  }
  function openExistingJob(j){
    resetForm();setMultiMode(false);$('job-existing-id').value=j.id;$('job-drawer-title').textContent=`Correct & Reassign ${j.reference}`;$('job-drawer-eyebrow').textContent='NEEDS ASSIGNMENT · EDITABLE BILLING';
    const c=j.customers||{};$('customer-first-name').value=c.first_name||'';$('customer-last-name').value=c.last_name||'';$('customer-email').value=c.email||'';$('customer-phone').value=c.phone||'';$('job-service').value=j.service_id||'';$('job-address').value=j.work_address||'';$('job-description').value=j.work_description||'';$('job-internal-notes').value='';
    const failed=(data.reassignment_assignments||[]).filter(a=>a.job_id===j.id&&['DECLINED','CANCELLED'].includes(a.status)).sort((a,b)=>new Date(b.responded_at||b.assigned_at||0)-new Date(a.responded_at||a.assigned_at||0))[0]||null;
    reassignmentTargetAssignment=failed;
    const allBilling=billingForJob(j.id),targetBilling=failed?allBilling.filter(x=>x.assignment_id===failed.id||(!x.assignment_id&&x.provider_id===failed.provider_id)):allBilling;
    const sourceBilling=(targetBilling.length?targetBilling:allBilling).map(x=>({...x}));
    const preferred=failed?.provider_id||sourceBilling.find(x=>x.provider_id)?.provider_id||'';
    // Reassignment starts from the Provider's current catalog compensation so an old frozen
    // Job snapshot never silently overwrites a newer Provider profile rate. Quantity and
    // PLEASE Customer Rate remain the Job values and can be corrected by Administration.
    billingItems=sourceBilling.map(x=>{const r=providerRates(preferred).find(z=>z.id===x.provider_service_rate_id);return r?{...x,provider_compensation_method:r.provider_compensation_method,provider_compensation_value:r.provider_compensation}:x;});
    if(failed?.scheduled_start&&failed?.scheduled_end){const st=localParts(failed.scheduled_start),en=localParts(failed.scheduled_end);$('job-date').value=st.date;$('job-start').value=st.time;$('job-end').value=en.time;$('job-message').value=failed.assignment_message||'';}
    setExistingMode(true);populateJobProviders(j.service_id||'',preferred);renderBillingPicker();renderBillingItems();openDrawer();updateAvailabilityNote();
    showAlert(`Editing ${j.reference} before reassignment. Provider, schedule, quantity, PLEASE Customer Rate and Provider Rate can be corrected here. Historical completed/confirmed team members are not changed.`,'success');
  }

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

  function financialIntegrityIssues(assignments){
    const issues=[];
    for(let ai=0;ai<assignments.length;ai++){
      const a=assignments[ai];
      const rates=providerRates(a.provider_id);
      for(let bi=0;bi<(a.billing_items||[]).length;bi++){
        const x=a.billing_items[bi],r=rates.find(z=>z.id===x.provider_service_rate_id);
        const q=Number(x.quantity)||0,cr=Number(x.customer_unit_rate)||0,pr=teamRateProviderCost(r,cr,x);
        if(cr<=0) issues.push(`Provider ${ai+1}, billing item ${bi+1}: PLEASE Customer Rate is ${money(cr)}.`);
        else if(pr!=null&&cr<=pr) issues.push(`Provider ${ai+1}, ${x.description||'billing item'}: Customer ${money(cr)} / ${x.unit||'unit'} vs Provider ${money(pr)} / ${x.unit||'unit'} (zero or negative margin).`);
      }
    }
    return issues;
  }
  function confirmFinancialIntegrity(assignments){
    const issues=financialIntegrityIssues(assignments);
    if(!issues.length)return true;
    return confirm(`FINANCIAL SEPARATION WARNING\n\n${issues.join('\n')}\n\nPLEASE Customer Rate must be the amount charged to the customer, not the Provider compensation. Continue only if this zero/negative margin is intentional.`);
  }

  async function submitJob(e){
    e.preventDefault();clearAlert();
    try{await ensureAssignmentCatalog(false);}catch(err){return showAlert(err.message||'Unable to refresh assignment data.');}
    const existing=$('job-existing-id').value,serviceId=$('job-service').value;if(!serviceId)return showAlert('Service is required.');
    if(!existing){
      if(!teamAssignments.length)return showAlert('Add at least one Provider.');const ids=new Set();
      for(let i=0;i<teamAssignments.length;i++){const a=teamAssignments[i];if(!a.provider_id||!a.date||!a.start||!a.end)return showAlert(`Provider ${i+1}: provider, date, start and end are required.`);if(ids.has(a.provider_id))return showAlert('The same Provider cannot be added twice to the same Job.');ids.add(a.provider_id);if(!a.billing_items?.length)return showAlert(`Provider ${i+1}: add at least one billing item.`);if(!['00','15','30','45'].includes(a.start.slice(3,5))||!['00','15','30','45'].includes(a.end.slice(3,5)))return showAlert('Provider schedules must use 15-minute increments.');}
      if(!confirmFinancialIntegrity(teamAssignments))return;
      const financialIssues=financialIntegrityIssues(teamAssignments);
      const assignments=teamAssignments.map(a=>({provider_id:a.provider_id,scheduled_start:localToIso(a.date,a.start),scheduled_end:localToIso(a.date,a.end),assignment_message:a.assignment_message||$('job-message').value.trim()||'',billing_items:a.billing_items.map(x=>({provider_service_rate_id:x.provider_service_rate_id,quantity:Number(x.quantity),customer_unit_rate:Number(x.customer_unit_rate),provider_compensation_method:x.provider_compensation_method,provider_compensation_value:x.provider_compensation_value}))}));
      const payload={service_id:serviceId,assignments,allow_nonpositive_margin:financialIssues.length>0,customer_first_name:$('customer-first-name').value.trim(),customer_last_name:$('customer-last-name').value.trim(),customer_email:$('customer-email').value.trim(),customer_phone:$('customer-phone').value.trim(),work_address:$('job-address').value.trim(),work_description:$('job-description').value.trim(),internal_notes:$('job-internal-notes').value.trim()};if(sourceRequest){payload.service_request_id=sourceRequest.id;payload.customer_city=sourceRequest.city||'';payload.customer_province=sourceRequest.province||'AB';payload.customer_postal_code=sourceRequest.postal_code||'';}
      submitBtn.disabled=true;submitBtn.textContent='SENDING ASSIGNMENTS…';
      try{
        const result=await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action:'CREATE_MULTI_ASSIGN',payload})});
        closeDrawer();const first=teamAssignments[0];weekStart=startOfWeek(new Date(`${first.date}T12:00:00`));if(result.service_request_assigned)history.replaceState(null,'','admin-calendar.html');
        const success=`${result.job_reference||'Job'} created with ${result.provider_count||teamAssignments.length} Provider assignments.${result.provider_rates_updated?` ${result.provider_rates_updated} Provider Rate${result.provider_rates_updated===1?' was':'s were'} saved to the corresponding Provider profile${result.provider_rates_updated===1?'':'s'}.`:''} Each Provider must confirm independently.${result.warning?` WARNING: ${result.warning}`:''}`;
        try{await loadCalendar();showAlert(success,result.warning?'error':'success');}
        catch(refreshError){showAlert(`${success} Calendar refresh failed after the Job was already created: ${refreshError.message}`,'success');}
      }catch(err){showAlert(err.message||'Could not create the multi-provider Job.');}
      finally{submitBtn.disabled=false;submitBtn.textContent='SEND ASSIGNMENTS →';}return;
    }
    const providerId=$('job-provider').value,date=$('job-date').value,start=$('job-start').value,end=$('job-end').value;
    if(!providerId||!date||!start||!end)return showAlert('Provider, date, start and end are required.');
    if(!['00','15','30','45'].includes(start.slice(3,5))||!['00','15','30','45'].includes(end.slice(3,5)))return showAlert('Provider schedules must use 15-minute increments.');
    if(!billingItems.length)return showAlert('Add at least one billing item before reassigning this Job.');
    const reassignment=[{provider_id:providerId,billing_items:billingItems}];if(!confirmFinancialIntegrity(reassignment))return;const financialIssues=financialIntegrityIssues(reassignment);
    const payload={job_id:existing,replace_assignment_id:reassignmentTargetAssignment?.id||null,provider_id:providerId,service_id:serviceId,scheduled_start:localToIso(date,start),scheduled_end:localToIso(date,end),assignment_message:$('job-message').value.trim(),allow_nonpositive_margin:financialIssues.length>0,billing_items:billingItems.map(x=>({provider_service_rate_id:x.provider_service_rate_id,quantity:Number(x.quantity),customer_unit_rate:Number(x.customer_unit_rate??x.unit_rate),provider_compensation_method:x.provider_compensation_method,provider_compensation_value:x.provider_compensation_value}))};
    submitBtn.disabled=true;submitBtn.textContent='SAVING & REASSIGNING…';
    try{
      const result=await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action:'REASSIGN_WITH_BILLING',payload})});
      closeDrawer();weekStart=startOfWeek(new Date(`${date}T12:00:00`));
      const success=`${result.job_reference||'Job'} corrected and reassigned.${result.billing_items_replaced!=null?` ${result.billing_items_replaced} prior billing item${result.billing_items_replaced===1?'':'s'} replaced.`:''}${result.provider_rates_updated?` ${result.provider_rates_updated} Provider Rate${result.provider_rates_updated===1?' was':'s were'} saved to the Provider profile.`:''}`;
      try{await loadCalendar();showAlert(success,'success');}catch(refreshError){showAlert(`${success} Calendar refresh failed after the reassignment was already saved: ${refreshError.message}`,'success');}
    }catch(err){showAlert(err.message);}finally{submitBtn.disabled=false;submitBtn.textContent='SEND ASSIGNMENTS →';}
  }

  function openAssignment(id){
    const a=data.assignments.find(x=>x.id===id);if(!a)return;const p=data.providers.find(x=>x.id===a.provider_id),j=a.jobs||{},s=localParts(a.scheduled_start),e=localParts(a.scheduled_end),c=j.customers||{},items=billingForJob(j.id).filter(x=>x.assignment_id===a.id||(!x.assignment_id&&x.provider_id===a.provider_id)),change=scheduleChangeFor(a.id);
    const billHtml=items.length?`<h3>Customer Billing</h3><div class="calendar-modal-billing">${items.map(x=>`<div><span>${esc(x.service_name||'Service')} · ${esc(x.description)} · ${Number(x.quantity).toFixed(2)} ${esc(x.unit)}</span><strong>${money(x.customer_line_total??x.line_total)}</strong><small>Provider ${x.provider_line_total==null?'—':money(x.provider_line_total)} · Profit ${x.gross_profit==null?'—':money(x.gross_profit)}</small></div>`).join('')}<div class="grand"><span>Subtotal</span><strong>${money(items.reduce((n,x)=>n+Number((x.customer_line_total??x.line_total)??0),0))}</strong></div></div>`:'';
    const changeHtml=change?`<div class="admin-detail-section schedule-change-review"><h3>Provider Schedule Change Request</h3><p><b>Current:</b> ${esc(fmtAdmin(change.current_start))} → ${esc(fmtAdmin(change.current_end))}</p><p><b>Proposed:</b> ${esc(fmtAdmin(change.proposed_start))} → ${esc(fmtAdmin(change.proposed_end))}</p>${change.provider_reason?`<p><b>Provider reason:</b> ${esc(change.provider_reason)}</p>`:''}<div class="calendar-modal-actions"><button id="accept-schedule-change" class="btn primary" type="button">APPROVE CHANGE</button><button id="accept-team-schedule-change" class="admin-outline-button" type="button">APPROVE SAME TIME FOR TEAM</button><button id="reject-schedule-change" class="admin-danger-button" type="button">REJECT CHANGE</button></div></div>`:'';
    $('assignment-modal-content').innerHTML=`<span class="status-badge status-${a.status.toLowerCase()}">${esc(statusLabel(a.status))}</span><h2>${esc(j.reference||'Assignment')}</h2><div class="admin-detail-grid"><div><span>Provider</span><strong>${esc(p?.display_name||'')}</strong></div><div><span>Service</span><strong>${esc(j.service_name||'')}</strong></div><div><span>Date</span><strong>${esc(s.date)}</strong></div><div><span>Time</span><strong>${time12(s.time)}–${time12(e.time)}</strong></div><div><span>Customer</span><strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'—')}</strong></div><div><span>Customer Contact</span><strong>${esc(c.email||c.phone||'—')}</strong></div></div>${billHtml}<h3>Work Address</h3><p>${esc(j.work_address||'')}</p><h3>Work Description</h3><p class="admin-prewrap">${esc(j.work_description||'')}</p>${a.assignment_message?`<h3>Message to Provider</h3><p>${esc(a.assignment_message)}</p>`:''}${a.provider_response_note?`<h3>Provider Response</h3><p>${esc(a.provider_response_note)}</p>`:''}${changeHtml}<div class="calendar-modal-actions">${['PENDING','CONFIRMED'].includes(a.status)?'<button id="cancel-assignment" class="admin-danger-button" type="button">CANCEL ASSIGNMENT</button>':''}</div>`;
    $('assignment-modal').hidden=false;
    const accept=$('accept-schedule-change');if(accept)accept.onclick=()=>reviewScheduleChange(change.id,'ACCEPT','',false);const teamAccept=$('accept-team-schedule-change');if(teamAccept)teamAccept.onclick=()=>{if(confirm('Apply this same requested date and time to every active Provider assignment on this Job?'))reviewScheduleChange(change.id,'ACCEPT','Applied to remaining service team by PLEASE Administration.',true);};const reject=$('reject-schedule-change');if(reject)reject.onclick=()=>{const note=prompt('Reason for rejecting the provider schedule change (optional):','');if(note!==null)reviewScheduleChange(change.id,'REJECT',note,false);};
    const cancel=$('cancel-assignment');if(cancel)cancel.addEventListener('click',async()=>{if(!confirm('Cancel this assignment and return the job to Needs Assignment?'))return;cancel.disabled=true;try{await api('/.netlify/functions/admin-job-action',{method:'POST',body:JSON.stringify({action:'CANCEL_ASSIGNMENT',payload:{assignment_id:a.id,note:'Cancelled by PLEASE administration'}})});$('assignment-modal').hidden=true;await loadCalendar();showAlert('Assignment cancelled. The job now needs reassignment.','success');}catch(err){showAlert(err.message);}finally{cancel.disabled=false;}});
  }
  function fmtAdmin(v){return v?new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:TZ}).format(new Date(v)):'—';}
  async function reviewScheduleChange(id,action,note='',applyToTeam=false){try{const result=await api('/.netlify/functions/admin-schedule-change-action',{method:'POST',body:JSON.stringify({request_id:id,action,note,apply_to_team:applyToTeam})});$('assignment-modal').hidden=true;await loadCalendar();const extra=action==='ACCEPT'&&result.updated_assignments>1?` for ${result.updated_assignments} Providers`:'';showAlert(`Schedule change ${action==='ACCEPT'?`approved${extra} and calendar updated`:'rejected'}.`,'success');}catch(e){showAlert(e.message);}}

  function on(id,event,handler){const el=$(id);if(el)el.addEventListener(event,handler);return el;}
  function bindEvents(){
    on('new-job','click',()=>{sourceRequest=null;try{sessionStorage.removeItem('pleasePendingServiceRequest');}catch{}history.replaceState(null,'','admin-calendar.html');openNewJob();});
    on('prev-week','click',()=>{weekStart=addDays(weekStart,-7);loadCalendar().catch(e=>showAlert(e.message));});
    on('next-week','click',()=>{weekStart=addDays(weekStart,7);loadCalendar().catch(e=>showAlert(e.message));});
    on('today-week','click',()=>{weekStart=startOfWeek(new Date());loadCalendar().catch(e=>showAlert(e.message));});
    on('refresh-calendar','click',()=>loadCalendar().catch(e=>showAlert(e.message)));
    serviceFilter?.addEventListener('change',renderCalendar);providerFilter?.addEventListener('change',renderCalendar);
    on('job-service','change',()=>{populateJobProviders($('job-service').value);teamAssignments.forEach(a=>{if(a.provider_id&&!eligibleProviders($('job-service').value).some(p=>p.id===a.provider_id)){a.provider_id='';a.billing_items=[];}});renderTeam();});
    on('job-provider','change',()=>{updateAvailabilityNote();const pid=$('job-provider').value;if(billingItems.some(x=>!providerRates(pid).some(r=>r.id===x.provider_service_rate_id)))billingItems=[];renderBillingPicker();});
    on('job-date','change',updateAvailabilityNote);on('job-start','change',updateAvailabilityNote);on('job-end','change',updateAvailabilityNote);
    on('job-add-billing-item','click',addBillingItem);
    on('job-add-provider','click',()=>{const base=teamAssignments[0]||teamDefault();teamAssignments.push(teamDefault(base.date,base.start,base.end));renderTeam();});
    on('job-drawer-close','click',closeDrawer);backdrop?.addEventListener('click',closeDrawer);form?.addEventListener('submit',submitJob);
    on('assignment-modal-close','click',()=>{if($('assignment-modal'))$('assignment-modal').hidden=true;});
    $('assignment-modal')?.addEventListener('click',e=>{if(e.target===$('assignment-modal'))$('assignment-modal').hidden=true;});
    on('admin-signout','click',async()=>{try{await api('/.netlify/functions/admin-logout',{method:'POST',body:'{}'});}catch{}location.replace('admin-login.html');});
  }

  async function init(){
    try{
      if(!loading||!app) throw new Error('Administration calendar page is incomplete. Deploy admin-calendar.html and js/admin-calendar.js from the same release.');
      loading.textContent='Checking secure session…';
      await ensureSession();
      loading.textContent='Loading Master Calendar…';
      const requestId=new URLSearchParams(location.search).get('request');
      let calendarWarning=null;
      try{await loadCalendar();}catch(e){calendarWarning=e;}
      bindEvents();
      loading.hidden=true;loading.remove();app.hidden=false;
      if(calendarWarning)showAlert(`Master Calendar background data could not refresh (${calendarWarning.message}). You can still continue assigning the selected Service Request.`);
      if(requestId){let cached=null;try{cached=JSON.parse(sessionStorage.getItem('pleasePendingServiceRequest')||'null');}catch{}await openServiceRequestForAssignment(requestId,cached);}
    }catch(e){
      console.error('admin-calendar init',e);
      if(loading){loading.textContent=e.message||'Unable to load secure calendar.';loading.classList.add('admin-loading-error');}
      else showAlert(e.message||'Unable to load secure calendar.');
    }
  }
  init();
})();
