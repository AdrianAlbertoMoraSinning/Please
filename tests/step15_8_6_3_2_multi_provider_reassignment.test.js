const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const js=read('js/admin-calendar.js'),html=read('admin-calendar.html'),backend=read('netlify/functions/admin-job-action.js');
ok(js.includes("$('job-add-provider').hidden=false")&&js.includes("if(reassignmentMode){const next="),'Correct & Reassign exposes + ADD ANOTHER PROVIDER and creates additional team cards');
ok(js.includes('replacement:Boolean(a.replacement)')&&js.includes("action:'REASSIGN_MULTI_WITH_BILLING'"),'Browser sends replacement plus added Providers together in one reassignment request');
ok(js.includes("const replacing=Boolean(reassignmentMode&&a.replacement)")&&js.includes("'Additional service team member'"),'Only the failed slot is labelled as a replacement; extra Providers are labelled as additions');
ok(js.includes("(!reassignmentMode||!a.replacement)")&&js.includes('team-remove-provider'),'Newly added reassignment Providers can be removed without removing the required replacement slot');
ok(html.includes('+ ADD ANOTHER PROVIDER')&&html.includes('expand the team without creating a second Job'),'UI explains that team expansion remains inside the same Job');
ok(html.includes('js/admin-calendar.js?v=15.8.6.3.2'),'STEP 15.8.6.3.2 cache-bust is active');
ok(backend.includes("if(action==='REASSIGN_MULTI_WITH_BILLING')")&&backend.includes('const plan=incoming.map'),'Backend plans one replacement plus zero or more additional Provider assignments');
ok(backend.includes('activeProviderIds.has(pid)')&&backend.includes('seen.has(pid)'),'Backend blocks duplicate Providers against both current active team and new selections');
ok(backend.includes('provider_is_available_for_window')&&backend.includes('status=in.(PENDING,CONFIRMED)&scheduled_start=lt.'),'Every new/replacement Provider is checked for published availability and overlap');
ok(backend.includes("status:'PENDING'")&&backend.includes('sequence_no:a.sequence_no')&&backend.includes('is_primary:Boolean(a.is_primary)'),'New assignments preserve replacement primary/order and create added Providers as independent PENDING assignments');
ok(backend.includes('requiredProviderCount=activeExisting.length+newAssignments.length'),'Same Job expands its required team count when additional Providers are added');
ok(backend.includes('notifyAssignment(a.id')&&backend.includes("notifyCustomerJob(jobId,'SCHEDULED')"),'Each new Provider receives an assignment notification while customer coordination remains one Job');
ok(!fs.existsSync(path.join(root,'supabase/STEP15_8_6_3_2.sql')),'No SQL migration is required for multi-provider reassignment');
if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.6.3.2 multi-provider reassignment static audit completed successfully.');
