const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const jobs=read('js/admin-jobs.js'),html=read('admin-jobs.html'),css=read('css/style.css');
ok(jobs.includes('function providerTeamHtml(jobId)')&&jobs.includes("aa.map(a=>"),'Jobs Provider column renders every assignment for each Job');
ok(jobs.includes('assignmentProviderName(a)')&&jobs.includes("${badge(a.status)}"),'Every Provider row includes the current individual assignment status');
ok(jobs.includes("a.is_primary?' <em>Primary</em>':''"),'Primary Provider remains visibly identified in the team list');
ok(css.includes('.provider-team-list{')&&css.includes('.provider-team-row{')&&css.includes('.provider-team-row .status-badge{'),'Provider team list has compact Administration-only presentation');
ok(/js\/admin-jobs\.js\?v=15\.8\.(?:3|[4-9]|\d{2,})/.test(html)&&/css\/style\.css\?v=15\.8\.(?:3|[4-9]|\d{2,})/.test(html),'Admin Jobs keeps STEP 15.8.3-or-newer cache-busting');
if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.8.3 Provider team column compatibility audit completed successfully.');
