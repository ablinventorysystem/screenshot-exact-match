-- Part 2 Migration: Master Data extensions, Item BOM (co/by-products), Cost History,
-- Sales Workflow fields, BIR Invoice fields, Form 2307 tracker, and Audit triggers.
-- Idempotent: safe to run multiple times.

-- 1. Extend companies for BIR footer & branch code
alter table public.companies
  add column if not exists branch_code text not null default '00000',
  add column if not exists atp_validity_date date,
  add column if not exists bir_validity_notice text not null default 'THIS SALES INVOICE SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP';

-- 2. Extend customers for BIR invoice buyer fields
alter table public.customers
  add column if not exists business_style text,
  add column if not exists sc_pwd_name text;

-- 3. Extend items for preferred vendor (used for PO generation from Sales Orders)
alter table public.items
  add column if not exists preferred_vendor_id uuid references public.vendors(id) on delete set null;

-- 4. Extend item_serials for unit cost tracking
alter table public.item_serials
  add column if not exists unit_cost numeric(18,4) not null default 0,
  add column if not exists lot_id uuid references public.item_lots(id) on delete set null;

-- 5. Item BOM / Co-products / By-products for assembly items
create table if not exists public.item_bom_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assembly_item_id uuid not null references public.items(id) on delete cascade,
  component_item_id uuid not null references public.items(id) on delete cascade,
  role text not null default 'component' check (role in ('component','co_product','by_product')),
  qty numeric(18,6) not null default 1,
  uom text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists item_bom_lines_assembly on public.item_bom_lines(assembly_item_id);

