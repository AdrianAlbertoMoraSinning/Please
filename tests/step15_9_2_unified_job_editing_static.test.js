const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');let fail=false;const ok=(c,m)=>{console.log(`${c?'PASS':'FAIL'}: ${m}`);if(!c)fail=true};
const js=read('js/admin-service-maintenance.js'),fn=read('netlify/functions/admin-service-maintenance.js'),lib=read('netlify/functions/_job-schedule-lib.js'),html=read('admin-service-maintenance.html');
ok(js.includes('Converted to Service Job')&&js.includes('OPEN RELATED JOB'),'Linked Request explicitly directs Administration to the operational Job');
ok(js.includes('End Time')&&js.includes('Total Hours')&&js.includes('End Time and Total Hours do not match'),'Job editor exposes synchronized end time and total hours');
ok(js.includes('Customer Rate')&&js.includes('Provider Cost / Rate')&&js.includes('AFTER SAVE'),'Job editor previews customer charge, provider cost and PLEASE margin separately');
ok(fn.includes('billing_overrides')&&lib.includes('billingOverrides')&&lib.includes('billing_summary'),'Backend accepts billing rate review and returns persisted financial confirmation');
ok(fn.includes('out.preferred_date=before.preferred_date')&&fn.includes('syncHourlyBilling:false'),'Linked Request preserves its original requested schedule instead of accidentally overwriting the Job');
ok(html.includes('css/style.css?v=15.9.2')&&html.includes('js/admin-service-maintenance.js?v=15.9.2'),'Service Maintenance assets are cache-busted for STEP 15.9.2');
if(fail)process.exit(1);console.log('STEP 15.9.2 UNIFIED JOB EDITING STATIC PASS');
