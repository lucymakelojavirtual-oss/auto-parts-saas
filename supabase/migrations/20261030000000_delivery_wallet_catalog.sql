alter table public.plans
  add column if not exists monthly_plate_limit integer not null default 0
    check (monthly_plate_limit >= 0);

create table public.tenant_credit_wallets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plate_addon_balance integer not null default 0 check (plate_addon_balance >= 0),
  nfe_addon_balance integer not null default 0 check (nfe_addon_balance >= 0),
  nfe_period_start timestamptz,
  nfe_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table public.tenant_credit_usage (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  plate_used integer not null default 0 check (plate_used >= 0),
  nfe_used integer not null default 0 check (nfe_used >= 0),
  updated_at timestamptz not null default now()
);

create table public.tenant_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  credit_type text not null check (credit_type in ('plate', 'nfe')),
  quantity integer not null check (quantity > 0),
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  payment_reference text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.is_tenant_product_editor(target_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = target_tenant and user_id = (select auth.uid())
      and role in ('owner', 'admin', 'manager', 'staff')
  );
$$;

create or replace function public.is_tenant_catalog_manager(target_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = target_tenant and user_id = (select auth.uid())
      and role in ('owner', 'admin', 'manager')
  );
$$;

drop policy if exists "Tenant members manage products" on public.products;
create policy "Product editors read tenant catalog" on public.products
  for select to authenticated
  using (public.is_tenant_product_editor(tenant_id));
create policy "Product editors create products" on public.products
  for insert to authenticated
  with check (public.is_tenant_product_editor(tenant_id));
create policy "Product editors update products" on public.products
  for update to authenticated
  using (public.is_tenant_product_editor(tenant_id))
  with check (public.is_tenant_product_editor(tenant_id));
create policy "Catalog managers delete products" on public.products
  for delete to authenticated
  using (public.is_tenant_catalog_manager(tenant_id));

drop policy if exists "Tenant members manage categories" on public.categories;
create policy "Tenant managers manage categories" on public.categories
  for all to authenticated
  using (public.is_tenant_catalog_manager(tenant_id))
  with check (public.is_tenant_catalog_manager(tenant_id));

drop policy if exists "Tenant members manage product media" on public.product_media;
create policy "Product editors add product media" on public.product_media
  for insert to authenticated
  with check (public.is_tenant_product_editor(tenant_id));
create policy "Product editors update product media" on public.product_media
  for update to authenticated
  using (public.is_tenant_product_editor(tenant_id))
  with check (public.is_tenant_product_editor(tenant_id));
create policy "Catalog managers delete product media" on public.product_media
  for delete to authenticated using (public.is_tenant_catalog_manager(tenant_id));

drop policy if exists "Members upload WebP tenant media" on storage.objects;
create policy "Store teams upload optimized WebP media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-media'
    and (storage.foldername(name))[1] = 'tenants'
    and lower(storage.extension(name)) = 'webp'
    and (
      (
        (storage.foldername(name))[3] = 'products'
        and public.is_tenant_product_editor(((storage.foldername(name))[2])::uuid)
      )
      or (
        (storage.foldername(name))[3] = 'brand'
        and public.is_tenant_catalog_manager(((storage.foldername(name))[2])::uuid)
      )
    )
  );

drop policy if exists "Members update tenant media" on storage.objects;
create policy "Store teams update optimized WebP media" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-media'
    and (
      (
        (storage.foldername(name))[3] = 'products'
        and public.is_tenant_product_editor(((storage.foldername(name))[2])::uuid)
      )
      or (
        (storage.foldername(name))[3] = 'brand'
        and public.is_tenant_catalog_manager(((storage.foldername(name))[2])::uuid)
      )
    )
  )
  with check (
    bucket_id = 'tenant-media'
    and lower(storage.extension(name)) = 'webp'
    and (
      (
        (storage.foldername(name))[3] = 'products'
        and public.is_tenant_product_editor(((storage.foldername(name))[2])::uuid)
      )
      or (
        (storage.foldername(name))[3] = 'brand'
        and public.is_tenant_catalog_manager(((storage.foldername(name))[2])::uuid)
      )
    )
  );

drop policy if exists "Members delete tenant media" on storage.objects;
create policy "Store teams delete optimized WebP media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-media'
    and (
      (
        (storage.foldername(name))[3] = 'products'
        and public.is_tenant_catalog_manager(((storage.foldername(name))[2])::uuid)
      )
      or (
        (storage.foldername(name))[3] = 'brand'
        and public.is_tenant_catalog_manager(((storage.foldername(name))[2])::uuid)
      )
    )
  );