-- 6. Item & Serial Cost History
create table if not exists public.item_cost_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  serial_id uuid references public.item_serials(id) on delete set null,
  lot_id uuid references public.item_lots(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  txn_date date not null default current_date,
  txn_ref text,
  qty numeric(18,6) not null default 0,
  unit_cost numeric(18,6) not null default 0,
  running_avg_cost numeric(18,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists item_cost_history_item on public.item_cost_history(item_id, txn_date desc, created_at desc);
create index if not exists item_cost_history_serial on public.item_cost_history(serial_id) where serial_id is not null;

-- 7. Form 2307 tracker per customer payment
create table if not exists public.form_2307_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_txn_id uuid not null references public.transactions(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  atc_code text,
  income_base numeric(18,2) not null default 0,
  amount_withheld numeric(18,2) not null default 0,
  quarter text not null default '2026-Q1',
  certificate_received boolean not null default false,
  received_date date,
  certificate_no text,
  updated_at timestamptz not null default now(),
  unique (company_id, payment_txn_id)
);
create index if not exists form_2307_company on public.form_2307_records(company_id, quarter);

-- 8. Extend transactions for Sales Order, Return, and BIR Invoice fields
alter table public.transactions
  add column if not exists ship_to text,
  add column if not exists bill_to text,
  add column if not exists terms text,
  add column if not exists sales_rep text,
  add column if not exists po_reference text,
  add column if not exists sc_pwd_name text,
  add column if not exists document_title text,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists drop_ship boolean not null default false,
  add column if not exists return_reason text,
  add column if not exists restock boolean not null default true;

-- 9. Extend transaction_lines for UOM, line discount, and source line linkage
alter table public.transaction_lines
  add column if not exists uom text,
  add column if not exists discount_rate numeric(6,3) not null default 0,
  add column if not exists source_line_id uuid;

-- 10. Grants & RLS for new tables
grant select, insert, update, delete on public.item_bom_lines, public.item_cost_history, public.form_2307_records to authenticated;
grant all on public.item_bom_lines, public.item_cost_history, public.form_2307_records to service_role;

alter table public.item_bom_lines enable row level security;
alter table public.item_cost_history enable row level security;
alter table public.form_2307_records enable row level security;

do $$
declare t text;
begin
  foreach t in array array['item_bom_lines','item_cost_history','form_2307_records'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members read') then
      execute format('create policy "members read" on public.%I for select to authenticated using (public.is_company_member(company_id))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'writers insert') then
      execute format('create policy "writers insert" on public.%I for insert to authenticated with check (public.can_write(company_id))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'writers update') then
      execute format('create policy "writers update" on public.%I for update to authenticated using (public.can_write(company_id)) with check (public.can_write(company_id))', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'writers delete') then
      execute format('create policy "writers delete" on public.%I for delete to authenticated using (public.can_write(company_id))', t);
    end if;
  end loop;
end $$;

-- 11. Audit triggers on inventory & tracking tables
do $$
declare t text;
begin
  foreach t in array array['inventory_levels','item_lots','item_serials','item_bom_lines','item_cost_history','form_2307_records'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
    end if;
  end loop;
end $$;

-- 12. Update save_transaction RPC to persist new header and line fields
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
    insert into public.transactions(
      company_id, type, ref_no, bir_series_no, status, txn_date, due_date, party_type, party_id, party_name,
      location_id, to_location_id, parent_txn_id, price_mode, vatable_sales, vat_exempt_sales, zero_rated_sales,
      vat_amount, percentage_tax_amount, discount_type, discount_rate, discount_amount, sc_pwd_id, sc_pwd_name,
      ewt_atc, ewt_rate, ewt_amount, total, amount_due, notes, ship_to, bill_to, terms, sales_rep, po_reference,
      document_title, drop_ship, return_reason, restock, created_by
    )
    values (
      v_company, v_type, v_ref, v_bir, coalesce(p->>'status','open'), coalesce((p->>'txn_date')::date, current_date),
      nullif(p->>'due_date','')::date, nullif(p->>'party_type',''), nullif(p->>'party_id','')::uuid, nullif(p->>'party_name',''),
      nullif(p->>'location_id','')::uuid, nullif(p->>'to_location_id','')::uuid, nullif(p->>'parent_txn_id','')::uuid,
      coalesce(p->>'price_mode','exclusive'), coalesce((p->>'vatable_sales')::numeric,0), coalesce((p->>'vat_exempt_sales')::numeric,0),
      coalesce((p->>'zero_rated_sales')::numeric,0), coalesce((p->>'vat_amount')::numeric,0), coalesce((p->>'percentage_tax_amount')::numeric,0),
      coalesce((p->>'discount_type')::public.discount_kind,'none'), coalesce((p->>'discount_rate')::numeric,0), coalesce((p->>'discount_amount')::numeric,0),
      nullif(p->>'sc_pwd_id',''), nullif(p->>'sc_pwd_name',''), nullif(p->>'ewt_atc',''), coalesce((p->>'ewt_rate')::numeric,0),
      coalesce((p->>'ewt_amount')::numeric,0), coalesce((p->>'total')::numeric,0), coalesce((p->>'amount_due')::numeric,0),
      nullif(p->>'notes',''), nullif(p->>'ship_to',''), nullif(p->>'bill_to',''), nullif(p->>'terms',''),
      nullif(p->>'sales_rep',''), nullif(p->>'po_reference',''), nullif(p->>'document_title',''),
      coalesce((p->>'drop_ship')::boolean, false), nullif(p->>'return_reason',''), coalesce((p->>'restock')::boolean, true),
      auth.uid()
    )
    returning id into v_id;
  else
    select * into v_existing from public.transactions where id = v_id and company_id = v_company;
    if not found then raise exception 'Transaction not found'; end if;
    if v_existing.voided then raise exception 'Voided transactions cannot be edited'; end if;
    update public.transactions set
      status = coalesce(p->>'status', status),
      txn_date = coalesce((p->>'txn_date')::date, txn_date),
      due_date = nullif(p->>'due_date','')::date,
      party_type = nullif(p->>'party_type',''),
      party_id = nullif(p->>'party_id','')::uuid,
      party_name = nullif(p->>'party_name',''),
      location_id = nullif(p->>'location_id','')::uuid,
      to_location_id = nullif(p->>'to_location_id','')::uuid,
      price_mode = coalesce(p->>'price_mode', price_mode),
      vatable_sales = coalesce((p->>'vatable_sales')::numeric,0),
      vat_exempt_sales = coalesce((p->>'vat_exempt_sales')::numeric,0),
      zero_rated_sales = coalesce((p->>'zero_rated_sales')::numeric,0),
      vat_amount = coalesce((p->>'vat_amount')::numeric,0),
      percentage_tax_amount = coalesce((p->>'percentage_tax_amount')::numeric,0),
      discount_type = coalesce((p->>'discount_type')::public.discount_kind,'none'),
      discount_rate = coalesce((p->>'discount_rate')::numeric,0),
      discount_amount = coalesce((p->>'discount_amount')::numeric,0),
      sc_pwd_id = nullif(p->>'sc_pwd_id',''),
      sc_pwd_name = nullif(p->>'sc_pwd_name',''),
      ewt_atc = nullif(p->>'ewt_atc',''),
      ewt_rate = coalesce((p->>'ewt_rate')::numeric,0),
      ewt_amount = coalesce((p->>'ewt_amount')::numeric,0),
      total = coalesce((p->>'total')::numeric,0),
      amount_due = coalesce((p->>'amount_due')::numeric,0),
      notes = nullif(p->>'notes',''),
      ship_to = nullif(p->>'ship_to',''),
      bill_to = nullif(p->>'bill_to',''),
      terms = nullif(p->>'terms',''),
      sales_rep = nullif(p->>'sales_rep',''),
      po_reference = nullif(p->>'po_reference',''),
      document_title = nullif(p->>'document_title',''),
      drop_ship = coalesce((p->>'drop_ship')::boolean, drop_ship),
      return_reason = nullif(p->>'return_reason',''),
      restock = coalesce((p->>'restock')::boolean, restock),
      qb_sync_status = 'pending',
      updated_at = now()
    where id = v_id;
    delete from public.transaction_lines where transaction_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    i := i + 1;
    insert into public.transaction_lines(
      company_id, transaction_id, line_no, item_id, description, qty, qty_fulfilled, qty_invoiced,
      rate, discount_rate, amount, tax_code_id, vat_amount, lot_id, serial_id, uom, source_line_id
    )
    values (
      v_company, v_id, i, nullif(l->>'item_id','')::uuid, nullif(l->>'description',''),
      coalesce((l->>'qty')::numeric,0), coalesce((l->>'qty_fulfilled')::numeric,0), coalesce((l->>'qty_invoiced')::numeric,0),
      coalesce((l->>'rate')::numeric,0), coalesce((l->>'discount_rate')::numeric,0), coalesce((l->>'amount')::numeric,0),
      nullif(l->>'tax_code_id','')::uuid, coalesce((l->>'vat_amount')::numeric,0),
      nullif(l->>'lot_id','')::uuid, nullif(l->>'serial_id','')::uuid,
      nullif(l->>'uom',''), nullif(l->>'source_line_id','')::uuid
    );
  end loop;
  return v_id;
end $$;

-- 13. Update void_transaction to accept an optional reason while preserving backwards compatibility
create or replace function public.void_transaction(_id uuid, _reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.transactions where id = _id;
  if v_company is null or not public.can_write(v_company) then raise exception 'Not allowed'; end if;
  update public.transactions set
    voided = true,
    status = 'void',
    void_reason = coalesce(nullif(_reason,''), void_reason),
    voided_at = now(),
    vatable_sales = 0,
    vat_exempt_sales = 0,
    zero_rated_sales = 0,
    vat_amount = 0,
    percentage_tax_amount = 0,
    ewt_amount = 0,
    total = 0,
    amount_due = 0,
    qb_sync_status = 'pending',
    updated_at = now()
  where id = _id;
end $$;

-- 14. Seed initial cost history for existing items so Profit/Loss and Cost History tabs have baseline data
insert into public.item_cost_history(company_id, item_id, txn_date, txn_ref, qty, unit_cost, running_avg_cost)
select i.company_id, i.id, i.created_at::date, 'OPENING-COST', 1, i.cost, i.cost
from public.items i
where not exists (select 1 from public.item_cost_history h where h.item_id = i.id);
