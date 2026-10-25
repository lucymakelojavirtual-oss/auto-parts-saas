create table if not exists public.delivery_routes_cache (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  origin_cep text not null,
  destination_cep text not null,
  distance_meters double precision not null check (distance_meters >= 0),
  duration_seconds double precision not null check (duration_seconds >= 0),
  geometry jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.delivery_routes_cache
  add column if not exists origin_cep text not null default '',
  add column if not exists geometry jsonb;

drop index if exists public.delivery_routes_cache_tenant_destination_cep_uidx;
create unique index if not exists delivery_routes_cache_tenant_origin_destination_cep_uidx
  on public.delivery_routes_cache (tenant_id, origin_cep, destination_cep);

alter table public.delivery_routes_cache enable row level security;
revoke all on public.delivery_routes_cache from anon, authenticated;
grant all on public.delivery_routes_cache to service_role;

create or replace function public.is_active_tenant(target_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenants
    where id = target_tenant and status in ('active', 'trial')
  );
$$;

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
