-- Linge Stock: historique des quantités de chaque import PDF.
-- Les snapshots PDF sont séparés de stock_snapshots (CSV) et ne modifient ni prix ni historique CSV.

create table if not exists public.pdf_stock_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  stock_date date not null,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  rows_updated integer not null default 0,
  products_not_found integer not null default 0,
  is_baseline boolean not null default false
);

create index if not exists pdf_stock_imports_imported_at_idx
  on public.pdf_stock_imports (imported_at desc);

create table if not exists public.pdf_stock_snapshot_rows (
  import_id uuid not null references public.pdf_stock_imports(id) on delete cascade,
  product_id uuid not null,
  product_ref text,
  product_name text,
  quantity numeric not null,
  primary key (import_id, product_id)
);

create index if not exists pdf_stock_snapshot_rows_product_idx
  on public.pdf_stock_snapshot_rows (product_id, import_id);

alter table public.pdf_stock_imports enable row level security;
alter table public.pdf_stock_snapshot_rows enable row level security;

-- Create one initial baseline from the current products stock.
-- Previous PDF files were not archived by the old importer and cannot be reconstructed automatically.
do $$
declare
  v_import_id uuid;
begin
  if not exists (select 1 from public.pdf_stock_imports) then
    insert into public.pdf_stock_imports
      (file_name, stock_date, imported_by, is_baseline)
    values
      ('BASELINE - stock actuel avant historique PDF', current_date, auth.uid(), true)
    returning id into v_import_id;

    insert into public.pdf_stock_snapshot_rows
      (import_id, product_id, product_ref, product_name, quantity)
    select
      v_import_id, p.id, p.product_ref, p.name, coalesce(p.current_quantity, 0)
    from public.products p;
  end if;
end;
$$;

-- Wrap the existing importer: preserve its established update behavior, then archive
-- a complete post-import snapshot (including products absent from the PDF, already set to zero).
create or replace function public.admin_import_pdf_current_stock_with_history(
  p_file_name text,
  p_snapshot_date date,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_result jsonb;
  v_import_id uuid;
  v_rows_updated integer := 0;
  v_products_not_found integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Accès réservé à l’administrateur';
  end if;

  v_result := public.admin_import_pdf_current_stock(
    p_file_name,
    p_snapshot_date,
    p_rows
  );

  insert into public.pdf_stock_imports
    (file_name, stock_date, imported_by, rows_updated, products_not_found)
  values
    (p_file_name, p_snapshot_date, auth.uid(),
     coalesce((v_result->>'rows_updated')::integer, 0),
     coalesce((v_result->>'products_not_found')::integer, 0))
  returning id into v_import_id;

  insert into public.pdf_stock_snapshot_rows
    (import_id, product_id, product_ref, product_name, quantity)
  select
    v_import_id, p.id, p.product_ref, p.name, coalesce(p.current_quantity, 0)
  from public.products p;

  v_rows_updated := coalesce((v_result->>'rows_updated')::integer, 0);
  v_products_not_found := coalesce((v_result->>'products_not_found')::integer, 0);

  return coalesce(v_result, '{}'::jsonb) ||
    jsonb_build_object(
      'rows_updated', v_rows_updated,
      'products_not_found', v_products_not_found,
      'pdf_import_id', v_import_id
    );
end;
$$;

revoke all on function public.admin_import_pdf_current_stock_with_history(text, date, jsonb) from public;
grant execute on function public.admin_import_pdf_current_stock_with_history(text, date, jsonb) to authenticated;

create or replace function public.get_pdf_stock_decrease_analysis(p_days integer default 1)
returns table (
  product_id uuid,
  product_ref text,
  product_name text,
  previous_quantity numeric,
  current_quantity numeric,
  quantity_decreased numeric,
  previous_date date,
  latest_snapshot_date date,
  days_between integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Accès réservé à l’administrateur';
  end if;

  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'La période doit être comprise entre 1 et 3650 jours';
  end if;

  return query
  with latest_import as (
    select i.*
    from public.pdf_stock_imports i
    order by i.imported_at desc, i.id desc
    limit 1
  ),
  reference_import as (
    select ref.*
    from public.pdf_stock_imports ref
    cross join latest_import latest
    where ref.imported_at <= latest.imported_at - make_interval(days => p_days)
      and ref.imported_at < latest.imported_at
    order by ref.imported_at desc, ref.id desc
    limit 1
  )
  select
    old_row.product_id,
    coalesce(new_row.product_ref, old_row.product_ref),
    coalesce(new_row.product_name, old_row.product_name),
    old_row.quantity,
    new_row.quantity,
    old_row.quantity - new_row.quantity,
    old_import.stock_date,
    new_import.stock_date,
    greatest(0, (new_import.imported_at::date - old_import.imported_at::date)::integer)
  from reference_import old_import
  cross join latest_import new_import
  join public.pdf_stock_snapshot_rows old_row
    on old_row.import_id = old_import.id
  join public.pdf_stock_snapshot_rows new_row
    on new_row.import_id = new_import.id
   and new_row.product_id = old_row.product_id
  where old_row.quantity > new_row.quantity
  order by (old_row.quantity - new_row.quantity) desc, old_row.product_name;
end;
$$;

revoke all on function public.get_pdf_stock_decrease_analysis(integer) from public;
grant execute on function public.get_pdf_stock_decrease_analysis(integer) to authenticated;
