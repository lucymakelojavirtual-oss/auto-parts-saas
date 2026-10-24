create or replace function public.update_tenant_promotional_banners(
  p_tenant_id uuid,
  p_banners text[]
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_tenant_manager(p_tenant_id) then
    raise exception 'Tenant manager access required';
  end if;
  if cardinality(coalesce(p_banners, array[]::text[])) > 5 then
    raise exception 'A maximum of five promotional banners is allowed';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_banners, array[]::text[])) as banner_url
    where banner_url is null or length(banner_url) > 2048
      or banner_url !~ '^https://[^[:space:]]+$'
  ) then
    raise exception 'Promotional banner URLs must use HTTPS';
  end if;

  update public.tenants
  set brand = coalesce(brand, '{}'::jsonb) || jsonb_build_object(
    'promotional_banners', to_jsonb(coalesce(p_banners, array[]::text[]))
  )
  where id = p_tenant_id;
  if not found then
    raise exception 'Tenant not found';
  end if;
end;
$$;
revoke all on function public.update_tenant_promotional_banners(uuid, text[]) from public, anon;
grant execute on function public.update_tenant_promotional_banners(uuid, text[]) to authenticated;

create or replace function public.update_tenant_brand_with_banners(
  p_tenant_id uuid,
  p_app_name text,
  p_primary_color text,
  p_tagline text,
  p_logo_url text,
  p_banners text[]
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.update_tenant_brand(
    p_tenant_id, p_app_name, p_primary_color, p_tagline, p_logo_url
  );
  perform public.update_tenant_promotional_banners(p_tenant_id, p_banners);
end;
$$;
revoke all on function public.update_tenant_brand_with_banners(uuid, text, text, text, text, text[]) from public, anon;
grant execute on function public.update_tenant_brand_with_banners(uuid, text, text, text, text, text[]) to authenticated;

create or replace function public.get_public_tenant(p_slug text)
returns table (id uuid, name text, slug text, logo_url text, brand jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.slug, t.logo_url, jsonb_build_object(
    'app_name', t.brand -> 'app_name',
    'primary_color', t.brand -> 'primary_color',
    'tagline', t.brand -> 'tagline',
    'promotional_banners', case
      when jsonb_typeof(t.brand -> 'promotional_banners') = 'array'
        then t.brand -> 'promotional_banners'
      else '[]'::jsonb
    end
  )
  from public.tenants t
  where t.slug = p_slug and t.status = 'active'
  limit 1;
$$;
revoke all on function public.get_public_tenant(text) from public;
grant execute on function public.get_public_tenant(text) to anon, authenticated;

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
    'tagline', t.brand -> 'tagline',
    'promotional_banners', case
      when jsonb_typeof(t.brand -> 'promotional_banners') = 'array'
        then t.brand -> 'promotional_banners'
      else '[]'::jsonb
    end
  )
  from public.tenants t
  where t.slug = p_slug
  limit 1;
end;
$$;
revoke all on function public.get_master_tenant_by_slug(text) from public, anon;
grant execute on function public.get_master_tenant_by_slug(text) to authenticated;
