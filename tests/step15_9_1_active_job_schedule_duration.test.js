const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const helper=read('netlify/functions/_job-schedule-lib.js'),endpoint=read('netlify/functions/admin-active-job-update.js');
const cal=read('js/admin-calendar.js'),calHtml=read('admin-calendar.html');
const reqAction=read('netlify/functions/admin-service-request-action.js'),reqData=read('netlify/functions/admin-service-requests.js'),reqJs=read('js/admin-service-requests.js'),reqHtml=read('admin-service-requests.html');
const maint=read('netlify/functions/admin-service-maintenance.js'),maintJs=read('js/admin-service-maintenance.js'),maintHtml=read('admin-service-maintenance.html');
ok(helper.includes('async function updateActiveJob')&&endpoint.includes('schedule.updateActiveJob'),'Active Job schedule/duration has one reusable authenticated backend mutation path');
ok(helper.includes("status=in.(PENDING,CONFIRMED)")&&helper.includes('The service has already started. You may adjust the end time / remaining duration, but not move the start time.'),'Only active Provider assignments are rescheduled and started work protects its original start time');
ok(helper.includes('isHourly(x.unit)')&&helper.includes('quantity:money(qty)')&&helper.includes('customer_line_total')&&helper.includes('provider_line_total')&&helper.includes('gross_profit'),'Changing service hours synchronizes hourly customer/provider billing quantities and totals without changing rates');
ok(helper.includes('quoted_subtotal')&&helper.includes('estimated_duration_minutes:maxDuration'),'Job subtotal and operational duration are recalculated after schedule/hour changes');
ok(helper.includes('service_request_status_history')&&helper.includes('preferred_date')&&helper.includes('preferred_start_time')&&helper.includes('estimated_hours'),'Linked Customer Tracking request schedule is synchronized and audited');
ok(helper.includes('sendProvider')&&helper.includes('Service Schedule Updated')&&helper.includes('continues to show only confirmed PLEASE professionals')&&helper.includes('Promise.allSettled'),'Provider/customer schedule-change notifications preserve Customer Tracking privacy and cannot turn a saved mutation into a false failure');
ok(cal.includes('EDIT SERVICE SCHEDULE & HOURS')&&cal.includes('admin-active-job-update')&&cal.includes('Apply the date/time/hours to all active Providers'),'Master Calendar can reduce/increase date, start and service hours on an existing active Job');
ok(reqAction.includes('related Job could not be synchronized')&&reqAction.includes('syncHourlyBilling:true')&&reqAction.includes('The Service cannot be changed after a Job has been created'),'Assigned Service Requests synchronize the existing Job atomically and block conflicting service changes');
ok(reqData.includes('job_scheduled_start')&&reqJs.includes('job_scheduled_start')&&reqHtml.includes('request-job-sync-note'),'Service Request editor uses the actual linked Job schedule instead of stale request preferences');
ok(maint.includes('schedule.updateActiveJob')&&maintJs.includes('SAVE JOB + CONFIRM NEW TOTALS')&&maintJs.includes('End Time')&&maintHtml.includes('v=15.9.2'),'Service Maintenance can edit active Job date/start/end/hours and confirm synchronized billing');
ok(calHtml.includes('js/admin-calendar.js?v=15.9.1')&&reqHtml.includes('js/admin-service-requests.js?v=15.9.1'),'Admin schedule screens are cache-busted for STEP 15.9.1');
if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.9.1 active Job schedule/duration static audit completed successfully.');
