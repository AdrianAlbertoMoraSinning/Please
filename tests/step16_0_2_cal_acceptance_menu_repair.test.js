const fs=require('fs');
const assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}

const calApp=read('cal/js/app.js');
pass('CAL app hides raw Netlify 404 HTML from agreement alert',calApp.includes('CAL backend function is not deployed yet')&&calApp.includes('calEndpointError')&&!calApp.includes('j={error:t}'));
pass('CAL legal acceptance calls the correct Netlify function path',calApp.includes("/cal-legal-acceptance")&&fs.existsSync('netlify/functions/cal-legal-acceptance.js'));
pass('CAL backend bundle functions are present',fs.existsSync('netlify/functions/cal-dashboard-data.js')&&fs.existsSync('netlify/functions/cal-accounting-sync.js')&&fs.existsSync('netlify/functions/_cal-accounting-lib.js'));
const adminPages=fs.readdirSync('.').filter(f=>/^admin.*\.html$/.test(f)&&!['admin-login.html','admin-password.html'].includes(f));
for(const page of adminPages){
  const html=read(page);
  if(html.includes('admin-sidebar')){
    pass(page+' includes CAL Accounting in sidebar',html.includes('cal/dashboard.html')&&html.includes('CAL Accounting'));
  }
}
pass('Service Maintenance specifically includes CAL Accounting',read('admin-service-maintenance.html').includes('<a href="cal/dashboard.html">CAL Accounting</a>'));
console.log('STEP 16.0.2 CAL acceptance/menu repair static audit completed successfully.');
