-- Tapis: base de données isolée, avec copie des fonctions métier Linge.
-- À exécuter une seule fois dans Supabase SQL Editor.
-- Les tables Tapis sont indépendantes : aucune ligne Linge n'est copiée.

begin;

-- 1) Tables séparées, en conservant les colonnes, types, defaults et index Linge.
create table if not exists public.tapis_products
  (like public.products including all);

create table if not exists public.tapis_import_batches
  (like public.import_batches including defaults including generated including identity);

create table if not exists public.tapis_stock_snapshots
  (like public.stock_snapshots including defaults including generated including identity);

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

-- Recreate the essential foreign keys against the Tapis tables.
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

-- 2) RLS: lecture/écriture directe réservée à l'admin; les RPC SECURITY DEFINER
-- clonées ci-dessous font leurs propres vérifications public.is_admin().
alter table public.tapis_products enable row level security;
alter table public.tapis_import_batches enable row level security;
alter table public.tapis_stock_snapshots enable row level security;
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
drop policy if exists tapis_pdf_imports_admin_all on public.tapis_pdf_stock_imports;
create policy tapis_pdf_imports_admin_all on public.tapis_pdf_stock_imports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists tapis_pdf_rows_admin_all on public.tapis_pdf_stock_snapshot_rows;
create policy tapis_pdf_rows_admin_all on public.tapis_pdf_stock_snapshot_rows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3) Clone the real deployed Linge functions from PostgreSQL itself, so the
-- Tapis procedures inherit the exact business rules currently installed in Supabase.
-- Table/function identifiers are redirected to Tapis. This avoids guessing or
-- reimplementing the production logic from incomplete frontend snippets.
do $$
declare
  v_source record;
  v_definition text;
  v_target_name text;
  v_replacements text[][] := array[
    array['public.products','public.tapis_products'],
    array['public.import_batches','public.tapis_import_batches'],
    array['public.stock_snapshots','public.tapis_stock_snapshots'],
    array['public.pdf_stock_imports','public.tapis_pdf_stock_imports'],
    array['public.pdf_stock_snapshot_rows','public.tapis_pdf_stock_snapshot_rows'],
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
    -- Redirect unqualified table references too, without changing compound identifiers
    -- such as product_ref or stock_snapshots_id.
    v_definition := regexp_replace(v_definition, '\mproducts\M', 'tapis_products', 'g');
    v_definition := regexp_replace(v_definition, '\mimport_batches\M', 'tapis_import_batches', 'g');
    v_definition := regexp_replace(v_definition, '\mstock_snapshots\M', 'tapis_stock_snapshots', 'g');
    v_definition := regexp_replace(v_definition, '\mpdf_stock_imports\M', 'tapis_pdf_stock_imports', 'g');
    v_definition := regexp_replace(v_definition, '\mpdf_stock_snapshot_rows\M', 'tapis_pdf_stock_snapshot_rows', 'g');
    -- Do not overwrite any existing Tapis function unexpectedly.
    execute v_definition;
  end loop;
end $$;

-- 4) The history-aware PDF importer gets its own independent Tapis archive.
-- If the source wrapper exists, the cloned wrapper already writes to Tapis history.
-- Create the first Tapis baseline only when there are Tapis products.
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

-- Authenticated users can call the cloned routines; each routine retains the
-- original Linge admin checks from its deployed definition.
grant execute on all functions in schema public to authenticated;

commit;
