-- Tapis: base de données isolée, avec copie des fonctions métier Linge.
-- À exécuter une seule fois dans Supabase SQL Editor.
-- Aucune donnée Linge n'est copiée dans les tables Tapis.

begin;

-- 1) Tables opérationnelles Tapis, sans lignes Linge.
create table if not exists public.tapis_products
  (like public.products including all);

create table if not exists public.tapis_import_batches
  (like public.import_batches including defaults including generated including identity);

create table if not exists public.tapis_stock_snapshots
  (like public.stock_snapshots including defaults including generated including identity);

-- Historique mensuel indépendant. La structure est copiée depuis le vrai tableau Linge.
create table if not exists public.tapis_monthly_stock_history
  (like public.monthly_stock_history including all);

create table if not exists public.tapis_pdf_stock_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  stock_date date not null,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  rows_updated integer not null default 0,
  products_not_found integer not null default 0,
  is_baseline boolean not null default false
);

create table if not exists public.tapis_pdf_stock_snapshot_rows (
  import_id uuid not null references public.tapis_pdf_stock_imports(id) on delete cascade,
  product_id uuid not null,
  product_ref text,
  product_name text,
  quantity numeric not null,
  primary key (import_id, product_id)
);

create index if not exists tapis_pdf_stock_imports_imported_at_idx
  on public.tapis_pdf_stock_imports (imported_at desc);
create index if not exists tapis_pdf_stock_snapshot_rows_product_idx
  on public.tapis_pdf_stock_snapshot_rows (product_id, import_id);

-- Recréer les clés étrangères vers les tables Tapis, et non vers Linge.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tapis_stock_snapshots_product_id_fkey') then
    alter table public.tapis_stock_snapshots
      add constraint tapis_stock_snapshots_product_id_fkey
      foreign key (product_id) references public.tapis_products(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tapis_stock_snapshots_import_batch_id_fkey') then
    alter table public.tapis_stock_snapshots
      add constraint tapis_stock_snapshots_import_batch_id_fkey
      foreign key (import_batch_id) references public.tapis_import_batches(id) on delete cascade;
  end if;
end $$;

-- 2) RLS: accès direct admin uniquement.
alter table public.tapis_products enable row level security;
alter table public.tapis_import_batches enable row level security;
alter table public.tapis_stock_snapshots enable row level security;
alter table public.tapis_monthly_stock_history enable row level security;
alter table public.tapis_pdf_stock_imports enable row level security;
alter table public.tapis_pdf_stock_snapshot_rows enable row level security;

drop policy if exists tapis_products_admin_all on public.tapis_products;
create policy tapis_products_admin_all on public.tapis_products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tapis_import_batches_admin_all on public.tapis_import_batches;
create policy tapis_import_batches_admin_all on public.tapis_import_batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tapis_stock_snapshots_admin_all on public.tapis_stock_snapshots;
create policy tapis_stock_snapshots_admin_all on public.tapis_stock_snapshots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tapis_monthly_history_admin_all on public.tapis_monthly_stock_history;
create policy tapis_monthly_history_admin_all on public.tapis_monthly_stock_history
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tapis_pdf_imports_admin_all on public.tapis_pdf_stock_imports;
create policy tapis_pdf_imports_admin_all on public.tapis_pdf_stock_imports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tapis_pdf_rows_admin_all on public.tapis_pdf_stock_snapshot_rows;
create policy tapis_pdf_rows_admin_all on public.tapis_pdf_stock_snapshot_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3) Cloner les fonctions réellement installées sur Supabase.
-- Les références aux tables/fonctions Linge sont redirigées vers Tapis.
do $$
declare
  v_source record;
  v_definition text;
  v_replacements text[][] := array[
    array['public.monthly_stock_history','public.tapis_monthly_stock_history'],
    array['public.products','public.tapis_products'],
    array['public.import_batches','public.tapis_import_batches'],
    array['public.stock_snapshots','public.tapis_stock_snapshots'],
    array['public.pdf_stock_imports','public.tapis_pdf_stock_imports'],
    array['public.pdf_stock_snapshot_rows','public.tapis_pdf_stock_snapshot_rows'],
    array['admin_import_historical_stock','admin_import_tapis_historical_stock'],
    array['admin_import_csv_history_prices','admin_import_tapis_csv_history_prices'],
    array['admin_import_pdf_current_stock_with_history','admin_import_tapis_pdf_current_stock_with_history'],
    array['admin_import_pdf_current_stock','admin_import_tapis_pdf_current_stock'],
    array['get_reorder_suggestions','get_tapis_reorder_suggestions'],
    array['get_pdf_stock_decrease_analysis','get_tapis_pdf_stock_decrease_analysis']
  ];
  v_pair text[];
