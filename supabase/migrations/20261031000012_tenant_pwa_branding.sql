create or replace function public.update_tenant_brand_with_pwa(
  p_tenant_id uuid,
  p_app_name text,
  p_primary_color text,
  p_tagline text,
  p_logo_url text,
  p_banners text[],
  p_show_logo_watermark boolean,
  p_app_icon_192_url text,
  p_app_icon_512_url text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_tenant_manager(p_tenant_id) then
    raise exception 'Tenant manager access required';
  end if;
  if p_app_icon_192_url is not null and p_app_icon_192_url !~ (
    '^https://[^/]+/storage/v1/object/public/tenant-media/tenants/'
    || p_tenant_id::text || '/brand/icons/[^/]+\.webp$'
  ) then
    raise exception 'Invalid 192px app icon URL';
  end if;
  if p_app_icon_512_url is not null and p_app_icon_512_url !~ (
    '^https://[^/]+/storage/v1/object/public/tenant-media/tenants/'
    || p_tenant_id::text || '/brand/icons/[^/]+\.webp$'
  ) then
    raise exception 'Invalid 512px app icon URL';
  end if;

  perform public.update_tenant_brand_with_banners(
    p_tenant_id, p_app_name, p_primary_color, p_tagline, p_logo_url,
    p_banners, p_show_logo_watermark
  );

  update public.tenants
  set brand = coalesce(brand, '{}'::jsonb) || jsonb_build_object(
    'app_icon_192_url', p_app_icon_192_url,
    'app_icon_512_url', p_app_icon_512_url
  )
  where id = p_tenant_id;
end;
$$;
revoke all on function public.update_tenant_brand_with_pwa(uuid, text, text, text, text, text[], boolean, text, text) from public, anon;
grant execute on function public.update_tenant_brand_with_pwa(uuid, text, text, text, text, text[], boolean, text, text) to authenticated;

create or replace function public.get_public_tenant(p_slug text)
returns table (id uuid, name text, slug text, logo_url text, whatsapp text, brand jsonb, status text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.slug, t.logo_url, t.whatsapp, jsonb_build_object(
    'app_name', t.brand -> 'app_name',
    'primary_color', t.brand -> 'primary_color',
    'tagline', t.brand -> 'tagline',
    'promotional_banners', case
      when jsonb_typeof(t.brand -> 'promotional_banners') = 'array'
        then t.brand -> 'promotional_banners'
      else '[]'::jsonb
    end,
    'app_icon_192_url', t.brand -> 'app_icon_192_url',
    'app_icon_512_url', t.brand -> 'app_icon_512_url'
  ), t.status::text
  from public.tenants t
  where t.slug = p_slug and t.status in ('active', 'trial')
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
  whatsapp text,
  brand jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_vancely_admin() then
    raise exception 'Administrative access required';
  end if;

  return query
  select t.id, t.name, t.slug, t.status, t.logo_url, t.whatsapp, jsonb_build_object(
    'app_name', t.brand -> 'app_name',
    'primary_color', t.brand -> 'primary_color',
    'tagline', t.brand -> 'tagline',
    'promotional_banners', case
      when jsonb_typeof(t.brand -> 'promotional_banners') = 'array'
        then t.brand -> 'promotional_banners'
      else '[]'::jsonb
    end,
    'app_icon_192_url', t.brand -> 'app_icon_192_url',
    'app_icon_512_url', t.brand -> 'app_icon_512_url'
  )
  from public.tenants t
  where t.slug = p_slug
  limit 1;
end;
$$;
revoke all on function public.get_master_tenant_by_slug(text) from public, anon;
grant execute on function public.get_master_tenant_by_slug(text) to authenticated;