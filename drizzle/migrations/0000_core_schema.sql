
create type public.app_role as enum ('admin','sales','warehouse','accounting','read_only');
create type public.txn_type as enum ('estimate','sales_order','invoice','sales_receipt','purchase_order','receipt','bill','shipment','pick_ticket','return','rma','transfer','work_order','build','payment','adjustment');
create type public.item_type as enum ('inventory','non_inventory','assembly','service');
create type public.tracking_type as enum ('none','lot','serial');
create type public.party_tax_type as enum ('vatable','vat_exempt','zero_rated','government');
create type public.tax_kind as enum ('vat','exempt','zero_rated','percentage');
create type public.discount_kind as enum ('none','regular','senior','pwd');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  tin text,
  rdo_code text,
  registered_address text,
  zip_code text,
  vat_registered boolean not null default true,
  default_vat_rate numeric(6,3) not null default 12,
  percentage_tax_rate numeric(6,3) not null default 3,
  price_mode text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  atp_no text,
  atp_date_issued date,
  invoice_series_start integer,
  invoice_series_end integer,
  invoice_series_next integer,
  atp_warning_threshold integer not null default 100,
  printer_name text,
  printer_tin text,
  printer_accreditation_no text,
  printer_accreditation_date date,
  fiscal_year_start_month integer not null default 1 check (fiscal_year_start_month between 1 and 12),
  last_sync_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'read_only',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text,
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tax_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  kind public.tax_kind not null,
  rate numeric(6,3) not null default 0,
  applies_to text not null default 'both' check (applies_to in ('sales','purchases','both')),
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.atc_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  description text not null,
  rate numeric(6,3) not null default 0,
  applies_to text not null default 'both' check (applies_to in ('sales','purchases','both')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  registered_name text,
  tin text,
  branch_code text,
  registered_address text,
  tax_type public.party_tax_type not null default 'vatable',
  withholding_agent boolean not null default false,
  default_atc text,
  sc_pwd_id text,
  contact_name text,
  email text,
  phone text,
  terms text,
  credit_limit numeric(18,2),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  registered_name text,
  tin text,
  branch_code text,
  registered_address text,
  tax_type public.party_tax_type not null default 'vatable',
  withholding_agent boolean not null default false,
  default_atc text,
  contact_name text,
  email text,
  phone text,
  terms text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null,
  name text not null,
  description text,
  category text,
  type public.item_type not null default 'inventory',
  cost numeric(18,4) not null default 0,
  price numeric(18,4) not null default 0,
  tracking public.tracking_type not null default 'none',
  uom text not null default 'pc',
  decimals_allowed integer not null default 0 check (decimals_allowed between 0 and 6),
  barcode text,
  reorder_point numeric(18,6),
  tax_code_id uuid references public.tax_codes(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, sku)
);

create table public.item_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  lot_no text not null,
  received_date date,
  expiry_date date,
  created_at timestamptz not null default now()
);

create table public.item_serials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  serial_no text not null,
  location_id uuid references public.locations(id) on delete set null,
  status text not null default 'in_stock',
  created_at timestamptz not null default now()
);

create table public.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  lot_id uuid references public.item_lots(id) on delete cascade,
  qty numeric(18,6) not null default 0,
  unique nulls not distinct (item_id, location_id, lot_id)
);

create table public.doc_sequences (
  company_id uuid not null references public.companies(id) on delete cascade,
  txn_type public.txn_type not null,
  prefix text not null,
  next_no integer not null default 1,
  padding integer not null default 6,
  primary key (company_id, txn_type)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type public.txn_type not null,
  ref_no text not null,
  bir_series_no integer,
  status text not null default 'open',
  txn_date date not null default current_date,
  due_date date,
  party_type text check (party_type in ('customer','vendor')),
  party_id uuid,
  party_name text,
  location_id uuid references public.locations(id) on delete set null,
  to_location_id uuid references public.locations(id) on delete set null,
  parent_txn_id uuid references public.transactions(id) on delete set null,
  price_mode text not null default 'exclusive' check (price_mode in ('exclusive','inclusive')),
  vatable_sales numeric(18,2) not null default 0,
  vat_exempt_sales numeric(18,2) not null default 0,
  zero_rated_sales numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  percentage_tax_amount numeric(18,2) not null default 0,
  discount_type public.discount_kind not null default 'none',
  discount_rate numeric(6,3) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  sc_pwd_id text,
  ewt_atc text,
  ewt_rate numeric(6,3) not null default 0,
  ewt_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  amount_due numeric(18,2) not null default 0,
  notes text,
  voided boolean not null default false,
  archived boolean not null default false,
  qb_sync_status text not null default 'pending' check (qb_sync_status in ('pending','sent','error','na')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, type, ref_no)
);
create unique index transactions_bir_series_uniq on public.transactions(company_id, bir_series_no) where bir_series_no is not null;
create index transactions_company_type_date on public.transactions(company_id, type, txn_date desc);

