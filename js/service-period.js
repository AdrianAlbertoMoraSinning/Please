(function(root){
 'use strict';
 const zone='America/Edmonton';
 function parts(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw Error('Invalid date');const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),g=t=>p.find(x=>x.type===t).value;return{date:`${g('year')}-${g('month')}-${g('day')}`,time:`${g('hour')}:${g('minute')}`};}
 function localToIso(date,time){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw Error('Date and time required');const [y,m,d]=date.split('-').map(Number),[h,n]=time.split(':').map(Number),target=Date.UTC(y,m-1,d,h,n);let guess=target;for(let i=0;i<4;i++){const p=parts(guess),[yy,mm,dd]=p.date.split('-').map(Number),[hh,nn]=p.time.split(':').map(Number),delta=target-Date.UTC(yy,mm-1,dd,hh,nn);guess+=delta;if(!delta)break;}const p=parts(guess);if(p.date!==date||p.time!==time)throw Error('Invalid local date/time');return new Date(guess).toISOString();}
 function duration(sd,st,ed,et){try{const n=(new Date(localToIso(ed,et))-new Date(localToIso(sd,st)))/60000;return n>=15&&n%15===0?n:null;}catch{return null;}}
 function covers(start,end,date){try{const s=parts(start),e=parts(end);return date>=s.date&&(date<e.date||(date===e.date&&e.time!=='00:00'));}catch{return false;}}
 const api={parts,localToIso,duration,covers};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PleaseSchedule=api;
})(typeof window!=='undefined'?window:this);
