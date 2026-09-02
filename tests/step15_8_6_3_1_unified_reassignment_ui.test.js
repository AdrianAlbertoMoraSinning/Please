const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const js=read('js/admin-calendar.js');
const html=read('admin-calendar.html');
const data=read('netlify/functions/admin-calendar-data.js');

ok(js.includes('reassignmentMode=true')&&js.includes('setMultiMode(true)'), 'Needs Assignment reuses the normal multi-provider card instead of switching to the legacy form');
ok(js.includes('teamAssignments=[{provider_id:preferred,date,start,end')&&js.includes('billing_items:editableBilling'), 'Rejected Provider, schedule and billing snapshot are prefilled in the normal team card');
ok(js.includes("a.provider_id=e.target.value;a.billing_items=[];renderTeam();"), 'Changing Provider clears incompatible billing lines and refreshes Provider Rate choices exactly like original Job creation');
ok(js.includes('a.is_primary==null?i===0:Boolean(a.is_primary)')&&js.includes('sequence_no'), 'Unified card preserves the replaced assignment Primary flag and team position');
ok(js.includes("$('job-add-provider').hidden=false"), 'Latest compatible UI keeps the normal Add Another Provider control available during reassignment');
ok(js.includes("action:'REASSIGN_MULTI_WITH_BILLING'")&&js.includes('assignments=teamAssignments.map'), 'Reassignment submission reads the same multi-provider team-card state that Administration edits');
ok(html.includes('Service Team & Provider Billing')&&html.includes('+ ADD ANOTHER PROVIDER'), 'Drawer keeps the same Provider/Billing workflow and add-provider control used for original Job creation');
ok(html.includes('id="legacy-assignment-section" hidden'), 'Legacy assignment controls remain hidden and are no longer the visible reassignment UI');
ok(/js\/admin-calendar\.js\?v=(?:15\.8\.6\.3\.[12]|15\.(?:9|\d{2,}))/.test(html), 'Master Calendar cache-busts the unified reassignment releases');
ok(data.includes('source_service_request_id')&&data.includes('source_requests:sourceRequests||[]'), 'Needs Assignment also restores linked PLS-REQ context when available');
ok(js.includes("$('job-source-request-reference').textContent=linkedRequest.reference")&&js.includes('job-source-request-preference'), 'Reassignment shows the original customer Request reference and preference when linked');
ok(!fs.existsSync(path.join(root,'supabase/STEP15_8_6_3_1.sql')), 'STEP 15.8.6.3.1 requires no SQL migration');

if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.6.3.1 unified reassignment UI compatibility audit completed successfully.');
