-- Part 3 Migration: Purchasing (Input VAT, 2307 Issued), Transfers, Production (Processes, Jobs, Genealogy),
-- RMA Workflow & Credit Memos, Rentals, Fulfillment (Carrier/Tracking/Pack/Ship), QuickBooks Sync Logs,
-- Settings (Payment Terms, Email Templates, Integrations, Custom Fields), and Notifications.
-- Idempotent: safe to run multiple times.

-- 1. Extend txn_type enum for credit_memo and rental
alter type public.txn_type add value if not exists 'credit_memo';
alter type public.txn_type add value if not exists 'rental';

-- 2. Extend companies for QuickBooks, Integrations, Email Templates, Custom Fields & RELIEF mapping
alter table public.companies
  add column if not exists qb_connected boolean not null default false,
  add column if not exists qb_realm_id text,
  add column if not exists custom_fields_enabled boolean not null default false,
  add column if not exists custom_field_labels jsonb not null default '[]'::jsonb,
  add column if not exists email_templates jsonb not null default '{}'::jsonb,
  add column if not exists shipping_integrations jsonb not null default '{"shipstation":{"enabled":false,"mode":"mock"},"ups":{"enabled":false,"mode":"mock"}}'::jsonb,
  add column if not exists relief_column_map jsonb not null default '{}'::jsonb;

-- 3. Extend transactions for Bills Input VAT, Fulfillment Carrier/Tracking, Production, RMA & Custom Fields
alter table public.transactions
  add column if not exists input_vat_amount numeric(18,2) not null default 0,
  add column if not exists input_vat_claimable boolean not null default true,
  add column if not exists carrier text,
  add column if not exists tracking_no text,
  add column if not exists package_weight numeric(12,3),
  add column if not exists shipping_provider text,
  add column if not exists shipping_label_url text,
  add column if not exists packed_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists job_id uuid,
  add column if not exists process_id uuid,
  add column if not exists rma_stage text,
  add column if not exists rma_disposition text,
  add column if not exists credit_memo_txn_id uuid,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- 4. Extend transaction_lines for partial receiving & pick/pack confirmation
alter table public.transaction_lines
  add column if not exists qty_received numeric(18,6) not null default 0,
  add column if not exists picked boolean not null default false,
  add column if not exists picked_at timestamptz;

-- 5. Payment Terms
create table if not exists public.payment_terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  days int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists payment_terms_company on public.payment_terms(company_id);

-- 6. Production Processes (reusable BOM + labor/overhead)
create table if not exists public.production_processes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  output_item_id uuid references public.items(id) on delete set null,
  output_qty numeric(18,6) not null default 1,
  labor_cost numeric(18,2) not null default 0,
  overhead_cost numeric(18,2) not null default 0,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists production_processes_company on public.production_processes(company_id);

create table if not exists public.production_process_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  process_id uuid not null references public.production_processes(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  role text not null default 'input' check (role in ('input','output','co_product','by_product')),
  qty numeric(18,6) not null default 1,
  uom text,
  created_at timestamptz not null default now()
);
create index if not exists production_process_lines_proc on public.production_process_lines(process_id);

-- 7. Production Jobs (group work orders and costs)
create table if not exists public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_no text not null,
  name text not null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  start_date date,
  due_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists production_jobs_company on public.production_jobs(company_id);