create table public.transaction_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  line_no integer not null default 1,
  item_id uuid references public.items(id) on delete set null,
  description text,
  qty numeric(18,6) not null default 0,
  qty_fulfilled numeric(18,6) not null default 0,
  qty_invoiced numeric(18,6) not null default 0,
  rate numeric(18,6) not null default 0,
  amount numeric(18,2) not null default 0,
  tax_code_id uuid references public.tax_codes(id) on delete set null,
  vat_amount numeric(18,2) not null default 0,
  lot_id uuid references public.item_lots(id) on delete set null,
  serial_id uuid references public.item_serials(id) on delete set null
);
create index transaction_lines_txn on public.transaction_lines(transaction_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,
  user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  data jsonb,
  changed_at timestamptz not null default now()
);
create index audit_log_company on public.audit_log(company_id, changed_at desc);

create index customers_company on public.customers(company_id, name);
create index vendors_company on public.vendors(company_id, name);
create index items_company on public.items(company_id, name);
create index inventory_levels_item on public.inventory_levels(item_id);

grant select, insert, update, delete on public.companies, public.profiles, public.company_members, public.locations, public.tax_codes, public.atc_codes, public.customers, public.vendors, public.items, public.item_lots, public.item_serials, public.inventory_levels, public.doc_sequences, public.transactions, public.transaction_lines to authenticated;
grant select on public.audit_log to authenticated;
grant all on public.companies, public.profiles, public.company_members, public.locations, public.tax_codes, public.atc_codes, public.customers, public.vendors, public.items, public.item_lots, public.item_serials, public.inventory_levels, public.doc_sequences, public.transactions, public.transaction_lines, public.audit_log to service_role;

create or replace function public.is_company_member(_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members where company_id = _company and user_id = auth.uid())
$$;

create or replace function public.has_company_role(_company uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members where company_id = _company and user_id = auth.uid() and role = any(_roles))
$$;

create or replace function public.can_write(_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_company_role(_company, array['admin','sales','warehouse','accounting']::public.app_role[])
$$;

create or replace function public.can_manage_tax(_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_company_role(_company, array['admin','accounting']::public.app_role[])
$$;

create or replace function public.default_prefix(_type public.txn_type)
returns text language sql immutable set search_path = public as $$
  select case _type
    when 'estimate' then 'EST-' when 'sales_order' then 'SO-' when 'invoice' then 'SI-'
    when 'sales_receipt' then 'SR-' when 'purchase_order' then 'PO-' when 'receipt' then 'RCV-'
    when 'bill' then 'BILL-' when 'shipment' then 'SH-' when 'pick_ticket' then 'PT-'
    when 'return' then 'RET-' when 'rma' then 'RMA-' when 'transfer' then 'TR-'
    when 'work_order' then 'WO-' when 'build' then 'BLD-' when 'payment' then 'CR-'
    when 'adjustment' then 'ADJ-' end
$$;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.locations enable row level security;
alter table public.tax_codes enable row level security;
alter table public.atc_codes enable row level security;
alter table public.customers enable row level security;
alter table public.vendors enable row level security;
alter table public.items enable row level security;
alter table public.item_lots enable row level security;
alter table public.item_serials enable row level security;
alter table public.inventory_levels enable row level security;
alter table public.doc_sequences enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_lines enable row level security;
alter table public.audit_log enable row level security;

create policy "members read company" on public.companies for select to authenticated using (public.is_company_member(id) or created_by = auth.uid());
create policy "users create company" on public.companies for insert to authenticated with check (created_by = auth.uid());
create policy "admins update company" on public.companies for update to authenticated using (public.can_manage_tax(id)) with check (public.can_manage_tax(id));

create policy "read own or co-member profiles" on public.profiles for select to authenticated using (
  id = auth.uid() or exists (select 1 from public.company_members m where m.user_id = profiles.id and public.is_company_member(m.company_id)));
create policy "insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read memberships" on public.company_members for select to authenticated using (public.is_company_member(company_id));
create policy "admins add members" on public.company_members for insert to authenticated with check (public.has_company_role(company_id, array['admin']::public.app_role[]));
create policy "admins update members" on public.company_members for update to authenticated using (public.has_company_role(company_id, array['admin']::public.app_role[]));
create policy "admins remove members" on public.company_members for delete to authenticated using (public.has_company_role(company_id, array['admin']::public.app_role[]));

do $$
declare t text;
begin
  foreach t in array array['locations','customers','vendors','items','item_lots','item_serials','inventory_levels','transaction_lines'] loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_company_member(company_id))', t);
    execute format('create policy "writers insert" on public.%I for insert to authenticated with check (public.can_write(company_id))', t);
    execute format('create policy "writers update" on public.%I for update to authenticated using (public.can_write(company_id)) with check (public.can_write(company_id))', t);
    execute format('create policy "writers delete" on public.%I for delete to authenticated using (public.can_write(company_id))', t);
  end loop;
  foreach t in array array['tax_codes','atc_codes','doc_sequences'] loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_company_member(company_id))', t);
    execute format('create policy "tax admins insert" on public.%I for insert to authenticated with check (public.can_manage_tax(company_id))', t);
    execute format('create policy "tax admins update" on public.%I for update to authenticated using (public.can_manage_tax(company_id)) with check (public.can_manage_tax(company_id))', t);
    execute format('create policy "tax admins delete" on public.%I for delete to authenticated using (public.can_manage_tax(company_id))', t);
  end loop;
end $$;

