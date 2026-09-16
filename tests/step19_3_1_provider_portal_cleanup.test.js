'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('DECLINED and CANCELLED assignments are suppressed from every provider-facing service list',()=>{
  const js=read('js/provider.js');
  assert.match(js,/function portalVisibleAssignments\(\).*DECLINED.*CANCELLED/);
  assert.match(js,/function stats\(\)\{const as=portalVisibleAssignments\(\)/);
  assert.match(js,/function renderCalendar\(\).*portalVisibleAssignments\(\)/s);
  assert.match(js,/function renderOverview\(\).*portalVisibleAssignments\(\)/s);
  assert.match(js,/function renderAssignments\(\).*portalVisibleAssignments\(\)/s);
  assert.match(js,/function renderHistory\(\).*portalVisibleAssignments\(\)/s);
  assert.match(js,/function exportCsv\(\).*portalVisibleAssignments\(\)/s);
});

test('provider dashboard does not return removed or declined assignment payloads',()=>{
  const fn=read('netlify/functions/provider-dashboard.js');
  assert.match(fn,/portalAssignmentsRaw=.*DECLINED.*CANCELLED/);
  assert.match(fn,/portalAssignmentIds/);
  assert.match(fn,/visibleChangeRequests/);
  assert.match(fn,/visibleExtensions/);
  assert.match(fn,/visibleServiceEvents/);
  assert.match(fn,/return lib\.json\(200,\{[^}]*assignments,/s);
});

test('Provider Portal copy and cache are aligned with the cleanup behavior',()=>{
  const html=read('provider.html'),sw=read('service-worker.js');
  assert.match(html,/Declined or cancelled assignments are retained only in PLEASE Administration audit history/);
  assert.match(html,/no longer appear anywhere in your Provider Portal/);
  assert.doesNotMatch(html,/stay in Service History/);
  assert.match(html,/js\/provider\.js\?v=19\.3\.1/);
  assert.match(sw,/please-provider-v21/);
});
