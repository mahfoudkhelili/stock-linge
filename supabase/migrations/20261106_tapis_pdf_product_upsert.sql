-- Tapis PDF importer: create/update product master records, then archive a full Tapis-only snapshot.
begin;

-- Keep the original isolated importer as an internal implementation.
do $$
begin
  if to_regprocedure('public.admin_import_tapis_pdf_current_stock_with_history_legacy(text,date,jsonb)') is null
     and to_regprocedure('public.admin_import_tapis_pdf_current_stock_with_history(text,date,jsonb)') is not null then
    alter function public.admin_import_tapis_pdf_current_stock_with_history(text,date,jsonb)
      rename to admin_import_tapis_pdf_current_stock_with_history_legacy;
  end if;
end $$;

create or replace function public.admin_import_tapis_pdf_current_stock_with_history(
  p_file_name text,
  p_snapshot_date date,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_actor uuid;
  v_rows integer;
begin
  v_actor := auth.uid();
  if v_actor is null or not public.is_admin() then
    raise exception 'Accès réservé à l’administrateur actif.';
  end if;

  if p_snapshot_date is null then
    raise exception 'La date du stock est obligatoire.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Le PDF Tapis ne contient aucune ligne produit exploitable.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as x(value)
    where nullif(trim(x.value->>'product_ref'), '') is null
       or nullif(trim(x.value->>'name'), '') is null
       or nullif(trim(x.value->>'quantity'), '') is null
       or replace(replace(trim(coalesce(x.value->>'quantity','')), ' ', ''), ',', '.') !~ '^-?[0-9]+(\\.[0-9]+)?$'
  ) then
    raise exception 'Chaque ligne PDF doit contenir un code, un nom et une quantité numérique.';
  end if;

  if exists (
    select 1
    from (
      select upper(trim(value->>'product_ref')) as product_ref
      from jsonb_array_elements(p_rows)
    ) d
    group by product_ref
    having count(*) > 1
  ) then
    raise exception 'Le PDF contient des références produit en double.';
  end if;

  insert into public.tapis_products (product_ref, name, current_quantity, is_active)
  select
    trim(value->>'product_ref'),
    trim(value->>'name'),
    replace(replace(trim(value->>'quantity'), ' ', ''), ',', '.')::numeric,
    true
  from jsonb_array_elements(p_rows)
  on conflict (product_ref) do update
    set name = excluded.name,
        current_quantity = excluded.current_quantity,
        is_active = true;

  get diagnostics v_rows = row_count;

  v_result := public.admin_import_tapis_pdf_current_stock_with_history_legacy(
    p_file_name, p_snapshot_date, p_rows
  );

  return coalesce(v_result, '{}'::jsonb) ||
    jsonb_build_object('products_created_or_refreshed', v_rows);
end;
$function$;

revoke all on function public.admin_import_tapis_pdf_current_stock_with_history(text,date,jsonb) from public;
grant execute on function public.admin_import_tapis_pdf_current_stock_with_history(text,date,jsonb) to authenticated;

commit;
