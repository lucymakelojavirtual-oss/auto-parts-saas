create extension if not exists pgcrypto;

create type public.tenant_role as enum ('owner', 'admin', 'manager', 'staff', 'courier');
create type public.order_status as enum ('approved', 'separating', 'checking', 'delivery', 'delivered', 'cancelled');
create type public.payment_method as enum ('pix', 'card', 'boleto');
create type public.payment_status as enum ('pending', 'paid', 'refunded', 'failed');

create table public.plans (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  monthly_price numeric(10,2) not null check (monthly_price >= 0),
  max_products integer not null check (max_products > 0),
  features jsonb not null default '{}'::jsonb, is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(), name text not null,
  slug text not null unique,
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'cancelled')),
  logo_url text, brand jsonb not null default '{}'::jsonb, address jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostname text not null unique, is_primary boolean not null default false,
  verified_at timestamptz, created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null default 'staff', created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create table public.vehicle_cache (
  plate text primary key check (plate ~ '^[A-Z0-9]{7}$'), make text not null, model text not null,
  year integer not null check (year between 1950 and 2100), motor text not null,
  chassis text, renavam text, created_at timestamptz not null default now()
);

create table public.client_garage (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plate text not null references public.vehicle_cache(plate) on delete cascade, nickname text,
  created_at timestamptz not null default now(), unique (user_id, plate)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null, slug text not null, sort_order integer not null default 0,
  created_at timestamptz not null default now(), unique (tenant_id, slug)
);

create table public.products (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null, sku text not null, name text not null,
  description text, price numeric(10,2) not null check (price >= 0), stock integer not null default 0 check (stock >= 0),
  image_url text, compatible_makes text[] not null default '{}', compatible_models text[] not null default '{}',
  compatible_years integer[] not null default '{}', compatible_engines text[] not null default '{}',
  is_published boolean not null default false, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (tenant_id, sku)
);
create index products_tenant_catalog_idx on public.products (tenant_id, is_published, category_id);
create index products_vehicle_fitment_idx on public.products using gin (compatible_models, compatible_makes, compatible_years);

create table public.product_media (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, storage_path text not null,
  content_type text not null default 'image/webp', byte_size integer not null check (byte_size > 0),
  sort_order integer not null default 0, created_at timestamptz not null default now()
);

create table public.banners (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null, storage_path text not null, target_url text, is_active boolean not null default true,
  starts_at timestamptz, ends_at timestamptz, sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.shipping_rules (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  free_until_km numeric(7,2) not null default 0 check (free_until_km >= 0),
  price_per_km numeric(7,2) not null default 2.50 check (price_per_km >= 0),
  pickup_enabled boolean not null default true, updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  courier_id uuid references auth.users(id) on delete set null,
  status public.order_status not null default 'approved', payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending',
  subtotal numeric(10,2) not null check (subtotal >= 0), shipping_amount numeric(10,2) not null default 0 check (shipping_amount >= 0),
  total numeric(10,2) not null check (total = subtotal + shipping_amount), delivery_address jsonb,
  distance_km numeric(7,2), is_pickup boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index orders_tenant_status_idx on public.orders (tenant_id, status, created_at desc);
create index orders_customer_idx on public.orders (customer_id, created_at desc);

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null, actor_id uuid references auth.users(id) on delete set null,
  note text, created_at timestamptz not null default now()
);
create index order_status_events_timeline_idx on public.order_status_events (order_id, created_at);

create function public.log_order_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_events (order_id, status, actor_id)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$;
create trigger orders_status_history after insert or update of status on public.orders
for each row execute function public.log_order_status();

create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null, product_name text not null, sku text not null,
  quantity integer not null check (quantity > 0), unit_price numeric(10,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.transactions_split (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  gross_amount numeric(10,2) not null check (gross_amount >= 0),
  service_fee_rate numeric(5,4) not null default 0.0800 check (service_fee_rate between 0 and 1),
  service_fee_amount numeric(10,2) not null check (service_fee_amount >= 0),
  merchant_amount numeric(10,2) not null check (merchant_amount >= 0),
  status text not null default 'simulated' check (status in ('simulated', 'pending', 'settled', 'failed', 'refunded')),
  provider_reference text, created_at timestamptz not null default now(),
  check (gross_amount = service_fee_amount + merchant_amount)
);

create table public.plate_lookup_events (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
  plate text not null check (plate ~ '^[A-Z0-9]{7}$'), cache_hit boolean not null,
  simulated_cost numeric(8,2) not null default 0 check (simulated_cost >= 0), created_at timestamptz not null default now(),
  check ((cache_hit and simulated_cost = 0) or (not cache_hit and simulated_cost = 0.07))
);

create table public.delivery_tracking (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180), recorded_at timestamptz not null default now()
);
create index delivery_tracking_order_time_idx on public.delivery_tracking (order_id, recorded_at desc);

create function public.is_tenant_member(target_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members where tenant_id = target_tenant and user_id = (select auth.uid()));
$$;

create function public.is_tenant_manager(target_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_members where tenant_id = target_tenant
    and user_id = (select auth.uid()) and role in ('owner', 'admin', 'manager'));
$$;

create function public.is_vancely_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') = 'vancely_admin', false);
$$;

create function public.is_active_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants where id = target_tenant and status = 'active');
$$;

