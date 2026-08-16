(()=>{
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let data={jobs:[],assignments:[],providers:[],services:[],assignment_history:[]};
 async function api(url,opt={}){const r=await fetch(url,{credentials:'same-origin',headers:{'content-type':'application/json',...(opt.headers||{})},...opt});const t=await r.text();let p={};try{p=t?JSON.parse(t):{}}catch{p={error:t}}if(r.status===401){location.replace('admin-login.html');throw Error('Session expired')}if(!r.ok)throw Error(p.error||'Request failed');return p}
 function show(m){$('reports-alert').textContent=m;$('reports-alert').hidden=false}
 function latest(jobId){return data.assignments.filter(a=>a.job_id===jobId).sort((a,b)=>new Date(b.assigned_at)-new Date(a.assigned_at))[0]||null}
 function dayOf(v){return v?new Date(v).toISOString().slice(0,10):''}
 function minutes(a){return Math.max(0,(new Date(a.scheduled_end)-new Date(a.scheduled_start))/60000||0)}
 function historyHas(assignmentId,status){return data.assignment_history.some(h=>h.assignment_id===assignmentId&&String(h.new_status||'').toUpperCase()===status)}
 function wasAccepted(a){return ['CONFIRMED','COMPLETED'].includes(String(a.status||'').toUpperCase())||historyHas(a.id,'CONFIRMED')||historyHas(a.id,'COMPLETED')}
 function wasDeclined(a){return String(a.status||'').toUpperCase()==='DECLINED'||historyHas(a.id,'DECLINED')}
 function wasCompleted(a){return String(a.status||'').toUpperCase()==='COMPLETED'||historyHas(a.id,'COMPLETED')}
 function filterValues(){return{from:$('reports-from').value,to:$('reports-to').value,pid:$('reports-provider').value,sid:$('reports-service').value,st:$('reports-status').value}}
 function chosenJobs(){const {from,to,pid,sid,st}=filterValues();return data.jobs.filter(j=>{const related=data.assignments.filter(a=>a.job_id===j.id);const dated=related.length?related.filter(a=>{const d=dayOf(a.scheduled_start||j.created_at);return(!from||d>=from)&&(!to||d<=to)}):[null].filter(()=>{const d=dayOf(j.created_at);return(!from||d>=from)&&(!to||d<=to)});return dated.length>0&&(pid==='ALL'||dated.some(a=>a?.provider_id===pid))&&(sid==='ALL'||j.service_id===sid)&&(st==='ALL'||j.status===st)})}
 function chosenAssignments(jobIds){const {from,to,pid}=filterValues();return data.assignments.filter(a=>{if(!jobIds.has(a.job_id))return false;const d=dayOf(a.scheduled_start||a.assigned_at);return(!from||d>=from)&&(!to||d<=to)&&(pid==='ALL'||a.provider_id===pid)})}
 function updateExports(){const q=new URLSearchParams({from:$('reports-from').value,to:$('reports-to').value,provider:$('reports-provider').value,service:$('reports-service').value,status:$('reports-status').value});$('report-export-csv').href='/.netlify/functions/admin-reports-export?format=csv&'+q.toString();$('report-export-xlsx').href='/.netlify/functions/admin-reports-export?format=xlsx&'+q.toString()}
 function render(){
  updateExports();
  const jobs=chosenJobs(),ids=new Set(jobs.map(j=>j.id)),assign=chosenAssignments(ids);
  $('report-jobs').textContent=jobs.length;
  $('report-completed').textContent=jobs.filter(j=>j.status==='COMPLETED').length;
  $('report-cancelled').textContent=jobs.filter(j=>j.status==='CANCELLED').length;
  $('report-hours').textContent=(jobs.filter(j=>j.status==='COMPLETED').reduce((n,j)=>n+(Number(j.estimated_duration_minutes)||0),0)/60).toFixed(1);

  const byP=new Map();
  for(const a of assign){
    const p=a.providers||{},k=a.provider_id||'none';
    if(!byP.has(k))byP.set(k,{name:p.display_name||p.company_name||'Unknown',assignments:0,assignedMin:0,accepted:0,declined:0,completed:0,completedMin:0});
    const x=byP.get(k),m=minutes(a);x.assignments++;x.assignedMin+=m;
    if(wasAccepted(a))x.accepted++;
    if(wasDeclined(a))x.declined++;
    if(wasCompleted(a)){x.completed++;x.completedMin+=m}
  }
  $('provider-report-body').innerHTML=[...byP.values()].sort((a,b)=>b.assignments-a.assignments).map(x=>{
    const rate=x.accepted?((x.completed/x.accepted)*100):0;
    return `<tr><td><strong>${esc(x.name)}</strong></td><td>${x.assignments}</td><td>${(x.assignedMin/60).toFixed(1)}</td><td>${x.accepted}</td><td>${x.declined}</td><td>${x.completed}</td><td>${rate.toFixed(0)}%</td><td>${(x.completedMin/60).toFixed(1)}</td></tr>`
  }).join('')||'<tr><td colspan="8">No provider activity in this period.</td></tr>';

  const byS=new Map();
  for(const j of jobs){const k=j.service_name||'Unknown';if(!byS.has(k))byS.set(k,{name:k,n:0,c:0,x:0,min:0});const z=byS.get(k);z.n++;if(j.status==='COMPLETED'){z.c++;z.min+=Number(j.estimated_duration_minutes)||0}if(j.status==='CANCELLED')z.x++}
  $('service-report-body').innerHTML=[...byS.values()].sort((a,b)=>b.n-a.n).map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${x.n}</td><td>${x.c}</td><td>${x.x}</td><td>${(x.min/60).toFixed(1)}</td></tr>`).join('')||'<tr><td colspan="5">No service activity in this period.</td></tr>'
 }
 function initFilters(){const now=new Date(),first=new Date(now.getFullYear(),now.getMonth(),1);$('reports-from').value=first.toISOString().slice(0,10);$('reports-to').value=now.toISOString().slice(0,10);$('reports-provider').innerHTML='<option value="ALL">All providers</option>'+data.providers.map(p=>`<option value="${p.id}">${esc(p.display_name)}</option>`).join('');$('reports-service').innerHTML='<option value="ALL">All services</option>'+data.services.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
 $('reports-apply').onclick=render;$('admin-signout').onclick=async()=>{try{await api('/.netlify/functions/admin-logout',{method:'POST',body:'{}'})}catch{}location.replace('admin-login.html')};
 (async()=>{try{const s=await api('/.netlify/functions/admin-session');$('admin-name').textContent=s.user?.display_name||'PLEASE Administrator';$('admin-email').textContent=s.user?.email||'';data=await api('/.netlify/functions/admin-reports-data');initFilters();render();$('admin-loading').remove();$('admin-app').hidden=false}catch(e){show(e.message)}})();
})();