begin
  for v_source in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_import_historical_stock',
        'admin_import_csv_history_prices',
        'admin_import_pdf_current_stock',
        'admin_import_pdf_current_stock_with_history',
        'get_reorder_suggestions',
        'get_pdf_stock_decrease_analysis'
      )
    order by p.proname, p.oid
  loop
    v_definition := pg_get_functiondef(v_source.oid);

    foreach v_pair slice 1 in array v_replacements loop
      v_definition := replace(v_definition, v_pair[1], v_pair[2]);
    end loop;

    -- Rediriger aussi les noms non qualifiés de tables.
    v_definition := regexp_replace(v_definition, '\\mmonthly_stock_history\\M', 'tapis_monthly_stock_history', 'g');
    v_definition := regexp_replace(v_definition, '\\mproducts\\M', 'tapis_products', 'g');
    v_definition := regexp_replace(v_definition, '\\mimport_batches\\M', 'tapis_import_batches', 'g');
    v_definition := regexp_replace(v_definition, '\\mstock_snapshots\\M', 'tapis_stock_snapshots', 'g');
    v_definition := regexp_replace(v_definition, '\\mpdf_stock_imports\\M', 'tapis_pdf_stock_imports', 'g');
    v_definition := regexp_replace(v_definition, '\\mpdf_stock_snapshot_rows\\M', 'tapis_pdf_stock_snapshot_rows', 'g');

    execute v_definition;
  end loop;
end $$;

-- 4) Importer le fichier de mouvements mensuels Tapis.
-- p_rows attend un tableau JSON avec: product_ref, month_no,
-- initial_quantity, entry_quantity, outgoing_quantity, final_quantity.
-- L'import remplace uniquement l'historique mensuel Tapis, jamais celui de Linge.
create or replace function public.admin_import_tapis_monthly_stock_history(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
  v_actor uuid;
begin
  v_actor := auth.uid();

  if v_actor is null or not public.is_admin() then
    raise exception 'Accès réservé à l’administrateur actif.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Le fichier historique Tapis est vide ou invalide.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as x(value)
    where nullif(trim(x.value->>'product_ref'), '') is null
       or coalesce(nullif(trim(x.value->>'month_no'), '')::integer, 0) not between 1 and 12
  ) then
    raise exception 'Chaque ligne doit contenir une référence et un mois entre 1 et 12.';
  end if;

  if exists (
    select 1
    from (
      select trim(value->>'product_ref') as product_ref,
             (value->>'month_no')::integer as month_no
      from jsonb_array_elements(p_rows)
    ) d
    group by product_ref, month_no
    having count(*) > 1
  ) then
    raise exception 'Le fichier contient une référence répétée pour le même mois.';
  end if;

  delete from public.tapis_monthly_stock_history;

  insert into public.tapis_monthly_stock_history (
    product_ref, month_no, initial_quantity,
    entry_quantity, outgoing_quantity, final_quantity
  )
  select
    trim(value->>'product_ref'),
    (value->>'month_no')::integer,
    nullif(replace(trim(coalesce(value->>'initial_quantity','')), ',', '.'), '')::numeric,
    nullif(replace(trim(coalesce(value->>'entry_quantity','')), ',', '.'), '')::numeric,
    nullif(replace(trim(coalesce(value->>'outgoing_quantity','')), ',', '.'), '')::numeric,
    nullif(replace(trim(coalesce(value->>'final_quantity','')), ',', '.'), '')::numeric
  from jsonb_array_elements(p_rows);

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'success', true,
    'rows_imported', v_count,
    'target', 'tapis_monthly_stock_history'
  );
end;
$function$;

-- 5) Créer une baseline PDF Tapis indépendante, si aucune archive n'existe.
do $$
declare
  v_import_id uuid;
begin
  if not exists (select 1 from public.tapis_pdf_stock_imports) then
    insert into public.tapis_pdf_stock_imports
      (file_name, stock_date, imported_by, is_baseline)
    values
      ('BASELINE - stock Tapis avant historique PDF', current_date, auth.uid(), true)
    returning id into v_import_id;

    insert into public.tapis_pdf_stock_snapshot_rows
      (import_id, product_id, product_ref, product_name, quantity)
    select v_import_id, p.id, p.product_ref, p.name, coalesce(p.current_quantity, 0)
    from public.tapis_products p;
  end if;
end $$;

-- 6) Accès RPC authentifié uniquement.
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_import_tapis_historical_stock',
        'admin_import_tapis_csv_history_prices',
        'admin_import_tapis_pdf_current_stock',
        'admin_import_tapis_pdf_current_stock_with_history',
        'get_tapis_reorder_suggestions',
        'get_tapis_pdf_stock_decrease_analysis',
        'admin_import_tapis_monthly_stock_history'
      )
  loop
    execute format('revoke all on function %s from public', v_fn.signature);
    execute format('grant execute on function %s to authenticated', v_fn.signature);
  end loop;
end $$;

commit;