create function public.get_cached_vehicle(p_plate text)
returns table (plate text, make text, model text, year integer, motor text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select cache.plate, cache.make, cache.model, cache.year, cache.motor, cache.created_at
  from public.vehicle_cache as cache
  where cache.plate = upper(regexp_replace(p_plate, '[^A-Za-z0-9]', '', 'g'));
$$;

create function public.get_client_garage()
returns table (plate text, make text, model text, year integer, motor text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select cache.plate, cache.make, cache.model, cache.year, cache.motor, garage.created_at
  from public.client_garage as garage
  join public.vehicle_cache as cache on cache.plate = garage.plate
  where garage.user_id = (select auth.uid())
  order by garage.created_at desc;
$$;

create function public.record_plate_lookup(p_plate text, p_make text, p_model text, p_year integer,
  p_motor text, p_chassis text default null, p_renavam text default null)
returns table (cache_hit boolean, simulated_cost numeric)
language plpgsql security definer set search_path = '' as $$
declare
  normalized_plate text := upper(regexp_replace(p_plate, '[^A-Za-z0-9]', '', 'g'));
  inserted boolean := false;
begin
  if normalized_plate !~ '^[A-Z0-9]{7}$' then raise exception 'Invalid plate'; end if;
  insert into public.vehicle_cache (plate, make, model, year, motor, chassis, renavam)
    values (normalized_plate, p_make, p_model, p_year, p_motor, p_chassis, p_renavam)
    on conflict (plate) do nothing;
  inserted := found;
  insert into public.plate_lookup_events (user_id, plate, cache_hit, simulated_cost)
    values (auth.uid(), normalized_plate, not inserted, case when inserted then 0.07 else 0);
  return query select not inserted, case when inserted then 0.07::numeric else 0::numeric end;
end;
$$;
revoke all on function public.get_cached_vehicle(text) from public;
grant execute on function public.get_cached_vehicle(text) to authenticated;
revoke all on function public.get_client_garage() from public;
grant execute on function public.get_client_garage() to authenticated;
revoke all on function public.record_plate_lookup(text, text, text, integer, text, text, text) from public;
grant execute on function public.record_plate_lookup(text, text, text, integer, text, text, text) to authenticated;

create function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger tenants_updated_at before update on public.tenants for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger shipping_rules_updated_at before update on public.shipping_rules for each row execute function public.set_updated_at();

alter table public.plans enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.tenant_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.vehicle_cache enable row level security;
alter table public.client_garage enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_media enable row level security;
alter table public.banners enable row level security;
alter table public.shipping_rules enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_items enable row level security;
alter table public.transactions_split enable row level security;
alter table public.plate_lookup_events enable row level security;
alter table public.delivery_tracking enable row level security;

create policy "Active plans are visible" on public.plans for select to authenticated using (is_active or public.is_vancely_admin());
create policy "Vancely manages plans" on public.plans for all to authenticated using (public.is_vancely_admin()) with check (public.is_vancely_admin());
create policy "Tenant members read tenant" on public.tenants for select to authenticated using (public.is_tenant_member(id) or public.is_vancely_admin());
create policy "Vancely manages tenants" on public.tenants for all to authenticated using (public.is_vancely_admin()) with check (public.is_vancely_admin());
create policy "Tenant admins manage domains" on public.tenant_domains for all to authenticated using (public.is_tenant_manager(tenant_id) or public.is_vancely_admin()) with check (public.is_tenant_manager(tenant_id) or public.is_vancely_admin());
create policy "Members read membership" on public.tenant_members for select to authenticated using (user_id = (select auth.uid()) or public.is_tenant_manager(tenant_id) or public.is_vancely_admin());
create policy "Tenant admins manage membership" on public.tenant_members for all to authenticated using (public.is_tenant_manager(tenant_id) or public.is_vancely_admin()) with check (public.is_tenant_manager(tenant_id) or public.is_vancely_admin());
create policy "Members read subscription" on public.subscriptions for select to authenticated using (public.is_tenant_member(tenant_id) or public.is_vancely_admin());
create policy "Vancely manages subscriptions" on public.subscriptions for all to authenticated using (public.is_vancely_admin()) with check (public.is_vancely_admin());
create policy "User manages own garage" on public.client_garage for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Public reads active categories" on public.categories for select to anon, authenticated using (public.is_active_tenant(tenant_id));
create policy "Tenant members manage categories" on public.categories for all to authenticated using (public.is_tenant_manager(tenant_id)) with check (public.is_tenant_manager(tenant_id));
create policy "Public reads published products" on public.products for select to anon, authenticated using (is_published and public.is_active_tenant(tenant_id));
create policy "Tenant members manage products" on public.products for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy "Tenant members manage product media" on public.product_media for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy "Public reads active banners" on public.banners for select to anon, authenticated using (is_active and public.is_active_tenant(tenant_id) and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy "Tenant members manage banners" on public.banners for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy "Public reads shipping rules" on public.shipping_rules for select to anon, authenticated using (public.is_active_tenant(tenant_id));
create policy "Tenant managers manage shipping rules" on public.shipping_rules for all to authenticated using (public.is_tenant_manager(tenant_id)) with check (public.is_tenant_manager(tenant_id));

create policy "Participants read orders" on public.orders for select to authenticated using (customer_id = (select auth.uid()) or courier_id = (select auth.uid()) or public.is_tenant_member(tenant_id) or public.is_vancely_admin());
create policy "Participants read order status history" on public.order_status_events for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or o.courier_id = (select auth.uid()) or public.is_tenant_member(o.tenant_id) or public.is_vancely_admin())));
create policy "Customers create own orders" on public.orders for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "Tenant and courier update orders" on public.orders for update to authenticated using (public.is_tenant_member(tenant_id) or courier_id = (select auth.uid())) with check (public.is_tenant_member(tenant_id) or courier_id = (select auth.uid()));
create policy "Participants read order items" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or o.courier_id = (select auth.uid()) or public.is_tenant_member(o.tenant_id) or public.is_vancely_admin())));
create policy "Customers create order items" on public.order_items for insert to authenticated with check (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())));
create policy "Tenant and Vancely read splits" on public.transactions_split for select to authenticated using (public.is_tenant_member(tenant_id) or public.is_vancely_admin());
create policy "Vancely manages splits" on public.transactions_split for all to authenticated using (public.is_vancely_admin()) with check (public.is_vancely_admin());
create policy "Users read own lookup events" on public.plate_lookup_events for select to authenticated using (user_id = (select auth.uid()) or public.is_vancely_admin());
create policy "Participants read tracking" on public.delivery_tracking for select to authenticated using (courier_id = (select auth.uid()) or exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or public.is_tenant_member(o.tenant_id))));
create policy "Assigned courier inserts tracking" on public.delivery_tracking for insert to authenticated with check (courier_id = (select auth.uid()) and exists (select 1 from public.orders o where o.id = order_id and o.courier_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy "Public reads tenant media" on storage.objects for select to anon, authenticated using (bucket_id = 'tenant-media');
create policy "Members upload WebP tenant media" on storage.objects for insert to authenticated with check (
  bucket_id = 'tenant-media' and (storage.foldername(name))[1] = 'tenants'
  and public.is_tenant_member(((storage.foldername(name))[2])::uuid) and lower(storage.extension(name)) = 'webp'
);
create policy "Members update tenant media" on storage.objects for update to authenticated using (
  bucket_id = 'tenant-media' and public.is_tenant_member(((storage.foldername(name))[2])::uuid)
) with check (bucket_id = 'tenant-media' and public.is_tenant_member(((storage.foldername(name))[2])::uuid));
create policy "Members delete tenant media" on storage.objects for delete to authenticated using (
  bucket_id = 'tenant-media' and public.is_tenant_member(((storage.foldername(name))[2])::uuid)
);