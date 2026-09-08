'use strict';
const fs=require('fs'),path=require('path');const root=path.join(__dirname,'..');const sql=fs.readFileSync(path.join(root,'STEP18_10_ACCOUNTANT_COMPLIANCE_CENTER.sql'),'utf8');function pass(n,x){if(!x){console.error('FAIL',n);process.exitCode=1}else console.log('PASS',n)}
pass('GIFI realized gain/loss included in revenue-side total',sql.includes("account_type='REVENUE' or coalesce(gifi_code,'')='8210'"));
pass('Accumulated amortization remains negative in asset total',sql.includes("('1510','1741',1")&&sql.includes("when upper(p_account_type)='ASSET' then l.debit-l.credit"));
pass('Package includes detailed General Ledger',sql.includes("'general_ledger',v_ledger")&&sql.includes('j.entry_number')&&sql.includes('l.debit')&&sql.includes('l.credit'));
pass('Package includes source subledgers',sql.includes("'accounts_receivable_open',v_ar")&&sql.includes("'accounts_payable_open',v_ap")&&sql.includes("'inventory_detail_as_of',v_inventory_detail")&&sql.includes("'fixed_asset_register',v_assets")&&sql.includes("'payroll_runs',v_payroll"));
pass('Package approval depends on closed periods and reconciliation',sql.includes('accounting_closed_coverage_days(p.period_start,p.period_end)')&&sql.includes("snapshot_json#>>'{inventory_reconciliation,difference}'")&&sql.includes("snapshot_json#>>'{fixed_assets_reconciliation,gross_difference}'"));
pass('No direct tax transmission implementation',!sql.includes('accounting_enqueue_event(')&&!sql.includes('http_post(')&&!sql.includes('net.http_'));
if(process.exitCode)process.exit(process.exitCode);console.log('STEP 18.10 ACCOUNTANT PACKAGE INTEGRITY PASS');
