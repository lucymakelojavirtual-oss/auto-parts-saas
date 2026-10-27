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
  where t.slug = p_slug and t.status in ('active', 'trial')
  limit 1;
$$;
revoke all on function public.get_public_tenant(text) from public;
grant execute on function public.get_public_tenant(text) to anon, authenticated;
