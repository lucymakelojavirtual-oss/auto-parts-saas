create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (
      public.is_vancely_admin()
      and exists (select 1 from public.tenants where id = target_tenant)
    )
    or exists (
      select 1 from public.tenant_members
      where tenant_id = target_tenant and user_id = (select auth.uid())
    );
$$;

create or replace function public.is_tenant_manager(target_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (
      public.is_vancely_admin()
      and exists (select 1 from public.tenants where id = target_tenant)
    )
    or exists (
      select 1 from public.tenant_members
      where tenant_id = target_tenant
        and user_id = (select auth.uid())
        and role in ('owner', 'admin', 'manager')
    );
$$;

create or replace function public.get_master_tenant_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  logo_url text,
  brand jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_vancely_admin() then
    raise exception 'Administrative access required';
  end if;

  return query
  select t.id, t.name, t.slug, t.status, t.logo_url, jsonb_build_object(
    'app_name', t.brand -> 'app_name',
    'primary_color', t.brand -> 'primary_color',
    'tagline', t.brand -> 'tagline'
  )
  from public.tenants t
  where t.slug = p_slug
  limit 1;
end;
$$;

revoke all on function public.get_master_tenant_by_slug(text) from public, anon;
grant execute on function public.get_master_tenant_by_slug(text) to authenticated;

create policy "Vancely manages delivery tracking"
  on public.delivery_tracking for all to authenticated
  using (public.is_vancely_admin())
  with check (public.is_vancely_admin());
