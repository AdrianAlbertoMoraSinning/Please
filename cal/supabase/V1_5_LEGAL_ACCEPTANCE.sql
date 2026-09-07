-- CAL 1.5 legal acceptance migration
-- Run inside EACH CLIENT'S OWN Supabase project. Do not run against a shared multi-client accounting database.

create table if not exists accounting_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references accounting_portal_users(id),
  agreement_version text not null,
  agreement_effective_date date not null,
  legal_company_name text not null,
  signer_name text not null,
  signer_title text not null,
  signer_email text not null,
  signature_text text not null,
  acceptance_method text not null check(acceptance_method in ('ELECTRONIC_SIGNATURE','PHYSICAL_COPY_ON_FILE')),
  accepted_at timestamptz not null default now(),
  signed_document_storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  unique(user_id, agreement_version)
);

create index if not exists accounting_legal_acceptances_version_idx
  on accounting_legal_acceptances(agreement_version, accepted_at);

alter table accounting_legal_acceptances enable row level security;
revoke all on table accounting_legal_acceptances from anon, authenticated;

comment on table accounting_legal_acceptances is
'Customer-owned evidence that a CAL user accepted a specific legal agreement version. Production writes must occur through authorized server-side functions.';
