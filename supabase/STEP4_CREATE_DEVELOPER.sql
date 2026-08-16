-- Run manually in Supabase SQL Editor after STEP4_DEVELOPER_PORTAL.sql.
-- Replace the placeholder password before running. Do NOT commit a real password.
select public.admin_portal_upsert_user(
  'adrian.alberto.mora.sinning@gmail.com',
  'Portal Developer Administrator',
  'REPLACE_WITH_A_STRONG_PASSWORD',
  'DEVELOPER_ADMIN'
) as developer_portal_user_id;
