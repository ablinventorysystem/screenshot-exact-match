-- Form Templates (.docx mail-merge) and PO approval setting
-- Idempotent migration

alter table public.companies
  add column if not exists require_po_approval boolean not null default true;

create table if not exists public.form_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  doc_type text not null check (doc_type in ('invoice', 'sales_receipt', 'purchase_order')),
  file_path text not null,
  file_name text not null,
  file_size int not null default 0,
  is_default boolean not null default false,
  recognized_fields text[] not null default '{}',
  unknown_fields text[] not null default '{}',
  has_lines_region boolean not null default false,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists form_templates_company_type on public.form_templates(company_id, doc_type);

alter table public.form_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'form_templates' and policyname = 'members read'
  ) then
    create policy "members read" on public.form_templates for select to authenticated
      using (public.is_company_member(company_id));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'form_templates' and policyname = 'writers insert'
  ) then
    create policy "writers insert" on public.form_templates for insert to authenticated
      with check (public.can_write(company_id));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'form_templates' and policyname = 'writers update'
  ) then
    create policy "writers update" on public.form_templates for update to authenticated
      using (public.can_write(company_id)) with check (public.can_write(company_id));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'form_templates' and policyname = 'writers delete'
  ) then
    create policy "writers delete" on public.form_templates for delete to authenticated
      using (public.can_write(company_id));
  end if;
end $$;
