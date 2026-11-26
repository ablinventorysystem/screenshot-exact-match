-- ============================================================
-- Part 4 Migration: Maintenance module
-- maintenance_log table, backups storage bucket,
-- maintenance_reset() and maintenance_counts() RPCs.
-- Idempotent: safe to run multiple times.
-- PREREQUISITE: Parts 2 and 3 must be applied first.
-- ============================================================

-- 1. maintenance_log table (admin-only audit of backup/restore/reset actions)
create table if not exists public.maintenance_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  action text not null check (action in ('backup','restore','reset')),
  option text,
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now(),
  status text not null default 'success' check (status in ('success','error')),
  details jsonb not null default '{}'::jsonb
);
create index if not exists maintenance_log_company on public.maintenance_log(company_id, performed_at desc);

-- 2. Grants & RLS for maintenance_log (admin only: read + insert)
grant select, insert on public.maintenance_log to authenticated;
grant all on public.maintenance_log to service_role;

alter table public.maintenance_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='maintenance_log' and policyname='admin read') then
    create policy "admin read" on public.maintenance_log
      for select to authenticated
      using (public.has_company_role(company_id, array['admin']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='maintenance_log' and policyname='admin insert') then
    create policy "admin insert" on public.maintenance_log
      for insert to authenticated
      with check (public.has_company_role(company_id, array['admin']::public.app_role[]));
  end if;
end $$;

-- 3. Audit trigger on maintenance_log
do $$
begin
  if not exists (
    select 1 from pg_trigger tr
    join pg_class c on tr.tgrelid = c.oid
    join pg_namespace n on c.relnamespace = n.oid
    where tr.tgname = 'audit_maintenance_log' and c.relname = 'maintenance_log' and n.nspname = 'public'
  ) then
    create trigger audit_maintenance_log
      after insert or update or delete on public.maintenance_log
      for each row execute function public.audit_trigger();
  end if;
end $$;

-- 4. maintenance_counts() RPC — returns live row counts for all business tables
-- Admin-only via has_company_role check inside the function.
create or replace function public.maintenance_counts(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_counts jsonb := '{}';
begin
  if not public.has_company_role(p_company_id, array['admin']::public.app_role[]) then
    raise exception 'Admin role required';
  end if;

  select jsonb_build_object(
    'transactions',          (select count(*) from public.transactions where company_id = p_company_id),
    'transaction_lines',     (select count(*) from public.transaction_lines where company_id = p_company_id),
    'inventory_levels',      (select count(*) from public.inventory_levels where company_id = p_company_id),
    'item_lots',             (select count(*) from public.item_lots where company_id = p_company_id),
    'item_serials',          (select count(*) from public.item_serials where company_id = p_company_id),
    'item_cost_history',     (select count(*) from public.item_cost_history where company_id = p_company_id),
    'form_2307_records',     (select count(*) from public.form_2307_records where company_id = p_company_id),
    'form_2307_issued',      (select count(*) from public.form_2307_issued where company_id = p_company_id),
    'qb_sync_logs',          (select count(*) from public.qb_sync_logs where company_id = p_company_id),
    'notifications',         (select count(*) from public.notifications where company_id = p_company_id),
    'rental_bookings',       (select count(*) from public.rental_bookings where company_id = p_company_id),
    'lot_genealogy',         (select count(*) from public.lot_genealogy where company_id = p_company_id),
    'production_jobs',       (select count(*) from public.production_jobs where company_id = p_company_id),
    'customers',             (select count(*) from public.customers where company_id = p_company_id),
    'vendors',               (select count(*) from public.vendors where company_id = p_company_id),
    'items',                 (select count(*) from public.items where company_id = p_company_id),
    'locations',             (select count(*) from public.locations where company_id = p_company_id),
    'payment_terms',         (select count(*) from public.payment_terms where company_id = p_company_id),
    'production_processes',  (select count(*) from public.production_processes where company_id = p_company_id),
    'item_bom_lines',        (select count(*) from public.item_bom_lines where company_id = p_company_id)
  ) into v_counts;

  return v_counts;
end $$;

grant execute on function public.maintenance_counts(uuid) to authenticated;

-- 5. maintenance_reset() RPC — SECURITY DEFINER, admin-only, runs in a transaction
-- option: 'transactions' | 'transactions_inventory' | 'factory'
-- reset_bir_series: whether to also zero out invoice_series_next
create or replace function public.maintenance_reset(
  p_company_id uuid,
  p_option text,
  p_reset_bir_series boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_counts jsonb;
  v_result jsonb;
  v_txn_count bigint;
  v_inv_count bigint;
  v_cust_count bigint;
begin
  -- Admin-only guard
  if not public.has_company_role(p_company_id, array['admin']::public.app_role[]) then
    raise exception 'Admin role required to perform a data reset';
  end if;

  if p_option not in ('transactions', 'transactions_inventory', 'factory') then
    raise exception 'Invalid reset option: %', p_option;
  end if;

  -- Capture counts before deletion for the audit log
  select count(*) into v_txn_count from public.transactions where company_id = p_company_id;

  -- === RESET TRANSACTIONS (all three options) ===
  -- Delete child records first (FK-safe order)
  delete from public.form_2307_records where company_id = p_company_id;
  delete from public.form_2307_issued where company_id = p_company_id;
  delete from public.qb_sync_logs where company_id = p_company_id;
  delete from public.transaction_lines where company_id = p_company_id;
  delete from public.notifications where company_id = p_company_id;
  delete from public.rental_bookings where company_id = p_company_id;
  delete from public.transactions where company_id = p_company_id;

  -- Reset document number sequences in doc_sequences table (if present)
  update public.doc_sequences set next_no = 1 where company_id = p_company_id;

  -- Optionally reset BIR invoice series
  if p_reset_bir_series then
    update public.companies
    set invoice_series_next = invoice_series_start
    where id = p_company_id
      and invoice_series_start is not null;
  end if;

  -- === RESET INVENTORY (options 2 & 3) ===
  if p_option in ('transactions_inventory', 'factory') then
    select count(*) into v_inv_count from public.inventory_levels where company_id = p_company_id;
    delete from public.lot_genealogy where company_id = p_company_id;
    delete from public.item_cost_history where company_id = p_company_id;
    delete from public.item_serials where company_id = p_company_id;
    delete from public.item_lots where company_id = p_company_id;
    delete from public.inventory_levels where company_id = p_company_id;
    delete from public.production_jobs where company_id = p_company_id;
  end if;

  -- === FACTORY RESET (option 3: also wipe master data, except users/company settings/tax) ===
  if p_option = 'factory' then
    select count(*) into v_cust_count from public.customers where company_id = p_company_id;
    delete from public.production_process_lines where company_id = p_company_id;
    delete from public.production_processes where company_id = p_company_id;
    delete from public.item_bom_lines where company_id = p_company_id;
    delete from public.items where company_id = p_company_id;
    delete from public.customers where company_id = p_company_id;
    delete from public.vendors where company_id = p_company_id;
    delete from public.payment_terms where company_id = p_company_id;
    -- locations: keep the default location; delete non-default ones
    delete from public.locations where company_id = p_company_id;
  end if;

  -- Build result summary
  v_result := jsonb_build_object(
    'option', p_option,
    'transactions_deleted', coalesce(v_txn_count, 0),
    'inventory_cleared', case when p_option in ('transactions_inventory','factory') then true else false end,
    'master_data_cleared', case when p_option = 'factory' then true else false end,
    'bir_series_reset', p_reset_bir_series,
    'performed_at', now()
  );

  -- Write audit log (never deleted; survives any reset option)
  insert into public.maintenance_log(company_id, action, option, performed_by, status, details)
  values (p_company_id, 'reset', p_option, auth.uid(), 'success', v_result);

  return v_result;
end $$;

grant execute on function public.maintenance_reset(uuid, text, boolean) to authenticated;

-- ============================================================
-- NOTES:
-- The 'backups' Supabase Storage bucket must be created via the
-- Supabase dashboard (Storage > New bucket > 'backups', private).
-- Apply RLS policy on storage.objects so only admin members can
-- read/write: add via dashboard or Supabase CLI.
-- ============================================================
