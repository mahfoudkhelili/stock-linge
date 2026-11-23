-- Independent catalogue of Tapis ticket labels.
-- This table stores label identity only; it never changes tapis_products stock.
create table if not exists public.tapis_ticket_catalog (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  denomination text not null,
  dimension text not null,
  dessin text not null,
  couleur text not null,
  code_barres text not null,
  source_label text not null default 'camera',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tapis_ticket_catalog_code_barres_nonempty check (length(trim(code_barres)) > 0),
  constraint tapis_ticket_catalog_code_barres_unique unique (code_barres)
);

create index if not exists tapis_ticket_catalog_designation_idx
  on public.tapis_ticket_catalog (type, denomination, dimension);

alter table public.tapis_ticket_catalog enable row level security;

grant select, insert on public.tapis_ticket_catalog to authenticated;

drop policy if exists "Admins can read Tapis ticket catalogue" on public.tapis_ticket_catalog;
create policy "Admins can read Tapis ticket catalogue"
  on public.tapis_ticket_catalog for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.is_active = true
    )
  );

drop policy if exists "Admins can insert Tapis ticket catalogue" on public.tapis_ticket_catalog;
create policy "Admins can insert Tapis ticket catalogue"
  on public.tapis_ticket_catalog for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.is_active = true
    )
  );

comment on table public.tapis_ticket_catalog is
  'Independent Tapis ticket/barcode catalogue. Does not synchronize with or modify official stock.';