-- 8. Lot/Serial Genealogy (component lot/serial -> finished good lot/serial)
create table if not exists public.lot_genealogy (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  parent_lot_id uuid references public.item_lots(id) on delete set null,
  parent_serial_id uuid references public.item_serials(id) on delete set null,
  child_lot_id uuid references public.item_lots(id) on delete set null,
  child_serial_id uuid references public.item_serials(id) on delete set null,
  build_txn_id uuid references public.transactions(id) on delete set null,
  qty numeric(18,6) not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists lot_genealogy_parent on public.lot_genealogy(parent_lot_id, parent_serial_id);
create index if not exists lot_genealogy_child on public.lot_genealogy(child_lot_id, child_serial_id);

-- 9. Rental Bookings
create table if not exists public.rental_bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ref_no text not null,
  item_id uuid not null references public.items(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  location_id uuid references public.locations(id) on delete set null,
  qty numeric(18,6) not null default 1,
  daily_rate numeric(18,2) not null default 0,
  out_date date not null,
  due_in_date date not null,
  returned_date date,
  status text not null default 'reserved' check (status in ('reserved','out','returned','cancelled')),
  total_amount numeric(18,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists rental_bookings_company on public.rental_bookings(company_id, out_date, due_in_date);

-- 10. Form 2307 Issued Tracker (vendor bills with EWT withheld)
create table if not exists public.form_2307_issued (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bill_txn_id uuid not null references public.transactions(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  atc_code text,
  income_base numeric(18,2) not null default 0,
  amount_withheld numeric(18,2) not null default 0,
  quarter text not null default '2026-Q4',
  certificate_issued boolean not null default false,
  issued_date date,
  certificate_no text,
  updated_at timestamptz not null default now(),
  unique (company_id, bill_txn_id)
);
create index if not exists form_2307_issued_company on public.form_2307_issued(company_id, quarter);

-- 11. QuickBooks Sync Logs
create table if not exists public.qb_sync_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  synced_at timestamptz not null default now(),
  txn_count int not null default 0,
  status text not null default 'success' check (status in ('success','partial','error')),
  error_message text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists qb_sync_logs_company on public.qb_sync_logs(company_id, synced_at desc);

-- 12. Notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  body text,
  kind text not null default 'info',
  link_to text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_company on public.notifications(company_id, created_at desc);

-- 13. Grants & RLS for all new tables
grant select, insert, update, delete on
  public.payment_terms,
  public.production_processes,
  public.production_process_lines,
  public.production_jobs,
  public.lot_genealogy,
  public.rental_bookings,
  public.form_2307_issued,
  public.qb_sync_logs,
  public.notifications
to authenticated;

grant all on
  public.payment_terms,
  public.production_processes,
  public.production_process_lines,
  public.production_jobs,
  public.lot_genealogy,
  public.rental_bookings,
  public.form_2307_issued,
  public.qb_sync_logs,
  public.notifications
to service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'payment_terms','production_processes','production_process_lines','production_jobs',
    'lot_genealogy','rental_bookings','form_2307_issued','qb_sync_logs','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
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

-- 14. Audit triggers on new transactional/master tables
do $$
declare t text;
begin
  foreach t in array array[
    'payment_terms','production_processes','production_jobs','lot_genealogy','rental_bookings','form_2307_issued'
  ] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
    end if;
  end loop;
end $$;

-- 15. Update save_transaction RPC to support Part 3 fields
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
      vat_amount, input_vat_amount, input_vat_claimable, percentage_tax_amount, discount_type, discount_rate, discount_amount,
      sc_pwd_id, sc_pwd_name, ewt_atc, ewt_rate, ewt_amount, total, amount_due, notes, ship_to, bill_to, terms, sales_rep,
      po_reference, document_title, drop_ship, return_reason, restock, carrier, tracking_no, package_weight,
      shipping_provider, shipping_label_url, job_id, process_id, rma_stage, rma_disposition, credit_memo_txn_id,
      custom_fields, created_by
    )
    values (
      v_company, v_type, v_ref, v_bir, coalesce(p->>'status','open'), coalesce((p->>'txn_date')::date, current_date),
      nullif(p->>'due_date','')::date, nullif(p->>'party_type',''), nullif(p->>'party_id','')::uuid, nullif(p->>'party_name',''),
      nullif(p->>'location_id','')::uuid, nullif(p->>'to_location_id','')::uuid, nullif(p->>'parent_txn_id','')::uuid,
      coalesce(p->>'price_mode','exclusive'), coalesce((p->>'vatable_sales')::numeric,0), coalesce((p->>'vat_exempt_sales')::numeric,0),
      coalesce((p->>'zero_rated_sales')::numeric,0), coalesce((p->>'vat_amount')::numeric,0),
      coalesce((p->>'input_vat_amount')::numeric,0), coalesce((p->>'input_vat_claimable')::boolean, true),
      coalesce((p->>'percentage_tax_amount')::numeric,0),
      coalesce((p->>'discount_type')::public.discount_kind,'none'), coalesce((p->>'discount_rate')::numeric,0), coalesce((p->>'discount_amount')::numeric,0),
      nullif(p->>'sc_pwd_id',''), nullif(p->>'sc_pwd_name',''), nullif(p->>'ewt_atc',''), coalesce((p->>'ewt_rate')::numeric,0),
      coalesce((p->>'ewt_amount')::numeric,0), coalesce((p->>'total')::numeric,0), coalesce((p->>'amount_due')::numeric,0),
      nullif(p->>'notes',''), nullif(p->>'ship_to',''), nullif(p->>'bill_to',''), nullif(p->>'terms',''),
      nullif(p->>'sales_rep',''), nullif(p->>'po_reference',''), nullif(p->>'document_title',''),
      coalesce((p->>'drop_ship')::boolean, false), nullif(p->>'return_reason',''), coalesce((p->>'restock')::boolean, true),
      nullif(p->>'carrier',''), nullif(p->>'tracking_no',''), nullif(p->>'package_weight','')::numeric,
      nullif(p->>'shipping_provider',''), nullif(p->>'shipping_label_url',''),
      nullif(p->>'job_id','')::uuid, nullif(p->>'process_id','')::uuid,
      nullif(p->>'rma_stage',''), nullif(p->>'rma_disposition',''), nullif(p->>'credit_memo_txn_id','')::uuid,
      coalesce(p->'custom_fields', '{}'::jsonb), auth.uid()
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
      input_vat_amount = coalesce((p->>'input_vat_amount')::numeric, input_vat_amount),
      input_vat_claimable = coalesce((p->>'input_vat_claimable')::boolean, input_vat_claimable),
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
      carrier = coalesce(nullif(p->>'carrier',''), carrier),
      tracking_no = coalesce(nullif(p->>'tracking_no',''), tracking_no),
      package_weight = coalesce(nullif(p->>'package_weight','')::numeric, package_weight),
      shipping_provider = coalesce(nullif(p->>'shipping_provider',''), shipping_provider),
      shipping_label_url = coalesce(nullif(p->>'shipping_label_url',''), shipping_label_url),
      job_id = coalesce(nullif(p->>'job_id','')::uuid, job_id),
      process_id = coalesce(nullif(p->>'process_id','')::uuid, process_id),
      rma_stage = coalesce(nullif(p->>'rma_stage',''), rma_stage),
      rma_disposition = coalesce(nullif(p->>'rma_disposition',''), rma_disposition),
      credit_memo_txn_id = coalesce(nullif(p->>'credit_memo_txn_id','')::uuid, credit_memo_txn_id),
      custom_fields = coalesce(p->'custom_fields', custom_fields),
      qb_sync_status = 'pending',
      updated_at = now()
    where id = v_id;
    delete from public.transaction_lines where transaction_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    i := i + 1;
    insert into public.transaction_lines(
      company_id, transaction_id, line_no, item_id, description, qty, qty_fulfilled, qty_invoiced, qty_received,
      picked, rate, discount_rate, amount, tax_code_id, vat_amount, lot_id, serial_id, uom, source_line_id
    )
    values (
      v_company, v_id, i, nullif(l->>'item_id','')::uuid, nullif(l->>'description',''),
      coalesce((l->>'qty')::numeric,0), coalesce((l->>'qty_fulfilled')::numeric,0), coalesce((l->>'qty_invoiced')::numeric,0),
      coalesce((l->>'qty_received')::numeric,0), coalesce((l->>'picked')::boolean, false),
      coalesce((l->>'rate')::numeric,0), coalesce((l->>'discount_rate')::numeric,0), coalesce((l->>'amount')::numeric,0),
      nullif(l->>'tax_code_id','')::uuid, coalesce((l->>'vat_amount')::numeric,0),
      nullif(l->>'lot_id','')::uuid, nullif(l->>'serial_id','')::uuid,
      nullif(l->>'uom',''), nullif(l->>'source_line_id','')::uuid
    );
  end loop;
  return v_id;
end $$;

-- 16. Seed default payment terms for existing companies
insert into public.payment_terms(company_id, name, days, is_default)
select c.id, t.name, t.days, t.is_def
from public.companies c
cross join (values ('Due on receipt', 0, true), ('Net 15', 15, false), ('Net 30', 30, false), ('Net 60', 60, false)) as t(name, days, is_def)
where not exists (select 1 from public.payment_terms pt where pt.company_id = c.id);
