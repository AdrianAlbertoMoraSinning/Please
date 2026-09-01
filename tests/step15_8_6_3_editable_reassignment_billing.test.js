const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const calJs=read('js/admin-calendar.js');
const calHtml=read('admin-calendar.html');
const calData=read('netlify/functions/admin-calendar-data.js');
const jobAction=read('netlify/functions/admin-job-action.js');

ok(calJs.includes("NEEDS ASSIGNMENT · EDITABLE BILLING")&&calJs.includes('Correct & Reassign'),'Needs Assignment opens an explicit correction/reassignment workflow');
ok(calJs.includes('billing-provider-rate')&&calJs.includes('PLEASE Customer Rate')&&calJs.includes('Qty'),'Reassignment billing exposes quantity, customer rate and provider rate');
ok(calJs.includes("action:'REASSIGN_WITH_BILLING'")&&calJs.includes('replace_assignment_id'),'Reassignment submits a billing-aware replacement action tied to the declined/cancelled assignment');
ok(calJs.includes('reassignment_assignments')&&calData.includes('status=in.(DECLINED,CANCELLED)'),'Master Calendar loads the prior declined/cancelled assignment so provider/order/schedule can be prefilled');
ok(calData.includes('provider_compensation_method,provider_compensation_value'),'Frozen billing rows include their Provider compensation snapshot for editing');
ok(calHtml.includes('job-billing-provider-cost')&&calHtml.includes('job-billing-profit'),'Reassignment shows Provider Cost and PLEASE Gross Profit before sending');
ok(calHtml.includes('js/admin-calendar.js?v=15.8.6.3'),'Master Calendar cache-busts STEP 15.8.6.3');

ok(jobAction.includes("if(action==='REASSIGN_WITH_BILLING')"),'Backend has a dedicated billing-aware reassignment action');
ok(jobAction.includes("p_action:'ASSIGN_EXISTING'")&&jobAction.includes('please_portal_job_action'),'Backend reuses the existing secure assignment lifecycle for the same Job');
ok(jobAction.includes('sequence_no:Number(replaceAssignment.sequence_no)||1')&&jobAction.includes('is_primary:Boolean(replaceAssignment.is_primary)'),'Replacement Provider preserves team order and primary status');
ok(jobAction.includes("/rest/v1/job_billing_items',{method:'POST'")&&jobAction.includes("method:'DELETE'"),'Backend writes the corrected billing snapshot then removes the replaced assignment billing snapshot');
ok(jobAction.includes('applyProviderRateChanges(validated.rateChanges)')&&jobAction.includes('recordProviderRateChanges(appliedRates'),'Changed Provider Rate persists to the selected Provider profile and remains audited');
ok(jobAction.includes('quoted_subtotal:subtotal')&&jobAction.includes('estimated_duration_minutes:durationMinutes'),'Job subtotal and duration are synchronized after correction');
ok(jobAction.includes('Automatic rollback: billing correction could not be saved')&&jobAction.includes('rollbackProviderRateChanges(appliedRates)'),'Partial reassignment failures attempt to rollback the replacement assignment and Provider Rate change');
ok(!fs.existsSync(path.join(root,'supabase/STEP15_8_6_3.sql')),'STEP 15.8.6.3 requires no new Supabase migration');

if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.6.3 editable reassignment billing audit completed successfully.');
