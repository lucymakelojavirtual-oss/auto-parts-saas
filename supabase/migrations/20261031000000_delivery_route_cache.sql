create unique index if not exists delivery_routes_cache_tenant_destination_cep_uidx
  on public.delivery_routes_cache (tenant_id, destination_cep);

alter table public.delivery_routes_cache enable row level security;
revoke all on public.delivery_routes_cache from anon, authenticated;
grant all on public.delivery_routes_cache to service_role;
