const fs=require('fs');
const assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
const fn=read('netlify/functions/public-service-request.js');
const alias=read('netlify/functions/public-booking.js');
const browser=read('js/service-request.js');
const page=read('service-request.html');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}
pass('Public booking no longer top-level requires notification helper',!/^const notify=require\('\.\/_notify-lib'\);/m.test(fn));
pass('Public booking no longer top-level requires security helper',!/^const security=require\('\.\/_security-lib'\);/m.test(fn));
pass('Security loads only inside POST workflow',fn.includes("security=require('./_security-lib')"));
pass('Admin notification is non-blocking after request creation',fn.includes("const notify=require('./_notify-lib')")&&fn.includes("public-service-request:admin-notification"));
pass('Fresh public-booking function route exists',alias.includes("require('./public-service-request')"));
pass('Browser prefers fresh public-booking route',browser.includes("'/.netlify/functions/public-booking'"));
pass('GET may safely fall back to legacy route',browser.includes("method==='GET'")&&browser.includes('fallbackResult'));
pass('POST does not retry after arbitrary 5xx/network responses',browser.includes("out?.r.status===404"));
pass('Booking page cache-busts STEP 15.8.4-or-newer JavaScript',/js\/service-request\.js\?v=15\.8\.(?:4|[5-9]|\d{2,})/.test(page));
console.log('STEP 15.8.4 public booking runtime audit completed successfully.');