alter table public.tenant_credit_wallets enable row level security;
alter table public.tenant_credit_usage enable row level security;
alter table public.tenant_credit_purchases enable row level security;

create policy "Store teams read credit wallets" on public.tenant_credit_wallets
  for select to authenticated using (public.is_tenant_product_editor(tenant_id));
create policy "Store teams read credit usage" on public.tenant_credit_usage
  for select to authenticated using (public.is_tenant_product_editor(tenant_id));
create policy "Store managers read credit purchases" on public.tenant_credit_purchases
  for select to authenticated using (public.is_tenant_catalog_manager(tenant_id));

create or replace function public.quote_delivery_fee(p_tenant_id uuid, p_distance_km numeric)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  rules public.shipping_rules%rowtype;
begin
  if p_distance_km is null or p_distance_km < 0 then
    raise exception 'A valid route distance is required';
  end if;
  select * into rules from public.shipping_rules where tenant_id = p_tenant_id;
  if not found then raise exception 'Shipping rules are not configured for this store'; end if;
  return round(greatest(p_distance_km - rules.free_until_km, 0) * rules.price_per_km, 2);
end;
$$;
revoke all on function public.quote_delivery_fee(uuid, numeric) from public;
grant execute on function public.quote_delivery_fee(uuid, numeric) to anon, authenticated;

create or replace function public.apply_order_delivery_fee()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_pickup then
    new.shipping_amount := 0;
  else
    if new.distance_km is null then
      raise exception 'A route distance is required before placing a delivery order';
    end if;
    new.shipping_amount := public.quote_delivery_fee(new.tenant_id, new.distance_km);
  end if;
  new.total := new.subtotal + new.shipping_amount;
  return new;
end;
$$;
create trigger orders_calculate_delivery_fee
  before insert or update of tenant_id, distance_km, is_pickup, subtotal, shipping_amount
  on public.orders for each row execute function public.apply_order_delivery_fee();

