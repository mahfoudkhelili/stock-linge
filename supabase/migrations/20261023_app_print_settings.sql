-- Linge Stock : paramètres centralisés d'impression
create table if not exists public.app_print_settings (
  id integer primary key default 1 check (id = 1),
  invoice_width_cm numeric not null default 10 check (invoice_width_cm > 0 and invoice_width_cm <= 100),
  invoice_height_cm numeric not null default 15 check (invoice_height_cm > 0 and invoice_height_cm <= 100),
  label_width_cm numeric not null default 5 check (label_width_cm > 0 and label_width_cm <= 100),
  label_height_cm numeric not null default 3 check (label_height_cm > 0 and label_height_cm <= 100),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.app_print_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.app_print_settings enable row level security;

drop policy if exists "Authenticated users can read print settings" on public.app_print_settings;
create policy "Authenticated users can read print settings"
on public.app_print_settings for select
to authenticated
using (true);

drop policy if exists "Admins can insert print settings" on public.app_print_settings;
create policy "Admins can insert print settings"
on public.app_print_settings for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update print settings" on public.app_print_settings;
create policy "Admins can update print settings"
on public.app_print_settings for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update on public.app_print_settings to authenticated;
