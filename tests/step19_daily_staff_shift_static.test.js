'use strict';
const fs=require('fs'),path=require('path');const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const assert=require('node:assert/strict'),test=require('node:test');
const provider=read('js/provider.js'),lib=read('netlify/functions/_provider-evidence-lib.js'),sql=read('STEP19_OPERATIONAL_FINANCE_AUTOMATION.sql'),html=read('provider.html');
test('PLEASE Staff uses one daily Check In and one daily Check Out',()=>{assert.match(provider,/dailyCheckInTarget/);assert.match(provider,/isLastStaffService/);assert.match(provider,/DAILY CHECK IN/);assert.match(provider,/DAILY CHECK OUT/);assert.match(provider,/No Check Out is required here/);assert.match(html,/one Daily Check In/i);assert.match(html,/final service of the day/i)});
test('server readiness enforces first-service and last-service boundaries',()=>{for(const code of ['FIRST_SERVICE_REQUIRED','LAST_SERVICE_REQUIRED','DAY_STILL_ACTIVE','CHECK_IN_REQUIRED'])assert.ok(lib.includes(code),code);assert.ok(lib.includes("TZ='America/Edmonton'"));assert.match(lib,/daily\('CHECKED_IN'\)/)});
test('database live-action migration also enforces daily shift',()=>{assert.match(sql,/provider_live_service_action/);assert.match(sql,/CHECKED_IN/);assert.match(sql,/CHECKED_OUT/);assert.match(sql,/first confirmed/i);assert.match(sql,/final scheduled/i)});
test('Independent Provider workflow remains separate',()=>{assert.match(provider,/worker_type==='PLEASE_STAFF'/);assert.match(provider,/!isPleaseStaff\(\)/);assert.match(lib,/INDEPENDENT_PROVIDER|PLEASE_STAFF/)});
