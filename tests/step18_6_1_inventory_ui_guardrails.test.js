'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function pass(name,ok){if(!ok){console.error('FAIL',name);process.exitCode=1}else console.log('PASS',name)}
const html=read('cal/inventory.html'),js=read('cal/js/inventory.js'),api=read('netlify/functions/cal-inventory.js'),sql=read('STEP18_6_INVENTORY_ACCOUNTING.sql');
pass('Adjustment direction uses an explicit modal instead of ambiguous browser confirm',html.includes('id="adjustmentTypeModal"')&&html.includes('Adjustment Gain')&&html.includes('Adjustment Loss')&&js.includes("open('adjustmentTypeModal')")&&!js.includes("OK = Adjustment GAIN"));
pass('Inventory date defaults use browser-local calendar date instead of UTC ISO rollover',js.includes('d.getFullYear()')&&js.includes('d.getMonth()+1')&&js.includes('d.getDate()')&&!js.includes("new Date().toISOString().slice(0,10)"));
pass('Transfer UI requires at least two active locations and excludes origin from destination',js.includes('active.length<2')&&js.includes('Create a second active inventory location')&&js.includes('locationOptions(current,from.value)'));
pass('Transfer submit also blocks identical origin/destination in UI',js.includes('Transfer origin and destination must be different locations.'));
pass('Database remains the final transfer safety control',sql.includes("Transfer locations must be different."));
pass('No accounting backend or STEP 17 behavior changed for this UI hotfix',api.includes("action==='TRANSFER'")&&api.includes("action==='POST_COUNT'")&&api.includes("action==='ADJUSTMENT_GAIN'"));
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.6.1 Inventory UI guardrails audit completed successfully.');