create policy "members read" on public.transactions for select to authenticated using (public.is_company_member(company_id));
create policy "writers insert" on public.transactions for insert to authenticated with check (public.can_write(company_id));
create policy "writers update" on public.transactions for update to authenticated using (public.can_write(company_id)) with check (public.can_write(company_id));
create policy "writers delete unnumbered" on public.transactions for delete to authenticated using (public.can_write(company_id) and bir_series_no is null);

create policy "members read audit" on public.audit_log for select to authenticated using (public.is_company_member(company_id));

create or replace function public.seed_company_defaults(_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tax_codes(company_id, code, name, kind, rate, applies_to, is_default) values
    (_company,'VAT12-S','VAT 12% (Output)','vat',12,'sales',true),
    (_company,'VAT12-P','VAT 12% (Input)','vat',12,'purchases',true),
    (_company,'EXEMPT','VAT-exempt','exempt',0,'both',false),
    (_company,'ZERO','Zero-rated','zero_rated',0,'both',false),
    (_company,'PT3','Non-VAT 3% percentage tax','percentage',3,'both',false)
  on conflict do nothing;
  insert into public.atc_codes(company_id, code, description, rate, applies_to) values
    (_company,'WC158','Purchase of goods by Top Withholding Agents - corporate',1,'both'),
    (_company,'WI158','Purchase of goods by Top Withholding Agents - individual',1,'both'),
    (_company,'WC160','Purchase of services by Top Withholding Agents - corporate',2,'both'),
    (_company,'WI160','Purchase of services by Top Withholding Agents - individual',2,'both'),
    (_company,'WI010','Professional fees - individual, gross income P3M and below',5,'both'),
    (_company,'WI011','Professional fees - individual, gross income above P3M',10,'both'),
    (_company,'WC010','Professional fees - corporate, gross income P720K and below',10,'both'),
    (_company,'WC011','Professional fees - corporate, gross income above P720K',15,'both'),
    (_company,'WC100','Rentals of real property - corporate',5,'both'),
    (_company,'WI100','Rentals of real property - individual',5,'both'),
    (_company,'WC120','Payments to contractors - corporate',2,'both'),
    (_company,'WI120','Payments to contractors - individual',2,'both'),
    (_company,'WC640','Government purchase of goods - corporate',1,'both'),
    (_company,'WC157','Government purchase of services - corporate',2,'both'),
    (_company,'WV010','Final VAT withheld by government - goods',5,'both'),
    (_company,'WV020','Final VAT withheld by government - services',5,'both')
  on conflict do nothing;
  insert into public.doc_sequences(company_id, txn_type, prefix, next_no, padding)
  select _company, t, public.default_prefix(t), 1, 6 from unnest(enum_range(null::public.txn_type)) as t
  on conflict do nothing;
end $$;

create or replace function public.handle_new_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.company_members(company_id, user_id, role) values (new.id, new.created_by, 'admin') on conflict do nothing;
  end if;
  perform public.seed_company_defaults(new.id);
  return new;
end $$;
create trigger on_company_created after insert on public.companies for each row execute function public.handle_new_company();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email)
  on conflict do nothing;
  insert into public.company_members(company_id, user_id, role)
  select id, new.id, 'admin' from public.companies where id = '00000000-0000-0000-0000-000000000001'
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.next_doc_number(_company uuid, _type public.txn_type)
returns text language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_no int; v_pad int;
begin
  if not public.can_write(_company) then raise exception 'Not allowed'; end if;
  insert into public.doc_sequences(company_id, txn_type, prefix, next_no, padding)
  values (_company, _type, public.default_prefix(_type), 1, 6) on conflict do nothing;
  update public.doc_sequences set next_no = next_no + 1
  where company_id = _company and txn_type = _type
  returning prefix, next_no - 1, padding into v_prefix, v_no, v_pad;
  return v_prefix || lpad(v_no::text, v_pad, '0');
end $$;

