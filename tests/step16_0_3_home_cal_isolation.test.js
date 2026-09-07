const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
let failed=false;
const ok=(cond,msg)=>{console.log(`${cond?'PASS':'FAIL'}: ${msg}`);if(!cond)failed=true;};

const home=read('index.html');
const netlify=read('netlify.toml');

ok(home.includes('<title>PLEASE Services | Any Service in One Place | Calgary</title>'),'Root index is the PLEASE public Home');
ok(home.includes('Need help?<br>Just PLEASE.'),'PLEASE hero is restored');
ok(home.includes('service-request.html?mode=book')&&home.includes('BOOK YOUR SERVICE'),'Home BOOK YOUR SERVICE CTA is restored');
ok(home.includes('GET A FREE QUOTE')&&home.includes('please-quote'),'Home quote CTA and Netlify quote form are restored');
ok(!/CAL 1\.5|Canadian Accounting by Lottus/.test(home),'CAL content does not replace the public Home');

const calPages=['accounts','audit','banking','dashboard','disclaimer','documents','expenses','index','invoices','journal','reports','settings','taxes'];
for(const page of calPages) ok(exists(`cal/${page}.html`),`CAL ${page}.html remains under /cal`);
for(const page of calPages.filter(x=>x!=='index')) ok(!exists(`${page}.html`),`Legacy root CAL ${page}.html is removed`);

for(const page of calPages.filter(x=>x!=='index')) {
  ok(netlify.includes(`from = "/${page}.html"`)&&netlify.includes(`to = "/cal/${page}.html"`),`Legacy ${page}.html redirects into /cal`);
}
ok(netlify.includes('from = "/cal"')&&netlify.includes('to = "/cal/dashboard.html"'),'Canonical /cal route remains active');

for(const icon of ['favicon-16.png','favicon-32.png','favicon-48.png','apple-touch-icon.png']) ok(exists(`images/${icon}`),`${icon} exists under /images`);
ok(exists('favicon.ico'),'Root favicon.ico remains available');
ok(!exists('style.css')&&!exists('app.js')&&!exists('logo.svg')&&!exists('supabase-config.js'),'Accidental root CAL frontend support files are removed');

ok(!exists('agenda.html')&&!exists('agenda-admin.html'),'Broken root agenda copies are removed');
ok(netlify.includes('to = "/modules/agenda/agenda.html"')&&netlify.includes('to = "/modules/agenda/agenda-admin.html"'),'Legacy agenda routes redirect to canonical module pages');

if(failed) process.exit(1);
console.log('STEP 16.0.3 PLEASE Home restoration / CAL isolation audit completed successfully.');
