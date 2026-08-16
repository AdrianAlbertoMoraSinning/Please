begin;

-- ============================================================
-- STEP 3 — PLEASE ADMIN PORTAL HARDENING
-- Protect application workflow so status / activation cannot be
-- changed directly from the browser. Status changes stay behind
-- the SECURITY DEFINER RPC functions created in Step 2.2.D.
-- ============================================================

-- Authenticated clients may no longer issue arbitrary UPDATEs on
-- provider_applications. The only browser-editable column is
-- internal_notes; RLS still restricts the row to authorized users.
revoke update on public.provider_applications from authenticated;
grant update (internal_notes) on public.provider_applications to authenticated;

-- Explicit helper used by the admin UI to save notes. It validates
-- PLEASE_ADMIN and prevents clients from touching workflow fields.
create or replace function public.please_update_application_notes(
  p_application_id uuid,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_please_admin() then
    raise exception 'Unauthorized';
  end if;

  if not exists (
    select 1 from public.provider_applications where id = p_application_id
  ) then
    raise exception 'Application not found';
  end if;

  update public.provider_applications
  set internal_notes = nullif(trim(coalesce(p_notes,'')), '')
  where id = p_application_id;
end;
$$;

revoke all on function public.please_update_application_notes(uuid,text) from public;
grant execute on function public.please_update_application_notes(uuid,text) to authenticated;

commit;
