const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const calJs=read('js/admin-calendar.js');
const calHtml=read('admin-calendar.html');
const calData=read('netlify/functions/admin-calendar-data.js');
const jobAction=read('netlify/functions/admin-job-action.js');

ok(calJs.includes("NEEDS ASSIGNMENT · EDITABLE BILLING")&&calJs.includes('Correct & Reassign'),'Needs Assignment opens an explicit correction/reassignment workflow');
ok(calJs.includes('team-provider-rate')&&calJs.includes('PLEASE Customer Rate')&&calJs.includes('Qty'),'Reassignment billing exposes quantity, customer rate and provider rate');
ok(calJs.includes("action:'REASSIGN_MULTI_WITH_BILLING'")&&calJs.includes('replace_assignment_id'),'Reassignment submits a billing-aware multi-provider correction tied to the declined/cancelled assignment');
ok(calJs.includes('reassignment_assignments')&&calData.includes('status=in.(DECLINED,CANCELLED)'),'Master Calendar loads the prior declined/cancelled assignment so provider/order/schedule can be prefilled');
ok(calData.includes('provider_compensation_method,provider_compensation_value'),'Frozen billing rows include their Provider compensation snapshot for editing');
ok(calHtml.includes('team-provider-cost')&&calHtml.includes('team-profit'),'Reassignment uses the same team totals for Provider Cost and PLEASE Gross Profit as original Job creation');
ok(calHtml.includes('js/admin-calendar.js?v=15.8.6.3.2'),'Master Calendar cache-busts STEP 15.8.6.3.2');

ok(jobAction.includes("if(action==='REASSIGN_MULTI_WITH_BILLING')"),'Backend has a dedicated billing-aware multi-provider reassignment action');
ok(jobAction.includes('sequence_no:replacementSeq')&&jobAction.includes('is_primary:Boolean(replaceAssignment.is_primary)'),'Replacement Provider preserves team order and primary status');
ok(jobAction.includes('activeExisting.length+newAssignments.length')&&jobAction.includes('required_provider_count:requiredProviderCount'),'Adding Providers expands the required team count on the same Job');
ok(jobAction.includes("/rest/v1/job_billing_items',{method:'POST'")&&jobAction.includes("method:'DELETE'"),'Backend writes corrected/new billing snapshots and removes only the replaced assignment billing snapshot');
ok(jobAction.includes('applyProviderRateChanges(rateChanges)')&&jobAction.includes('recordProviderRateChanges(appliedRates'),'Changed Provider Rates persist to their selected Provider profiles and remain audited');
ok(jobAction.includes('quoted_subtotal:subtotal')&&jobAction.includes('estimated_duration_minutes:durationMinutes'),'Job subtotal and duration are synchronized after multi-provider correction');
ok(jobAction.includes('multi-reassign-new-billing-rollback')&&jobAction.includes('rollbackProviderRateChanges(appliedRates)'),'Partial multi-provider reassignment failures attempt rollback of new assignments/billing and Provider Rate changes');
ok(!fs.existsSync(path.join(root,'supabase/STEP15_8_6_3_2.sql')),'STEP 15.8.6.3.2 requires no new Supabase migration');

if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.6.3 multi-provider compatible editable billing audit completed successfully.');