create or replace function public.tenant_credit_status(p_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cycle record;
  usage_row public.tenant_credit_usage%rowtype;
  wallet_row public.tenant_credit_wallets%rowtype;
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_tenant_product_editor(p_tenant_id) then
    raise exception 'Store team access required';
  end if;
  select s.current_period_start, s.current_period_end,
         p.monthly_plate_limit, p.monthly_nfe_limit
    into cycle
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = p_tenant_id and s.status in ('trial', 'active');
  if not found then raise exception 'An active subscription is required'; end if;

  select * into usage_row from public.tenant_credit_usage
   where tenant_id = p_tenant_id and period_start = cycle.current_period_start
     and period_end = cycle.current_period_end;
  select * into wallet_row from public.tenant_credit_wallets where tenant_id = p_tenant_id;

  return jsonb_build_object(
    'period_start', cycle.current_period_start,
    'period_end', cycle.current_period_end,
    'plates', jsonb_build_object(
      'monthly_limit', cycle.monthly_plate_limit,
      'monthly_used', coalesce(usage_row.plate_used, 0),
      'addon_balance', coalesce(wallet_row.plate_addon_balance, 0)
    ),
    'nfe', jsonb_build_object(
      'monthly_limit', cycle.monthly_nfe_limit,
      'monthly_used', coalesce(usage_row.nfe_used, 0),
      'addon_balance', case
        when wallet_row.nfe_period_start = cycle.current_period_start
          and wallet_row.nfe_period_end = cycle.current_period_end
        then coalesce(wallet_row.nfe_addon_balance, 0)
        else 0
      end
    )
  );
end;
$$;
revoke all on function public.tenant_credit_status(uuid) from public, anon;
grant execute on function public.tenant_credit_status(uuid) to authenticated;

create or replace function public.consume_tenant_credit(p_tenant_id uuid, p_credit_type text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cycle record;
  wallet_row public.tenant_credit_wallets%rowtype;
  used_count integer;
  monthly_limit integer;
  addon_balance integer;
begin
  if p_credit_type is null or p_credit_type not in ('plate', 'nfe') then
    raise exception 'Credit type must be plate or nfe';
  end if;
  if auth.role() is distinct from 'service_role'
     and not public.is_tenant_product_editor(p_tenant_id) then
    raise exception 'Store team access required';
  end if;

  select s.current_period_start, s.current_period_end,
         p.monthly_plate_limit, p.monthly_nfe_limit
    into cycle
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = p_tenant_id and s.status in ('trial', 'active')
   for update of s;
  if not found then raise exception 'An active subscription is required'; end if;

  insert into public.tenant_credit_usage (tenant_id, period_start, period_end)
    values (p_tenant_id, cycle.current_period_start, cycle.current_period_end)
  on conflict (tenant_id) do update set
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    plate_used = case when public.tenant_credit_usage.period_start = excluded.period_start
      and public.tenant_credit_usage.period_end = excluded.period_end
      then public.tenant_credit_usage.plate_used else 0 end,
    nfe_used = case when public.tenant_credit_usage.period_start = excluded.period_start
      and public.tenant_credit_usage.period_end = excluded.period_end
      then public.tenant_credit_usage.nfe_used else 0 end,
    updated_at = now();

  insert into public.tenant_credit_wallets (tenant_id)
    values (p_tenant_id) on conflict (tenant_id) do nothing;
  select * into wallet_row from public.tenant_credit_wallets
   where tenant_id = p_tenant_id for update;

  if wallet_row.nfe_period_start is distinct from cycle.current_period_start
     or wallet_row.nfe_period_end is distinct from cycle.current_period_end then
    update public.tenant_credit_wallets set nfe_addon_balance = 0,
      nfe_period_start = cycle.current_period_start,
      nfe_period_end = cycle.current_period_end, updated_at = now()
    where tenant_id = p_tenant_id returning * into wallet_row;
  end if;

  if p_credit_type = 'plate' then
    monthly_limit := cycle.monthly_plate_limit;
    select plate_used into used_count from public.tenant_credit_usage
     where tenant_id = p_tenant_id for update;
    if used_count < monthly_limit then
      update public.tenant_credit_usage set plate_used = plate_used + 1, updated_at = now()
       where tenant_id = p_tenant_id;
      used_count := used_count + 1;
    else
      if wallet_row.plate_addon_balance < 1 then raise exception 'No plate lookup credits remaining'; end if;
      update public.tenant_credit_wallets set plate_addon_balance = plate_addon_balance - 1,
        updated_at = now() where tenant_id = p_tenant_id returning plate_addon_balance into addon_balance;
    end if;
  else
    monthly_limit := cycle.monthly_nfe_limit;
    select nfe_used into used_count from public.tenant_credit_usage
     where tenant_id = p_tenant_id for update;
    if used_count < monthly_limit then
      update public.tenant_credit_usage set nfe_used = nfe_used + 1, updated_at = now()
       where tenant_id = p_tenant_id;
      used_count := used_count + 1;
    else
      if wallet_row.nfe_addon_balance < 1 then raise exception 'No NF-e credits remaining in this billing cycle'; end if;
      update public.tenant_credit_wallets set nfe_addon_balance = nfe_addon_balance - 1,
        updated_at = now() where tenant_id = p_tenant_id returning nfe_addon_balance into addon_balance;
    end if;
  end if;

  return public.tenant_credit_status(p_tenant_id);
end;
$$;
revoke all on function public.consume_tenant_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_tenant_credit(uuid, text) to service_role;

create or replace function public.grant_tenant_credits(
  p_tenant_id uuid,
  p_credit_type text,
  p_quantity integer,
  p_payment_reference text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  cycle record;
  existing_purchase public.tenant_credit_purchases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server-side payment confirmation required'; end if;
  if p_credit_type is null or p_credit_type not in ('plate', 'nfe')
     or p_quantity is null or p_quantity <= 0
     or length(trim(coalesce(p_payment_reference, ''))) = 0 then
    raise exception 'Invalid credit purchase';
  end if;
  select current_period_start, current_period_end into cycle
    from public.subscriptions
   where tenant_id = p_tenant_id and status in ('trial', 'active') for update;
  if not found then raise exception 'An active subscription is required'; end if;

  insert into public.tenant_credit_purchases (
    tenant_id, credit_type, quantity, billing_period_start, billing_period_end, payment_reference
  ) values (
    p_tenant_id, p_credit_type, p_quantity,
    case when p_credit_type = 'nfe' then cycle.current_period_start end,
    case when p_credit_type = 'nfe' then cycle.current_period_end end,
    trim(p_payment_reference)
  ) on conflict (payment_reference) do nothing;
  if not found then
    select * into existing_purchase from public.tenant_credit_purchases
     where payment_reference = trim(p_payment_reference);
    if existing_purchase.tenant_id is distinct from p_tenant_id
       or existing_purchase.credit_type is distinct from p_credit_type
       or existing_purchase.quantity is distinct from p_quantity then
      raise exception 'Payment reference was already applied to a different credit purchase';
    end if;
    return;
  end if;

  insert into public.tenant_credit_wallets (
    tenant_id, plate_addon_balance, nfe_addon_balance, nfe_period_start, nfe_period_end
  ) values (
    p_tenant_id,
    case when p_credit_type = 'plate' then p_quantity else 0 end,
    case when p_credit_type = 'nfe' then p_quantity else 0 end,
    cycle.current_period_start, cycle.current_period_end
  ) on conflict (tenant_id) do update set
    plate_addon_balance = public.tenant_credit_wallets.plate_addon_balance
      + case when p_credit_type = 'plate' then p_quantity else 0 end,
    nfe_addon_balance = case
      when public.tenant_credit_wallets.nfe_period_start = cycle.current_period_start
       and public.tenant_credit_wallets.nfe_period_end = cycle.current_period_end
      then public.tenant_credit_wallets.nfe_addon_balance
        + case when p_credit_type = 'nfe' then p_quantity else 0 end
      else case when p_credit_type = 'nfe' then p_quantity else 0 end
    end,
    nfe_period_start = cycle.current_period_start,
    nfe_period_end = cycle.current_period_end,
    updated_at = now();
end;
$$;
revoke all on function public.grant_tenant_credits(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.grant_tenant_credits(uuid, text, integer, text) to service_role;

create or replace function public.reset_cycle_credits()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.current_period_start is distinct from old.current_period_start
     or new.current_period_end is distinct from old.current_period_end then
    insert into public.tenant_credit_usage (tenant_id, period_start, period_end, plate_used, nfe_used)
      values (new.tenant_id, new.current_period_start, new.current_period_end, 0, 0)
    on conflict (tenant_id) do update set period_start = excluded.period_start,
      period_end = excluded.period_end, plate_used = 0, nfe_used = 0, updated_at = now();
    insert into public.tenant_credit_wallets (
      tenant_id, nfe_addon_balance, nfe_period_start, nfe_period_end
    ) values (new.tenant_id, 0, new.current_period_start, new.current_period_end)
    on conflict (tenant_id) do update set nfe_addon_balance = 0,
      nfe_period_start = excluded.nfe_period_start, nfe_period_end = excluded.nfe_period_end,
      updated_at = now();
  end if;
  return new;
end;
$$;
create trigger subscriptions_reset_cycle_credits
  after update of current_period_start, current_period_end on public.subscriptions
  for each row execute function public.reset_cycle_credits();

drop function public.record_plate_lookup(text, text, text, integer, text, text, text);
create function public.record_plate_lookup(
  p_plate text,
  p_make text,
  p_model text,
  p_year integer,
  p_motor text,
  p_chassis text default null,
  p_renavam text default null,
  p_tenant_id uuid default null
)
returns table (cache_hit boolean, simulated_cost numeric)
language plpgsql security definer set search_path = '' as $$
declare
  normalized_plate text := upper(regexp_replace(p_plate, '[^A-Za-z0-9]', '', 'g'));
  lookup_tenant uuid := p_tenant_id;
  inserted boolean := false;
begin
  if normalized_plate !~ '^[A-Z0-9]{7}$' then raise exception 'Invalid plate'; end if;
  if lookup_tenant is null then
    select tenant_id into lookup_tenant from public.tenant_members
     where user_id = (select auth.uid()) and role <> 'courier'
     order by created_at desc limit 1;
  end if;
  if lookup_tenant is null or not public.is_tenant_product_editor(lookup_tenant) then
    raise exception 'A store team membership is required for plate lookups';
  end if;
  perform public.consume_tenant_credit(lookup_tenant, 'plate');
  insert into public.vehicle_cache (plate, make, model, year, motor, chassis, renavam)
    values (normalized_plate, p_make, p_model, p_year, p_motor, p_chassis, p_renavam)
    on conflict (plate) do nothing;
  inserted := found;
  insert into public.plate_lookup_events (user_id, plate, cache_hit, simulated_cost)
    values (auth.uid(), normalized_plate, not inserted, case when inserted then 0.07 else 0 end);
  return query select not inserted, case when inserted then 0.07::numeric else 0::numeric end;
end;
$$;
revoke all on function public.record_plate_lookup(text, text, text, integer, text, text, text, uuid) from public;
grant execute on function public.record_plate_lookup(text, text, text, integer, text, text, text, uuid) to authenticated;
