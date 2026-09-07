const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exitCode=1;}else console.log('PASS:',msg);}

const critical={
  'netlify/functions/public-service-request.js':['sendAdmins','email_sent'],
  'netlify/functions/public-provider-application.js':['sendAdmins','please-applicant-'],
  'netlify/functions/admin-service-request-action.js':['notify.send'],
  'netlify/functions/admin-job-action.js':['sendProvider','notifyCustomerJob'],
  'netlify/functions/provider-assignment-action.js':['sendAdmins','notify.send'],
  'netlify/functions/provider-schedule-change-action.js':['sendAdmins','notify.send'],
  'netlify/functions/admin-schedule-change-action.js':['sendProvider','notify.send'],
  'netlify/functions/provider-live-service-action.js':['sendAdmins','notify.send'],
  'netlify/functions/public-extension-response.js':['sendAdmins','sendProvider','notify.send'],
  'netlify/functions/admin-extension-action.js':['sendProvider','notify.send'],
  'netlify/functions/admin-invoice-action.js':['notify.send'],
  'netlify/functions/stripe-webhook.js':['notify.send','sendAdmins'],
  'netlify/functions/admin-provider-payment-action.js':['sendProvider'],
  'netlify/functions/admin-provider-advance-action.js':['sendProvider'],
  'netlify/functions/admin-application-action.js':['notify.send','sendDevelopers'],
  'netlify/functions/developer-onboarding-action.js':['notify.send','sendAdmins'],
  'netlify/functions/admin-provider-account-action.js':['sendProvider'],
  'netlify/functions/developer-provider-account-action.js':['sendProvider'],
  'netlify/functions/admin-job-management-action.js':['notify.send','sendProvider'],
  'netlify/functions/provider-availability-action.js':['sendAdmins'],
  'netlify/functions/provider-service-action.js':['sendAdmins'],
  'netlify/functions/provider-service-rate-action.js':['sendAdmins'],
  'netlify/functions/provider-document-upload.js':['sendDevelopers'],
  'netlify/functions/provider-document-action.js':['sendDevelopers'],
  'netlify/functions/developer-provider-document-action.js':['sendProvider'],
  'netlify/functions/admin-provider-service-action.js':['sendProvider'],
  'netlify/functions/developer-provider-service-action.js':['sendProvider'],
  'netlify/functions/provider-profile-action.js':['sendAdmins'],
  'netlify/functions/admin-request-tracking-link.js':['notify.send'],
  'netlify/functions/public-request-tracking-recover.js':['notify.send'],
  'netlify/functions/admin-change-password.js':['notify.send'],
  'netlify/functions/provider-change-password.js':['sendProvider'],
  'netlify/functions/developer-create-staff.js':['notify.send','sendAdmins']
};
for(const [file,needles] of Object.entries(critical)){
  const s=read(file);ok(needles.every(n=>s.includes(n)),`${file} contains required transactional notification routing`);
}

const html=[];
(function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.name.endsWith('.html'))html.push(full);}})(root);
for(const f of html){const s=fs.readFileSync(f,'utf8');ok(s.includes('favicon.ico')&&s.includes('favicon-32.png')&&s.includes('apple-touch-icon.png'),`${path.relative(root,f)} includes PLEASE favicon links`);}

const files=[];(function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()){if(e.name!=='tests')walk(f);}else if(/\.(js|html|gs)$/i.test(e.name))files.push(f);}})(root);
const corpus=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
ok(!/kinetica|abogadosasociados|rowshan|sumaq|montecristo|strata/i.test(corpus),'No prior-client identifiers remain in production code/templates');
ok(!/notifications@mail\.pleaseservice\.ca/i.test(corpus),'No unverified mail.pleaseservice.ca sender remains in executable source');
const mailtos=[...corpus.matchAll(/mailto:([^\"'? >]+)/ig)].map(m=>m[1].toLowerCase());
ok(mailtos.every(x=>x==='info@pleaseservice.ca'),'All mailto contact links route to info@pleaseservice.ca');
ok(!read('js/work-with-us.js').includes('provider-application-notify'),'Professional application notification no longer depends on browser best-effort call');
ok(!read('js/admin-calendar.js').includes('provider-assignment-notify'),'Assignment notification no longer depends on browser best-effort call');
ok(read('provider-manifest.webmanifest').includes('/images/please-app-192.png')&&read('provider-manifest.webmanifest').includes('/images/please-app-512.png'),'Provider PWA manifest uses PLEASE app icons');

if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.7 static notification/favicon audit completed successfully.');
