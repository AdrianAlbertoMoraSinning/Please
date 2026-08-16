begin;

-- Private Storage bucket for Work With Us supporting documents.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'provider-applications',
  'provider-applications',
  false,
  4194304,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No public browser upload policy is created. Uploads go through the
-- Netlify server-side function using the Supabase secret key.

-- Authorized portal users may read private objects. The bucket remains private,
-- so a file is never exposed by a public URL.
drop policy if exists "please admin provider application objects read" on storage.objects;
create policy "please admin provider application objects read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'provider-applications'
  and public.is_please_admin()
);

drop policy if exists "developer provider application objects read" on storage.objects;
create policy "developer provider application objects read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'provider-applications'
  and public.is_developer()
);

commit;
