# PLEASE Portal — Step 2.4 Private Application Uploads

## What this step adds

- Optional Certification upload (1 file)
- Optional Insurance upload (1 file)
- Optional Portfolio / work photos (up to 5 files)
- Accepted formats: PDF, JPG/JPEG, PNG, WEBP
- Maximum size: 4 MB per file
- Private Supabase Storage bucket: `provider-applications`
- File metadata saved in `public.provider_application_files`
- Uploads pass through a Netlify Function; no Supabase secret key is exposed in browser code
- Only authenticated `PLEASE_ADMIN` and `DEVELOPER` roles receive read policies for the private Storage objects
- Fixes the `Describe Your Service` field so it appears only for `Other / More`

## 1. Supabase SQL

Run this file in Supabase SQL Editor:

`supabase/STEP2_4_PRIVATE_UPLOADS.sql`

Expected result: `Success. No rows returned`.

Then verify the bucket:

```sql
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'provider-applications';
```

Expected: `public = false`, `file_size_limit = 4194304`.

## 2. Netlify environment variables

In Netlify project `pleasewebportal` go to:

Project configuration → Environment variables

Create these variables:

- `PLEASE_SUPABASE_URL` = `https://jrukbqghdasbpkolrgkl.supabase.co`
- `PLEASE_SUPABASE_SECRET_KEY` = your Supabase `sb_secret_...` key

Get the secret key from Supabase → Settings → API Keys → Secret keys.

IMPORTANT:
- Do not put `PLEASE_SUPABASE_SECRET_KEY` in GitHub.
- Do not put it in `supabase-config.js`.
- Do not send or publish the key.

After adding the variables, trigger a new production deploy in Netlify.

## 3. Deploy repository contents

Upload/commit this package to the existing GitHub `Please` repository. Netlify should deploy automatically from `main`.

The function will be available at:

`/.netlify/functions/provider-application-upload`

## 4. Live test

Open:

`https://pleasewebportal.netlify.app/work-with-us.html`

Submit a NEW application with one small PDF or image. The success screen should show the application reference and confirm the supporting document upload.

Verify metadata:

```sql
select application_id, file_type, file_name, storage_path, mime_type, file_size_bytes, created_at
from public.provider_application_files
order by created_at desc
limit 10;
```

Verify the object exists in Supabase Storage → `provider-applications`.

The bucket must show as PRIVATE.

## Security notes

- The browser uses only the Supabase publishable key.
- Binary files are sent same-origin to a Netlify Function.
- The Netlify Function validates application UUID + public reference + applicant email, application status, file category, size, MIME type and basic file signature.
- The server uses the Supabase secret key only from Netlify environment variables.
- The applicant gets no public Storage URL.
- Direct anonymous Storage INSERT policies are intentionally not created.
