-- STEP 3.1 — RUN THIS ONLY AFTER STEP3_1_CUSTOM_ADMIN_AUTH.sql
-- IMPORTANT: replace the password placeholder before Run.
-- The plaintext password is used only for this SQL call. PostgreSQL stores a
-- bcrypt hash in admin_portal_users, never the plaintext value.

DO $$
BEGIN
  IF 'REPLACE_WITH_A_STRONG_PASSWORD' = 'REPLACE_WITH_A_STRONG_PASSWORD' THEN
    RAISE EXCEPTION 'Edit this script and replace REPLACE_WITH_A_STRONG_PASSWORD before running it.';
  END IF;
END $$;

select public.admin_portal_upsert_user(
  'please.serviceinfo@gmail.com',
  'PLEASE Administrator',
  'REPLACE_WITH_A_STRONG_PASSWORD',
  'PLEASE_ADMIN'
) as admin_portal_user_id;
