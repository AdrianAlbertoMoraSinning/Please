// Scheduling is public to the holder of a tracking link; pending Provider identity is not.
function customerSchedule(assignments=[],jobStatus=''){
  if(['CANCELLED','NEEDS_ASSIGNMENT'].includes(jobStatus))return null;
  const active=assignments.filter(a=>['PENDING','CONFIRMED','COMPLETED'].includes(a.status));
  const valid=active.filter(a=>Number.isFinite(Date.parse(a.scheduled_start))&&Number.isFinite(Date.parse(a.scheduled_end))&&Date.parse(a.scheduled_end)>Date.parse(a.scheduled_start));
  if(!valid.length)return null;
  const windows=[...new Map(valid.map(a=>{
    const start=new Date(a.scheduled_start).toISOString(),end=new Date(a.scheduled_end).toISOString();
    return[`${start}/${end}`,{start,end}];
  })).values()].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  return{status:active.every(a=>['CONFIRMED','COMPLETED'].includes(a.status))?'CONFIRMED':'SCHEDULED',windows};
}
module.exports={customerSchedule};
