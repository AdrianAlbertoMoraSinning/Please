const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}

const booking=read('service-request.html'),bookingJs=read('js/service-request.js'),bookingFn=read('netlify/functions/public-service-request.js'),style=read('css/style.css');
ok(booking.includes('<h1 class="request-page-title">BOOK YOUR SERVICE</h1>')&&booking.includes('class="request-subtitle">Tell us what you need and when.'),'Book Your Service is the primary compact heading');
ok(style.includes('request-intro-compact')&&style.includes('request-notice-compact'),'Booking page has compact intro/disclaimer styling');
ok(!booking.includes('Moving details')&&!booking.includes('moving_bedrooms')&&!bookingJs.includes('Please complete all Moving details'),'Public booking no longer asks for Moving-specific intake');
ok(bookingFn.includes('moving_bedrooms:null,moving_square_feet:null,moving_inventory:null')&&!bookingFn.includes('Please complete the Moving details.'),'New public requests leave legacy Moving fields empty without validation');

const adminReqHtml=read('admin-service-requests.html'),adminReqJs=read('js/admin-service-requests.js'),adminReqFn=read('netlify/functions/admin-service-requests.js'),adminReqAction=read('netlify/functions/admin-service-request-action.js');
ok(!adminReqHtml.includes('detail-moving-fields')&&!adminReqJs.includes('detail-moving-bedrooms')&&!adminReqAction.includes('Complete all Moving details.'),'Administration no longer requires Moving-specific fields');
ok(adminReqFn.includes('addJobReferences')&&adminReqJs.includes('r.job_reference')&&adminReqJs.includes('OPEN RELATED JOB'),'Service Requests expose and search the related Service Job reference');
ok(adminReqHtml.includes('PLS-REQ, PLS-JOB'),'Service Request search explicitly supports both reference types');

const jobsHtml=read('admin-jobs.html'),jobsJs=read('js/admin-jobs.js');
ok(jobsHtml.includes('PLS-JOB, PLS-REQ')&&jobsJs.includes('req?.reference'),'Jobs search explicitly supports both Service Job and Customer Tracking references');
ok(jobsJs.includes('Customer Tracking Reference')&&jobsJs.includes('Service Job Reference'),'Job detail keeps both references visible together');
ok(jobsJs.includes('applySearchFromUrl'),'Related Job links can prefill the Jobs search directly');

const calData=read('netlify/functions/admin-calendar-data.js');
ok(calData.includes('services-primary')&&calData.includes('order=name.asc'),'Master Calendar service catalog has a schema-compatible fallback');
ok(calData.includes("optional('availability'")&&calData.includes("optional('schedule-changes'")&&calData.includes('warnings'),'Auxiliary Master Calendar queries are isolated instead of collapsing the whole function');

const calJs=read('js/admin-calendar.js'),jobAction=read('netlify/functions/admin-job-action.js');
ok(calJs.includes('team-provider-rate')&&calJs.includes('provider_compensation_value'),'Job creation UI includes editable Provider Rate/percentage values');
ok(calJs.includes('PLEASE Customer Rate')&&calJs.includes('PLEASE Profit'),'Customer pricing and Provider compensation remain visibly separate');
ok(jobAction.includes('applyProviderRateChanges')&&jobAction.includes('/rest/v1/provider_service_rates?id=eq.${encodeURIComponent(c.rate_id)}&provider_id=eq.${encodeURIComponent(c.provider_id)}'),'Server persists a changed Rate Item only to the corresponding Provider');
ok(jobAction.includes('rollbackProviderRateChanges')&&jobAction.includes('catch(createError)'),'Server attempts to restore Provider Rates when multi-provider Job creation fails');
ok(jobAction.includes('ADMIN_RATE_CHANGED_DURING_ASSIGNMENT')&&jobAction.includes('notifyProviderRateChanges'),'Provider Rate changes are audited and communicated to the Provider');
ok(jobAction.includes('linkSourceRequestSafely')&&jobAction.includes('source-link-fallback'),'Request-to-Job linking has a post-create recovery path');
ok(!fs.existsSync(path.join(root,'supabase/STEP15_8_6.sql')),'STEP 15.8.6 requires no new SQL migration');

if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.6 client adjustments audit completed successfully.');
