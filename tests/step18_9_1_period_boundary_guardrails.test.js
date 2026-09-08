'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function pass(name,ok){if(!ok){console.error('FAIL',name);process.exitCode=1}else console.log('PASS',name)}
const sql=read('STEP18_9_1_PERIOD_BOUNDARY_GUARDRAILS.sql'),verify=read('STEP18_9_1_VERIFY.sql'),html=read('cal/period-close.html'),ui=read('cal/js/period-close.js'),api=read('netlify/functions/cal-period-close.js'),mirror=read('cal-period-close.js');
pass('Boundary hotfix is additive',sql.includes('add column if not exists boundary_type')&&!/\b(drop table|truncate table)\b/i.test(sql));
pass('Database prevents overlapping fiscal periods',sql.includes('accounting_fiscal_period_overlap_guard')&&sql.includes('trg_accounting_fiscal_period_overlap_guard')&&sql.includes('overlaps an existing fiscal period')&&sql.includes('overlaps an already locked accounting period'));
pass('Legacy prepare RPC remains safe',sql.includes('accounting_prepare_period_close_guarded')&&sql.includes('return public.accounting_prepare_period_close_guarded')&&sql.includes('p_actor_id,false,null'));
pass('Custom periods require explicit reason',sql.includes('Non-calendar-month periods require explicit custom-period confirmation.')&&sql.includes('Custom-period reason must be at least 10 characters.'));
pass('UI defaults to last completed month',ui.includes('previousMonthBounds')&&!ui.includes('Math.min(b.end,localToday())')&&html.includes('last fully completed calendar month'));
pass('UI separates monthly and custom boundaries',html.includes('Standard monthly close')&&html.includes('Custom fiscal period')&&html.includes('custom_confirmation')&&html.includes('Boundary reason / evidence'));
pass('API requires custom confirmation for partial periods',api.includes('Partial/custom fiscal periods require explicit confirmation.')&&api.includes("rpc('accounting_prepare_period_close_guarded'"));
pass('API mirrors are identical',api===mirror);
pass('SQL mirrors are identical',sql===read('supabase/STEP18_9_1_PERIOD_BOUNDARY_GUARDRAILS.sql')&&sql===read('cal/supabase/STEP18_9_1_PERIOD_BOUNDARY_GUARDRAILS.sql'));
pass('Verification contains 14 controls',verify.includes("select 14,'period_close_tables_intact'")&&(verify.match(/union all/g)||[]).length===13);
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.9.1 Period Boundary Guardrails static audit completed successfully.');
