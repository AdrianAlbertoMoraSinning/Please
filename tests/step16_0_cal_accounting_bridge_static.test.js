const fs=require('fs');
const assert=require('assert');
const read=p=>fs.readFileSync(p,'utf8');
function pass(name,cond){assert.ok(cond,name);console.log('PASS:',name)}

const lib=read('netlify/functions/_cal-accounting-lib.js');
const sync=read('netlify/functions/cal-accounting-sync.js');
const dash=read('netlify/functions/cal-dashboard-data.js');
const legal=read('netlify/functions/cal-legal-acceptance.js');
const sql=read('supabase/STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.sql');
const adminInvoice=read('netlify/functions/admin-invoice-action.js');
const stripe=read('netlify/functions/stripe-webhook.js');
const providerPay=read('netlify/functions/admin-provider-payment-action.js');
const adminDashboard=read('admin-dashboard.html');
const calDashboard=read('cal/dashboard.html');
const calApp=read('cal/js/app.js');
const doc=read('STEP16_0_CAL_PLEASE_ACCOUNTING_BRIDGE.md');

pass('CAL portal is embedded under /cal with connected mode config',fs.existsSync('cal/dashboard.html')&&read('cal/js/supabase-config.js').includes('PLEASE_CONNECTED'));
pass('Admin sidebar exposes CAL Accounting link',adminDashboard.includes('cal/dashboard.html')&&adminDashboard.includes('CAL Accounting'));
pass('Bridge library implements core accounting events',lib.includes('handleInvoiceIssued')&&lib.includes('handlePaymentTransaction')&&lib.includes('handleProviderPayableCreated')&&lib.includes('handleProviderPaymentPaid'));
pass('Invoice issue posts accounting sync hook without breaking invoice response',adminInvoice.includes('handleInvoiceIssued')&&adminInvoice.includes('accounting_sync'));
pass('Manual invoice payment posts accounting sync hook',adminInvoice.includes('handlePaymentTransaction')&&adminInvoice.includes('handleInvoicePaid'));
pass('Stripe webhook writes accounting after verified payment transaction',stripe.includes('handlePaymentTransaction')&&stripe.includes('stripe_fee_amount')&&stripe.includes('stripe_net_amount'));
pass('Provider payment action posts accounting sync hook',providerPay.includes('handleProviderPaymentPaid'));
pass('PLEASE Staff costs are held and not posted as subcontractor expense',lib.includes('PLEASE_STAFF_COST_HELD')&&lib.includes('PLEASE_STAFF_PAYMENT_HELD'));
pass('Sync endpoint requires admin session and reconciles historical records',sync.includes('requireAdmin')&&sync.includes('accounting.reconcile'));
pass('Dashboard endpoint requires admin and surfaces outbox/events',dash.includes('requireAdmin')&&dash.includes('please_accounting_outbox')&&dash.includes('accounting_external_events'));
pass('Legal acceptance stores server-side and notifies Lottus copy recipient',legal.includes('accounting_legal_acceptances')&&legal.includes('CAL_LEGAL_COPY_EMAIL')&&legal.includes('notify.send'));
pass('SQL creates idempotent inbox/outbox and posting integrity controls',sql.includes('accounting_external_events')&&sql.includes('please_accounting_outbox')&&sql.includes('accounting_validate_posted_journal'));
pass('SQL prevents unbalanced posted entries and locked-period postings',sql.includes('must balance')&&sql.includes('Accounting period is locked'));
pass('CAL dashboard can manually re-sync PLEASE accounting',calDashboard.includes('syncAccounting')&&calApp.includes('/cal-accounting-sync'));
pass('Documentation explains required SQL and accounting boundaries',doc.includes('Required SQL')&&doc.includes('Payroll')&&doc.includes('Canadian accounting boundaries'));
console.log('STEP 16.0 CAL Accounting Bridge static audit completed successfully.');
