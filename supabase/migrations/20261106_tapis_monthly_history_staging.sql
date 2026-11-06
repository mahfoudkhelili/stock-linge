-- Tapis monthly history: safe staging table and finalization RPC.
-- Run once in Supabase SQL Editor before importing the prepared 6-column CSV.
begin;

create table if not exists public.tapis_monthly_stock_history_staging (
  product_ref text not null,
  month_no integer not null,
  initial_quantity numeric,
  entry_quantity numeric,
  outgoing_quantity numeric,
  final_quantity numeric,
  staged_at timestamptz not null default now()
);

alter table public.tapis_monthly_stock_history_staging enable row level security;
drop policy if exists tapis_monthly_history_staging_admin_all on public.tapis_monthly_stock_history_staging;
create policy tapis_monthly_history_staging_admin_all
  on public.tapis_monthly_stock_history_staging
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_finalize_tapis_monthly_stock_history()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_rows integer; v_products integer; v_months integer; v_duplicates integer;
  v_payload jsonb; v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Accès réservé à l’administrateur actif.';
  end if;

  select count(*), count(distinct trim(product_ref)), count(distinct month_no)
    into v_rows, v_products, v_months
  from public.tapis_monthly_stock_history_staging;

  if v_rows <> 5016 or v_products <> 456 or v_months <> 11 then
    raise exception 'Vérification refusée: lignes %, produits %, mois %. Attendu: 5016, 456, 11.',
      v_rows, v_products, v_months;
  end if;

  select count(*) into v_duplicates
  from (
    select trim(product_ref), month_no
    from public.tapis_monthly_stock_history_staging
    group by trim(product_ref), month_no having count(*) > 1
  ) d;
  if v_duplicates > 0 then
    raise exception 'Import refusé: % doublons référence/mois.', v_duplicates;
  end if;

  if exists (
    select 1 from public.tapis_monthly_stock_history_staging
    where nullif(trim(product_ref), '') is null or month_no not between 1 and 12
  ) then
    raise exception 'Import refusé: référence vide ou mois invalide.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_ref', trim(product_ref), 'month_no', month_no,
    'initial_quantity', initial_quantity, 'entry_quantity', entry_quantity,
    'outgoing_quantity', outgoing_quantity, 'final_quantity', final_quantity
  ) order by product_ref, month_no)
  into v_payload
  from public.tapis_monthly_stock_history_staging;

  v_result := public.admin_import_tapis_monthly_stock_history(v_payload);
  return v_result || jsonb_build_object(
    'products_checked', v_products, 'months_checked', v_months, 'duplicates', v_duplicates
  );
end;
$function$;

revoke all on function public.admin_finalize_tapis_monthly_stock_history() from public;
grant execute on function public.admin_finalize_tapis_monthly_stock_history() to authenticated;
commit;
