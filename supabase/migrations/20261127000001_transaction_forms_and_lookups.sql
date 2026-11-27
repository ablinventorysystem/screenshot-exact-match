-- Transaction Forms, Lookup Tables, and Extended Fields
-- Idempotent migration: safe to run multiple times.

-- 1. Lookup tables
create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  days int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.ship_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);

create table if not exists public.predefined_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique(company_id, title)
);

create table if not exists public.party_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  party_type text not null check (party_type in ('customer', 'vendor')),
  party_id uuid not null,
  label text not null default 'Default',
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  country text default 'Philippines',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists party_addresses_party on public.party_addresses(company_id, party_type, party_id);

-- 2. Extend transactions table
alter table public.transactions
  add column if not exists terms_id uuid references public.terms(id) on delete set null,
  add column if not exists sales_rep_id uuid references public.sales_reps(id) on delete set null,
  add column if not exists ship_method_id uuid references public.ship_methods(id) on delete set null,
  add column if not exists channel_id uuid references public.channels(id) on delete set null,
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists customer_po text,
  add column if not exists tracking_no text,
  add column if not exists ship_date date,
  add column if not exists due_date date,
  add column if not exists deposit_amount numeric(18,2) not null default 0,
  add column if not exists deposit_pct numeric(7,4) not null default 0,
  add column if not exists customer_message text,
  add column if not exists comment text,
  add column if not exists customer_notes text,
  add column if not exists vendor_notes text,
  add column if not exists drop_ship boolean not null default false,
  add column if not exists blanket_po boolean not null default false,
  add column if not exists approved boolean not null default false,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists vendor_confirmed boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists closed boolean not null default false,
  add column if not exists balance numeric(18,2) not null default 0,
  add column if not exists signature text,
  add column if not exists billing_address text,
  add column if not exists shipping_address text,
  add column if not exists price_tier text default 'List Price',
  add column if not exists ewt_amount numeric(18,2) not null default 0,
  add column if not exists ewt_atc text,
  add column if not exists shipping_tax_code text default '12% S',
  add column if not exists shipping_tax_pct numeric(7,4) not null default 12;

-- 3. Extend transaction_lines table
alter table public.transaction_lines
  add column if not exists part_no text,
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists tax_code text default '12% S',
  add column if not exists due_date date,
  add column if not exists qty_picked numeric(18,6) not null default 0,
  add column if not exists qty_shipped numeric(18,6) not null default 0,
  add column if not exists qty_invoiced numeric(18,6) not null default 0,
  add column if not exists qty_received numeric(18,6) not null default 0;

-- 4. RLS policies for new tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'terms',
    'sales_reps',
    'ship_methods',
    'channels',
    'departments',
    'classes',
    'predefined_messages',
    'party_addresses'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members read'
    ) then
      execute format('create policy "members read" on public.%I for select to authenticated using (public.is_company_member(company_id))', t);
    end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'writers insert'
    ) then
      execute format('create policy "writers insert" on public.%I for insert to authenticated with check (public.can_write(company_id))', t);
    end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'writers update'
    ) then
      execute format('create policy "writers update" on public.%I for update to authenticated using (public.can_write(company_id)) with check (public.can_write(company_id))', t);
    end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'writers delete'
    ) then
      execute format('create policy "writers delete" on public.%I for delete to authenticated using (public.can_write(company_id))', t);
    end if;
  end loop;
end $$;

-- 5. Seed default lookup values for every existing company
do $$
declare
  c record;
begin
  for c in select id from public.companies loop
    insert into public.terms (company_id, name, days, is_default) values
      (c.id, 'COD', 0, false),
      (c.id, 'Due on receipt', 0, false),
      (c.id, 'Net 15', 15, false),
      (c.id, 'Net 30', 30, true),
      (c.id, 'Net 60', 60, false)
    on conflict (company_id, name) do nothing;

    insert into public.sales_reps (company_id, name) values
      (c.id, 'Office Sales'),
      (c.id, 'Michael White')
    on conflict (company_id, name) do nothing;

    insert into public.ship_methods (company_id, name) values
      (c.id, 'Pickup'),
      (c.id, 'LBC'),
      (c.id, 'J&T'),
      (c.id, 'JRS'),
      (c.id, '2GO'),
      (c.id, 'Own delivery')
    on conflict (company_id, name) do nothing;

    insert into public.channels (company_id, name) values
      (c.id, 'Direct'),
      (c.id, 'Online'),
      (c.id, 'Wholesale'),
      (c.id, 'Retail')
    on conflict (company_id, name) do nothing;

    insert into public.departments (company_id, name) values
      (c.id, 'Sales'),
      (c.id, 'Operations'),
      (c.id, 'Warehouse'),
      (c.id, 'Admin')
    on conflict (company_id, name) do nothing;

    insert into public.classes (company_id, name) values
      (c.id, 'General'),
      (c.id, 'Retail'),
      (c.id, 'Wholesale'),
      (c.id, 'Project')
    on conflict (company_id, name) do nothing;

    insert into public.predefined_messages (company_id, title, body) values
      (c.id, 'Standard Thank You', 'Thank you for your business!'),
      (c.id, 'Payment Reminder', 'Please remit payment within the agreed terms.')
    on conflict (company_id, title) do nothing;
  end loop;
end $$;
