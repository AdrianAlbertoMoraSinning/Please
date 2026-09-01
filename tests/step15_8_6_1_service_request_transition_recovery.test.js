const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}

const action=read('netlify/functions/admin-service-request-action.js');
const list=read('netlify/functions/admin-service-requests.js');
const ui=read('js/admin-service-requests.js');
const html=read('admin-service-requests.html');

ok(!action.includes('/rest/v1/rpc/please_service_request_action'),'Admin Service Request transitions no longer depend on legacy RPC');
ok(action.includes("transitionPlan(action,current,p.value)")&&action.includes("status=eq.${encodeURIComponent(current.status)}"),'Transitions enforce state rules and optimistic current-status guard');
ok(action.includes('actionAlreadyApplied(action,current.status)')&&action.includes('already_applied:true'),'Repeated transition clicks remain idempotent');
ok(action.includes("if(action==='SAVE_NOTES')")&&action.includes('notification_sent:false'),'Internal notes are saved without customer notification');
ok(action.includes('history_recorded:historyRecorded')&&action.includes('history-warning'),'Status history remains audited without false transaction failure on auxiliary history warning');
ok(action.includes('notify.send')&&action.includes('Email delivery is deliberately non-blocking'),'Email delivery remains non-blocking after the business transition');
ok(list.includes("optional('history'")&&list.includes("optional('services'")&&list.includes('The list view does not need the service catalog'),'Auxiliary drawer queries no longer collapse the Service Request queue');
ok(ui.includes('Request failed (HTTP ${r.status}).')&&ui.includes('Request updated successfully, but the screen could not refresh automatically'),'Administration surfaces useful HTTP errors and distinguishes refresh failure from transaction failure');
ok(html.includes('js/admin-service-requests.js?v=15.8.6.1'),'Service Request page cache-busts the repaired browser code');
ok(!fs.existsSync(path.join(root,'supabase/STEP15_8_6_1.sql')),'STEP 15.8.6.1 requires no new SQL migration');

if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.6.1 transition recovery audit completed successfully.');
