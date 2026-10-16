begin;

-- Keep the installed availability rules (including any later overlap fixes).
-- Replace only the old blanket rejection of cross-date service periods.
-- The existing single-day function is called for each daily operating window.
-- The assignment still reserves the full overall period; no extra Job is made.
do $migration$
declare
  definition text;
  original_branch text := E'if v_date <> v_end_date then\n    return false;\n  end if;';
  replacement_branch text := $branch$
if v_date <> v_end_date then
    -- PLEASE_MULTI_DAY_V1: bounded daily operating windows, DST aware.
    if p_end - p_start > interval '31 days'
       or (p_end at time zone 'America/Edmonton')::time
          <= (p_start at time zone 'America/Edmonton')::time then
      return false;
    end if;
    while v_date <= v_end_date loop
      if not public.provider_is_available_for_window(
        p_provider_id,
        (v_date + (p_start at time zone 'America/Edmonton')::time) at time zone 'America/Edmonton',
        (v_date + (p_end at time zone 'America/Edmonton')::time) at time zone 'America/Edmonton'
      ) then
        return false;
      end if;
      v_date := v_date + 1;
    end loop;
    return true;
  end if;
$branch$;
begin
  select pg_get_functiondef('public.provider_is_available_for_window(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)
    into definition;
  -- Dashboard-installed functions may retain Windows line endings.
  definition := replace(definition, chr(13), '');
  if position('PLEASE_MULTI_DAY_V1' in definition) > 0 then return; end if;
  if position(original_branch in definition) = 0 then
    raise exception 'Availability function changed: review its live definition before applying this patch.';
  end if;
  execute replace(definition, original_branch, replacement_branch);
end;
$migration$;

-- Preserve the existing server-only execution boundary.
revoke all on function public.provider_is_available_for_window(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.provider_is_available_for_window(uuid,timestamptz,timestamptz) to service_role;

commit;
