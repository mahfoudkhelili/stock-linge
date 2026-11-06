-- Allow active authenticated users to read visible Tapis products.
-- Write access remains restricted by the existing admin-only policy.

begin;

grant select on table public.tapis_products to authenticated;

drop policy if exists tapis_products_active_users_select on public.tapis_products;
create policy tapis_products_active_users_select
  on public.tapis_products
  for select
  to authenticated
  using (
    is_active = true
    and is_hidden = false
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.is_active = true
    )
  );

commit;