create or replace function public.save_transaction(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_company uuid := (p->>'company_id')::uuid;
  v_type public.txn_type := (p->>'type')::public.txn_type;
  v_ref text;
  v_bir int;
  v_co public.companies%rowtype;
  v_existing public.transactions%rowtype;
  l jsonb;
  i int := 0;
begin
  if not public.can_write(v_company) then raise exception 'You do not have permission to save transactions'; end if;

  if v_id is null then
    v_ref := public.next_doc_number(v_company, v_type);
    if v_type in ('invoice','sales_receipt') then
      select * into v_co from public.companies where id = v_company for update;
      if v_co.invoice_series_next is not null then
        if v_co.invoice_series_end is not null and v_co.invoice_series_next > v_co.invoice_series_end then
          raise exception 'BIR invoice series exhausted: ATP range ended at %. Register a new ATP series in Settings > Tax & BIR.', v_co.invoice_series_end;
        end if;
        v_bir := v_co.invoice_series_next;
        update public.companies set invoice_series_next = invoice_series_next + 1 where id = v_company;
      end if;
    end if;
    insert into public.transactions(company_id, type, ref_no, bir_series_no, status, txn_date, due_date, party_type, party_id, party_name,
      location_id, to_location_id, parent_txn_id, price_mode, vatable_sales, vat_exempt_sales, zero_rated_sales, vat_amount, percentage_tax_amount,
      discount_type, discount_rate, discount_amount, sc_pwd_id, ewt_atc, ewt_rate, ewt_amount, total, amount_due, notes, created_by)
    values (v_company, v_type, v_ref, v_bir, coalesce(p->>'status','open'), coalesce((p->>'txn_date')::date, current_date), nullif(p->>'due_date','')::date,
      nullif(p->>'party_type',''), nullif(p->>'party_id','')::uuid, nullif(p->>'party_name',''),
      nullif(p->>'location_id','')::uuid, nullif(p->>'to_location_id','')::uuid, nullif(p->>'parent_txn_id','')::uuid,
      coalesce(p->>'price_mode','exclusive'),
      coalesce((p->>'vatable_sales')::numeric,0), coalesce((p->>'vat_exempt_sales')::numeric,0), coalesce((p->>'zero_rated_sales')::numeric,0),
      coalesce((p->>'vat_amount')::numeric,0), coalesce((p->>'percentage_tax_amount')::numeric,0),
      coalesce((p->>'discount_type')::public.discount_kind,'none'), coalesce((p->>'discount_rate')::numeric,0), coalesce((p->>'discount_amount')::numeric,0),
      nullif(p->>'sc_pwd_id',''), nullif(p->>'ewt_atc',''), coalesce((p->>'ewt_rate')::numeric,0), coalesce((p->>'ewt_amount')::numeric,0),
      coalesce((p->>'total')::numeric,0), coalesce((p->>'amount_due')::numeric,0), nullif(p->>'notes',''), auth.uid())
    returning id into v_id;
  else
    select * into v_existing from public.transactions where id = v_id and company_id = v_company;
    if not found then raise exception 'Transaction not found'; end if;
    if v_existing.voided then raise exception 'Voided transactions cannot be edited'; end if;
    update public.transactions set
      status = coalesce(p->>'status', status),
      txn_date = coalesce((p->>'txn_date')::date, txn_date),
      due_date = nullif(p->>'due_date','')::date,
      party_type = nullif(p->>'party_type',''), party_id = nullif(p->>'party_id','')::uuid, party_name = nullif(p->>'party_name',''),
      location_id = nullif(p->>'location_id','')::uuid, to_location_id = nullif(p->>'to_location_id','')::uuid,
      price_mode = coalesce(p->>'price_mode', price_mode),
      vatable_sales = coalesce((p->>'vatable_sales')::numeric,0), vat_exempt_sales = coalesce((p->>'vat_exempt_sales')::numeric,0),
      zero_rated_sales = coalesce((p->>'zero_rated_sales')::numeric,0), vat_amount = coalesce((p->>'vat_amount')::numeric,0),
      percentage_tax_amount = coalesce((p->>'percentage_tax_amount')::numeric,0),
      discount_type = coalesce((p->>'discount_type')::public.discount_kind,'none'), discount_rate = coalesce((p->>'discount_rate')::numeric,0),
      discount_amount = coalesce((p->>'discount_amount')::numeric,0), sc_pwd_id = nullif(p->>'sc_pwd_id',''),
      ewt_atc = nullif(p->>'ewt_atc',''), ewt_rate = coalesce((p->>'ewt_rate')::numeric,0), ewt_amount = coalesce((p->>'ewt_amount')::numeric,0),
      total = coalesce((p->>'total')::numeric,0), amount_due = coalesce((p->>'amount_due')::numeric,0),
      notes = nullif(p->>'notes',''), qb_sync_status = 'pending', updated_at = now()
    where id = v_id;
    delete from public.transaction_lines where transaction_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    i := i + 1;
    insert into public.transaction_lines(company_id, transaction_id, line_no, item_id, description, qty, qty_fulfilled, qty_invoiced, rate, amount, tax_code_id, vat_amount, lot_id, serial_id)
    values (v_company, v_id, i, nullif(l->>'item_id','')::uuid, nullif(l->>'description',''),
      coalesce((l->>'qty')::numeric,0), coalesce((l->>'qty_fulfilled')::numeric,0), coalesce((l->>'qty_invoiced')::numeric,0),
      coalesce((l->>'rate')::numeric,0), coalesce((l->>'amount')::numeric,0), nullif(l->>'tax_code_id','')::uuid,
      coalesce((l->>'vat_amount')::numeric,0), nullif(l->>'lot_id','')::uuid, nullif(l->>'serial_id','')::uuid);
  end loop;
  return v_id;
end $$;

create or replace function public.void_transaction(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.transactions where id = _id;
  if v_company is null or not public.can_write(v_company) then raise exception 'Not allowed'; end if;
  update public.transactions set voided = true, status = 'void', vatable_sales = 0, vat_exempt_sales = 0, zero_rated_sales = 0,
    vat_amount = 0, percentage_tax_amount = 0, ewt_amount = 0, total = 0, amount_due = 0, qb_sync_status = 'pending', updated_at = now()
  where id = _id;
end $$;

create or replace function public.dashboard_stats(_company uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with m as (select date_trunc('month', current_date)::date as s, (date_trunc('month', current_date) + interval '1 month')::date as e),
  so_lines as (
    select l.*, it.type as item_type from public.transaction_lines l
    join public.transactions t on t.id = l.transaction_id
    left join public.items it on it.id = l.item_id
    where t.company_id = _company and t.type = 'sales_order' and t.status = 'open' and not t.voided
  )
  select jsonb_build_object(
    'last_sync_at', (select last_sync_at from public.companies where id = _company),
    'to_send', (select count(*) from public.transactions where company_id = _company and qb_sync_status = 'pending'),
    'sent', (select count(*) from public.transactions where company_id = _company and qb_sync_status = 'sent'),
    'pending_estimates', (select count(*) from public.transactions where company_id = _company and type = 'estimate' and status = 'pending' and not voided),
    'open_so_lines', (select count(*) from so_lines where qty_fulfilled < qty),
    'open_sales_receipts', (select count(*) from public.transactions where company_id = _company and type = 'sales_receipt' and status = 'open' and not voided),
    'lines_ready_to_ship', (select count(*) from so_lines sl where sl.qty_fulfilled < sl.qty and coalesce(sl.item_type,'inventory') = 'inventory'
        and coalesce((select sum(qty) from public.inventory_levels il where il.item_id = sl.item_id),0) >= sl.qty - sl.qty_fulfilled),
    'lines_ready_to_invoice', (select count(*) from so_lines where qty_fulfilled > qty_invoiced),
    'open_pos', (select count(*) from public.transactions where company_id = _company and type = 'purchase_order' and status = 'open' and not voided),
    'open_wos', (select count(*) from public.transactions where company_id = _company and type = 'work_order' and status = 'open' and not voided),
    'output_vat', (select coalesce(sum(vat_amount),0) from public.transactions, m where company_id = _company and type in ('invoice','sales_receipt') and not voided and txn_date >= m.s and txn_date < m.e),
    'input_vat', (select coalesce(sum(vat_amount),0) from public.transactions, m where company_id = _company and type = 'bill' and not voided and txn_date >= m.s and txn_date < m.e),
    'ewt_total', (select coalesce(sum(ewt_amount),0) from public.transactions, m where company_id = _company and type in ('invoice','sales_receipt','bill','payment') and not voided and txn_date >= m.s and txn_date < m.e),
    'percentage_tax', (select coalesce(sum(percentage_tax_amount),0) from public.transactions, m where company_id = _company and type in ('invoice','sales_receipt') and not voided and txn_date >= m.s and txn_date < m.e)
  )
$$;

insert into public.companies(id, name, trade_name, tin, rdo_code, registered_address, zip_code, vat_registered, atp_no, atp_date_issued,
  invoice_series_start, invoice_series_end, invoice_series_next, printer_name, printer_tin, printer_accreditation_no, printer_accreditation_date, last_sync_at)
values ('00000000-0000-0000-0000-000000000001','Jhaymarts Industries Incorporated','Jhaymarts Hardware','008-123-456-00000','113A',
  'Km. 5 McArthur Highway, Matina, Davao City','8000', true, 'OCN-113A-2025-0001234', '2025-01-15', 1, 2000, 1,
  'Davao Quickprint Press','123-456-789-00000','113MP2024000012','2024-06-01', now());

insert into public.locations(company_id, name, address, is_default) values
  ('00000000-0000-0000-0000-000000000001','Matina Warehouse','Km. 5 McArthur Highway, Matina, Davao City', true),
  ('00000000-0000-0000-0000-000000000001','Main Store','San Pedro St., Poblacion, Davao City', false);

insert into public.customers(company_id, name, registered_name, tin, branch_code, registered_address, tax_type, withholding_agent, default_atc, contact_name, email, phone, terms)
select '00000000-0000-0000-0000-000000000001',
  n.name, n.name,
  case when i % 3 <> 0 then lpad(((i*7919) % 1000)::text,3,'0') || '-' || lpad(((i*104729) % 1000)::text,3,'0') || '-' || lpad(((i*1299709) % 1000)::text,3,'0') || '-00000' end,
  case when i % 3 <> 0 then '00000' end,
  (array['Matina','Bajada','Lanang','Toril','Agdao','Buhangin','Ecoland','Sasa','Calinan','Poblacion'])[(i % 10)+1] || ', Davao City',
  case when i % 25 = 0 then 'government'::public.party_tax_type when i % 11 = 0 then 'vat_exempt' when i % 17 = 0 then 'zero_rated' else 'vatable' end,
  (i % 25 = 0 or i % 7 = 0),
  case when i % 25 = 0 then 'WC640' when i % 7 = 0 then 'WC158' end,
  (array['Maria Santos','Jose Reyes','Ana Cruz','Pedro Bautista','Liza Garcia','Ramon Dela Cruz','Grace Tan','Mark Villanueva','Joy Mendoza','Carlo Lim'])[(i % 10)+1],
  'accounts' || i || '@example.ph',
  '0917' || lpad(((i*7331) % 10000000)::text,7,'0'),
  (array['Net 30','Net 15','COD','Net 60'])[(i % 4)+1]
from generate_series(1,200) as i
cross join lateral (select case when i % 25 = 0 then
    (array['City Government of Davao','DPWH Davao City 1st DEO','Davao City Water District','Southern Philippines Medical Center','DepEd Davao City Division','Provincial Government of Davao del Sur','Davao City Police Office','University of Southeastern Philippines'])[i/25]
  else
    (array['Mindanao','Davao','Matina','Bajada','Lanang','Toril','Agdao','Buhangin','Ecoland','Cabantian','Talomo','Panacan','Sasa','Bunawan','Calinan','Mintal','Catalunan','Ma-a','Obrero','Tibungco'])[((i-1) % 20)+1]
    || ' ' ||
    (array['Hardware','Trading','Construction Supply','Enterprises','Marketing','General Merchandise','Builders Corp.','Sari-Sari Store','Food Corp.','Industrial Sales'])[((i-1) / 20)+1]
  end as name) n;

insert into public.vendors(company_id, name, registered_name, tin, branch_code, registered_address, tax_type, withholding_agent, default_atc, contact_name, email, phone, terms)
select '00000000-0000-0000-0000-000000000001', v.name, v.name,
  lpad(((i*6007) % 1000)::text,3,'0') || '-' || lpad(((i*9001) % 1000)::text,3,'0') || '-' || lpad(((i*3571) % 1000)::text,3,'0') || '-' || lpad((i % 3)::text,5,'0'),
  lpad((i % 3)::text,5,'0'),
  (array['Cebu City','Manila','Cagayan de Oro','Davao City','General Santos'])[(i % 5)+1],
  case when i % 13 = 0 then 'vat_exempt'::public.party_tax_type else 'vatable' end,
  false,
  case when i % 4 = 0 then 'WC160' else 'WC158' end,
  (array['Rico Uy','Jenny Co','Arnel Sy','Dina Go','Felix Ong'])[(i % 5)+1],
  'sales' || i || '@supplier.ph',
  '0918' || lpad(((i*5113) % 10000000)::text,7,'0'),
  (array['Net 30','Net 45','COD'])[(i % 3)+1]
from generate_series(1,80) as i
cross join lateral (select case when i <= 8 then
    (array['168 - Fu AG Bakeshop','2GO Express Inc.','3/16 Glass and Aluminum Works','3s Marias Locksmith Shop','3XD Enterprises','4BGA Logistics Services & Trading Corp','7 Eleven','Holcim Philippines Inc.'])[i]
  else
    (array['Pacific','Golden','Metro','Allied','Prime','Royal','Sunrise','Asia','Island','United'])[((i-9) % 10)+1] || ' ' ||
    (array['Steel Corp.','Cement Distributors','Paint Center','Electrical Supply','Plumbing Depot','Lumber Yard','Tiles & Fixtures'])[((i-9) / 10 % 7)+1]
  end as name) v;

select public.seed_company_defaults('00000000-0000-0000-0000-000000000001');

insert into public.items(company_id, sku, name, category, type, cost, price, tracking, uom, decimals_allowed, barcode, reorder_point, tax_code_id)
select '00000000-0000-0000-0000-000000000001',
  'SKU-' || lpad(i::text,5,'0'),
  b.base || ' - ' || (array['Standard','Premium','Economy','Heavy Duty','Grade A','Grade B','Small','Medium','Large','XL'])[((i-1) / 30)+1],
  b.cat,
  case when i % 20 = 0 then 'service'::public.item_type when i % 25 = 0 then 'assembly' when i % 15 = 0 then 'non_inventory' else 'inventory' end,
  c.cost, round(c.cost * 1.35, 2),
  case when i % 20 = 0 or i % 15 = 0 then 'none'::public.tracking_type when i % 10 = 3 then 'lot' when i % 13 = 5 then 'serial' else 'none' end,
  b.uom, case when b.uom in ('kg','m','L') then 2 else 0 end,
  '480' || lpad(((i*982451) % 1000000000)::text,10,'0'),
  10 + (i % 40),
  (select id from public.tax_codes t where t.company_id = '00000000-0000-0000-0000-000000000001' and t.code =
     case when i % 9 = 0 then 'EXEMPT' when i % 31 = 0 then 'ZERO' else 'VAT12-S' end)
from generate_series(1,300) as i
cross join lateral (select
  (array['Portland Cement 40kg','Deformed Bar 10mm','Deformed Bar 12mm','Marine Plywood 1/4','Marine Plywood 3/4','GI Sheet Gauge 26','Hollow Block 4in','Coco Lumber 2x2','Common Nail 3in','Concrete Nail 2in',
         'PVC Pipe 1/2in','PVC Pipe 2in','Elbow Fitting 1/2in','Gate Valve 1in','Latex Paint 4L','Enamel Paint 1L','Paint Thinner 1L','Electrical Wire 2.0mm','Electrical Wire 3.5mm','Circuit Breaker 30A',
         'LED Bulb 9W','Floor Tile 60x60','Wall Tile 30x30','Tile Adhesive 25kg','Sand (cu.m)','Gravel 3/4 (cu.m)','Steel Tubular 1x1','Angle Bar 1in','Welding Rod 1/8','Installation Service'])[((i-1) % 30)+1] as base,
  (array['Cement','Steel','Steel','Lumber','Lumber','Roofing','Masonry','Lumber','Fasteners','Fasteners',
         'Plumbing','Plumbing','Plumbing','Plumbing','Paint','Paint','Paint','Electrical','Electrical','Electrical',
         'Electrical','Tiles','Tiles','Tiles','Aggregates','Aggregates','Steel','Steel','Welding','Services'])[((i-1) % 30)+1] as cat,
  (array['bag','pc','pc','sheet','sheet','sheet','pc','pc','kg','kg','pc','pc','pc','pc','gal','L','L','m','m','pc','pc','pc','pc','bag','cu.m','cu.m','pc','pc','kg','job'])[((i-1) % 30)+1] as uom) b
cross join lateral (select round((40 + ((i*37) % 2400))::numeric + ((i*13) % 100)/100.0, 2) as cost) c;

insert into public.item_lots(company_id, item_id, lot_no, received_date, expiry_date)
select it.company_id, it.id, 'LOT-' || substr(it.sku,5) || '-' || g, current_date - (30*g), current_date + (365 - 30*g)
from public.items it cross join generate_series(1,2) g where it.tracking = 'lot';

insert into public.item_serials(company_id, item_id, serial_no, location_id)
select it.company_id, it.id, 'SN' || substr(it.sku,5) || lpad(g::text,4,'0'),
  (select id from public.locations where company_id = it.company_id and name = 'Matina Warehouse')
from public.items it cross join generate_series(1,3) g where it.tracking = 'serial';

insert into public.inventory_levels(company_id, item_id, location_id, lot_id, qty)
select it.company_id, it.id, loc.id, null, ((row_number() over (order by it.sku, loc.name)) * 13 % 500)
from public.items it cross join public.locations loc
where it.type in ('inventory','assembly') and it.tracking <> 'lot' and loc.company_id = it.company_id;

insert into public.inventory_levels(company_id, item_id, location_id, lot_id, qty)
select l.company_id, l.item_id, (select id from public.locations where company_id = l.company_id and name = 'Matina Warehouse'), l.id, 50 + (row_number() over (order by l.lot_no)) * 7 % 200
from public.item_lots l;

create temp table seed_customers on commit drop as select row_number() over (order by name) as rn, * from public.customers where company_id = '00000000-0000-0000-0000-000000000001';
create temp table seed_vendors on commit drop as select row_number() over (order by name) as rn, * from public.vendors where company_id = '00000000-0000-0000-0000-000000000001';
create temp table seed_items on commit drop as select row_number() over (order by it.sku) as rn, it.*, tc.kind as tax_kind, tc.rate as tax_rate from public.items it left join public.tax_codes tc on tc.id = it.tax_code_id where it.company_id = '00000000-0000-0000-0000-000000000001';

create temp table seed_txn on commit drop as
select i,
  (array['invoice','invoice','invoice','sales_order','sales_order','estimate','estimate','sales_receipt','sales_receipt','purchase_order','bill','bill','receipt','payment','payment','shipment','pick_ticket','work_order','build','transfer','return','rma','adjustment'])[(i % 23)+1]::public.txn_type as type,
  current_date - ((i*7) % 180) as txn_date
from generate_series(1,500) i;

insert into public.transactions(id, company_id, type, ref_no, status, txn_date, due_date, party_type, party_id, party_name, location_id, to_location_id, price_mode, ewt_atc, ewt_rate, qb_sync_status)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', s.type,
  public.default_prefix(s.type) || lpad((row_number() over (partition by s.type order by s.txn_date, s.i))::text, 6, '0'),
  case s.type
    when 'estimate' then case when s.i % 3 = 0 then 'accepted' else 'pending' end
    when 'sales_order' then case when s.txn_date > current_date - 60 then 'open' else 'closed' end
    when 'invoice' then case when s.txn_date > current_date - 30 then 'open' else 'paid' end
    when 'sales_receipt' then case when s.txn_date > current_date - 20 then 'open' else 'closed' end
    when 'purchase_order' then case when s.txn_date > current_date - 45 then 'open' else 'received' end
    when 'bill' then case when s.txn_date > current_date - 30 then 'open' else 'paid' end
    when 'work_order' then case when s.txn_date > current_date - 60 then 'open' else 'closed' end
    when 'shipment' then case when s.txn_date > current_date - 5 then 'unshipped' else 'shipped' end
    when 'pick_ticket' then case when s.txn_date > current_date - 10 then 'open' else 'picked' end
    else 'closed' end,
  s.txn_date,
  case when s.type in ('invoice','bill') then s.txn_date + 30 end,
  p.party_type, p.party_id, p.party_name,
  (select id from public.locations where company_id = '00000000-0000-0000-0000-000000000001' and name = case when s.i % 4 = 0 then 'Main Store' else 'Matina Warehouse' end),
  case when s.type = 'transfer' then (select id from public.locations where company_id = '00000000-0000-0000-0000-000000000001' and name = 'Main Store') end,
  'exclusive',
  case when s.type in ('invoice','sales_receipt','payment','bill') then p.atc end,
  case when s.type in ('invoice','sales_receipt','payment','bill') then coalesce((select rate from public.atc_codes a where a.company_id = '00000000-0000-0000-0000-000000000001' and a.code = p.atc),0) else 0 end,
  case when s.txn_date >= current_date - 1 then 'pending' else 'sent' end
from seed_txn s
cross join lateral (
  select
    case when s.type in ('estimate','sales_order','invoice','sales_receipt','shipment','pick_ticket','return','rma','payment') then 'customer'
         when s.type in ('purchase_order','receipt','bill') then 'vendor' end as party_type,
    case when s.type in ('estimate','sales_order','invoice','sales_receipt','shipment','pick_ticket','return','rma','payment') then sc.id
         when s.type in ('purchase_order','receipt','bill') then sv.id end as party_id,
    case when s.type in ('estimate','sales_order','invoice','sales_receipt','shipment','pick_ticket','return','rma','payment') then sc.name
         when s.type in ('purchase_order','receipt','bill') then sv.name end as party_name,
    case when s.type in ('invoice','sales_receipt','payment') and sc.withholding_agent then sc.default_atc
         when s.type = 'bill' and s.i % 3 = 0 then sv.default_atc end as atc
  from seed_customers sc, seed_vendors sv
  where sc.rn = ((s.i * 37) % 200) + 1 and sv.rn = ((s.i * 11) % 80) + 1
) p;

insert into public.transaction_lines(company_id, transaction_id, line_no, item_id, description, qty, qty_fulfilled, qty_invoiced, rate, amount, tax_code_id, vat_amount)
select t.company_id, t.id, l, si.id, si.name, q.qty,
  case when t.type = 'sales_order' and t.status = 'open' then (case (t.rn + l) % 3 when 0 then 0 when 1 then floor(q.qty/2) else q.qty end)
       when t.type = 'sales_order' then q.qty else 0 end,
  case when t.type = 'sales_order' and t.status = 'open' then (case (t.rn + l) % 4 when 0 then (case (t.rn + l) % 3 when 2 then floor(q.qty/2) else 0 end) else 0 end)
       when t.type = 'sales_order' then q.qty else 0 end,
  r.rate, round(q.qty * r.rate, 2),
  case when t.type in ('purchase_order','receipt','bill') and si.tax_kind = 'vat'
       then (select id from public.tax_codes where company_id = t.company_id and code = 'VAT12-P') else si.tax_code_id end,
  case when si.tax_kind = 'vat' then round(q.qty * r.rate * si.tax_rate / 100, 2) else 0 end
from (select tr.*, row_number() over (order by tr.txn_date, tr.ref_no) as rn from public.transactions tr where tr.company_id = '00000000-0000-0000-0000-000000000001' and tr.type <> 'payment') t
cross join lateral generate_series(1, 1 + (t.rn % 4)::int) l
join seed_items si on si.rn = ((t.rn * 31 + l * 17) % 300) + 1
cross join lateral (select (1 + ((t.rn + l * 7) % 20))::numeric as qty) q
cross join lateral (select case when t.type in ('purchase_order','receipt','bill') then si.cost else si.price end as rate) r;

update public.transactions t set
  vatable_sales = x.vatable, vat_exempt_sales = x.exempt, zero_rated_sales = x.zero, vat_amount = x.vat,
  total = x.vatable + x.exempt + x.zero + x.vat,
  ewt_amount = round((x.vatable + x.exempt + x.zero) * t.ewt_rate / 100, 2),
  amount_due = x.vatable + x.exempt + x.zero + x.vat - round((x.vatable + x.exempt + x.zero) * t.ewt_rate / 100, 2)
from (
  select l.transaction_id,
    coalesce(sum(l.amount) filter (where tc.kind = 'vat'),0) as vatable,
    coalesce(sum(l.amount) filter (where tc.kind = 'exempt'),0) as exempt,
    coalesce(sum(l.amount) filter (where tc.kind = 'zero_rated'),0) as zero,
    coalesce(sum(l.vat_amount),0) as vat
  from public.transaction_lines l left join public.tax_codes tc on tc.id = l.tax_code_id
  group by l.transaction_id
) x where x.transaction_id = t.id;

update public.transactions t set
  vatable_sales = round(p.base, 2), vat_amount = round(p.base * 0.12, 2), total = round(p.base * 1.12, 2),
  ewt_amount = round(p.base * t.ewt_rate / 100, 2), amount_due = round(p.base * 1.12, 2) - round(p.base * t.ewt_rate / 100, 2)
from (select id, (5000 + (abs(hashtext(ref_no)) % 95000))::numeric as base from public.transactions where type = 'payment') p
where p.id = t.id;

update public.transactions t set bir_series_no = x.n
from (select id, row_number() over (order by txn_date, ref_no) as n from public.transactions
      where company_id = '00000000-0000-0000-0000-000000000001' and type in ('invoice','sales_receipt')) x
where x.id = t.id;

update public.companies set invoice_series_next = coalesce((select max(bir_series_no) from public.transactions where company_id = companies.id),0) + 1
where id = '00000000-0000-0000-0000-000000000001';

update public.doc_sequences d set next_no = coalesce((select count(*) from public.transactions t where t.company_id = d.company_id and t.type = d.txn_type),0) + 1
where d.company_id = '00000000-0000-0000-0000-000000000001';

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.audit_log(company_id, user_id, table_name, record_id, action, data)
  values (
    case when tg_table_name = 'companies' then (to_jsonb(r)->>'id')::uuid else (to_jsonb(r)->>'company_id')::uuid end,
    auth.uid(), tg_table_name, (to_jsonb(r)->>'id')::uuid, lower(tg_op), to_jsonb(r));
  return r;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','customers','vendors','items','locations','tax_codes','atc_codes','transactions','company_members'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
