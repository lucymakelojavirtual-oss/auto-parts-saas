create table public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  document text not null unique check (document ~ '^[0-9]{11}$|^[0-9]{14}$'),
  phone text not null check (length(phone) between 10 and 15 and phone ~ '^[0-9]+$'),
  postal_code text not null default '' check (postal_code = '' or postal_code ~ '^[0-9]{8}$'),
  street text not null default '' check (length(street) <= 160),
  address_number text not null default '' check (length(address_number) <= 30),
  complement text not null default '' check (length(complement) <= 120),
  district text not null default '' check (length(district) <= 120),
  city text not null default '' check (length(city) <= 120),
  state text not null default '' check (state = '' or state ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from public, anon, authenticated;
grant select on public.customer_profiles to authenticated;
create policy "Customers read own profile"
  on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_valid_br_document(p_document text)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  digits text := regexp_replace(coalesce(p_document, ''), '\D', '', 'g');
  values_array integer[];
  first_digit integer;
  second_digit integer;
  total integer;
  remainder integer;
  index integer;
  weights integer[];
begin
  if digits ~ '^([0-9])\1+$' then
    return false;
  end if;
  if length(digits) = 11 then
    values_array := array(select substring(digits from position for 1)::integer from generate_series(1, 11) as position);
    total := 0;
    for index in 1..9 loop
      total := total + values_array[index] * (11 - index);
    end loop;
    remainder := (total * 10) % 11;
    first_digit := case when remainder = 10 then 0 else remainder end;
    total := 0;
    for index in 1..10 loop
      total := total + values_array[index] * (12 - index);
    end loop;
    remainder := (total * 10) % 11;
    second_digit := case when remainder = 10 then 0 else remainder end;
    return values_array[10] = first_digit and values_array[11] = second_digit;
  elsif length(digits) = 14 then
    values_array := array(select substring(digits from position for 1)::integer from generate_series(1, 14) as position);
    weights := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    total := 0;
    for index in 1..12 loop
      total := total + values_array[index] * weights[index];
    end loop;
    remainder := total % 11;
    first_digit := case when remainder < 2 then 0 else 11 - remainder end;
    weights := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    total := 0;
    for index in 1..13 loop
      total := total + values_array[index] * weights[index];
    end loop;
    remainder := total % 11;
    second_digit := case when remainder < 2 then 0 else 11 - remainder end;
    return values_array[13] = first_digit and values_array[14] = second_digit;
  end if;
  return false;
end;
$$;
revoke all on function public.is_valid_br_document(text) from public, anon, authenticated;

create or replace function public.save_customer_profile(
  p_full_name text,
  p_document text,
  p_phone text,
  p_postal_code text,
  p_street text,
  p_address_number text,
  p_complement text,
  p_district text,
  p_city text,
  p_state text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Customer sign-in required';
  end if;
  if length(trim(coalesce(p_full_name, ''))) not between 2 and 160 then
    raise exception 'Customer name must contain between 2 and 160 characters';
  end if;
  if not public.is_valid_br_document(p_document) then
    raise exception 'Enter a valid CPF or CNPJ';
  end if;
  if regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') !~ '^[0-9]{10,15}$' then
    raise exception 'Enter a valid phone number';
  end if;
  if regexp_replace(coalesce(p_postal_code, ''), '\D', '', 'g') !~ '^[0-9]{8}$' then
    raise exception 'Enter a valid 8-digit postal code';
  end if;
  if length(coalesce(p_street, '')) > 160 or length(coalesce(p_address_number, '')) > 30
    or length(coalesce(p_complement, '')) > 120 or length(coalesce(p_district, '')) > 120
    or length(coalesce(p_city, '')) > 120 or (p_state <> '' and upper(p_state) !~ '^[A-Z]{2}$') then
    raise exception 'Address details are invalid';
  end if;

  insert into public.customer_profiles (
    user_id, full_name, document, phone, postal_code, street,
    address_number, complement, district, city, state
  ) values (
    current_user_id,
    trim(p_full_name),
    regexp_replace(p_document, '\D', '', 'g'),
    regexp_replace(p_phone, '\D', '', 'g'),
    regexp_replace(p_postal_code, '\D', '', 'g'),
    trim(coalesce(p_street, '')),
    trim(coalesce(p_address_number, '')),
    trim(coalesce(p_complement, '')),
    trim(coalesce(p_district, '')),
    trim(coalesce(p_city, '')),
    upper(trim(coalesce(p_state, '')))
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    document = excluded.document,
    phone = excluded.phone,
    postal_code = excluded.postal_code,
    street = excluded.street,
    address_number = excluded.address_number,
    complement = excluded.complement,
    district = excluded.district,
    city = excluded.city,
    state = excluded.state,
    updated_at = now();
end;
$$;
revoke all on function public.save_customer_profile(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_customer_profile(text, text, text, text, text, text, text, text, text, text) to authenticated;

create table public.tenant_payment_accounts (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  asaas_wallet_id text not null check (asaas_wallet_id ~ '^[0-9a-fA-F-]{36}$'),
  updated_at timestamptz not null default now()
);
alter table public.tenant_payment_accounts enable row level security;
revoke all on public.tenant_payment_accounts from public, anon, authenticated;

create or replace function public.get_tenant_asaas_wallet(p_tenant_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_tenant_manager(p_tenant_id) then
    raise exception 'Tenant manager access required';
  end if;
  return (select a.asaas_wallet_id from public.tenant_payment_accounts a where a.tenant_id = p_tenant_id);
end;
$$;
revoke all on function public.get_tenant_asaas_wallet(uuid) from public, anon;
grant execute on function public.get_tenant_asaas_wallet(uuid) to authenticated;

create or replace function public.save_tenant_asaas_wallet(p_tenant_id uuid, p_wallet_id text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_tenant_manager(p_tenant_id) then
    raise exception 'Tenant manager access required';
  end if;
  if coalesce(p_wallet_id, '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'Asaas wallet ID must be a UUID';
  end if;
  insert into public.tenant_payment_accounts (tenant_id, asaas_wallet_id)
  values (p_tenant_id, p_wallet_id)
  on conflict (tenant_id) do update
  set asaas_wallet_id = excluded.asaas_wallet_id, updated_at = now();
end;
$$;
revoke all on function public.save_tenant_asaas_wallet(uuid, text) from public, anon;
grant execute on function public.save_tenant_asaas_wallet(uuid, text) to authenticated;

alter table public.orders
  add column if not exists order_number bigint generated by default as identity,
  add column if not exists customer_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists asaas_checkout_id text,
  add column if not exists asaas_checkout_url text,
  add column if not exists asaas_checkout_status text,
  add column if not exists stock_released_at timestamptz;
create unique index if not exists orders_order_number_uidx on public.orders (order_number);
create unique index if not exists orders_asaas_checkout_id_uidx
  on public.orders (asaas_checkout_id) where asaas_checkout_id is not null;

create table public.asaas_webhook_events (
  event_id text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  checkout_id text not null,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.asaas_webhook_events enable row level security;
revoke all on public.asaas_webhook_events from public, anon, authenticated;

create or replace function public.create_storefront_order(
  p_tenant_id uuid,
  p_items jsonb,
  p_delivery_option text,
  p_delivery_address jsonb,
  p_payment_method text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  customer public.customer_profiles%rowtype;
  tenant public.tenants%rowtype;
  shipping_rules public.shipping_rules%rowtype;
  cart_item record;
  product public.products%rowtype;
  order_id uuid := gen_random_uuid();
  new_order_number bigint;
  subtotal numeric(10,2) := 0;
  route_distance numeric(7,2);
  v_destination_cep text;
  v_origin_cep text;
  item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in or create a customer account before checkout';
  end if;
  select * into customer from public.customer_profiles where user_id = auth.uid();
  if not found then
    raise exception 'Complete your customer profile before checkout';
  end if;
  if p_payment_method is null or p_payment_method not in ('pix', 'card') then
    raise exception 'Choose Pix or credit card through Asaas';
  end if;
  if p_delivery_option is null or p_delivery_option not in ('pickup', 'delivery') then
    raise exception 'Choose pickup or delivery';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Cart must contain between 1 and 30 items';
  end if;
  if jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Cart must contain between 1 and 30 items';
  end if;
  select * into tenant from public.tenants
  where id = p_tenant_id and status = 'active';
  if not found then
    raise exception 'This store is not accepting orders';
  end if;
  select * into shipping_rules from public.shipping_rules where tenant_id = p_tenant_id;
  if not found then
    raise exception 'Store delivery and pickup rules are not configured';
  end if;

  if p_delivery_option = 'pickup' then
    if not shipping_rules.pickup_enabled then
      raise exception 'Store pickup is not available';
    end if;
  else
    v_destination_cep := regexp_replace(coalesce(p_delivery_address ->> 'postal_code', ''), '\D', '', 'g');
    v_origin_cep := regexp_replace(coalesce(tenant.address ->> 'postal_code', ''), '\D', '', 'g');
    if v_destination_cep !~ '^[0-9]{8}$' or v_origin_cep !~ '^[0-9]{8}$' then
      raise exception 'A valid destination and store postal code are required for delivery';
    end if;
    if length(trim(coalesce(p_delivery_address ->> 'street', ''))) = 0
      or length(trim(coalesce(p_delivery_address ->> 'number', ''))) = 0
      or length(trim(coalesce(p_delivery_address ->> 'city', ''))) = 0
      or coalesce(p_delivery_address ->> 'state', '') !~ '^[A-Za-z]{2}$' then
      raise exception 'Complete the delivery address before checkout';
    end if;
    select distance_meters / 1000 into route_distance
    from public.delivery_routes_cache
    where tenant_id = p_tenant_id
      and delivery_routes_cache.origin_cep = v_origin_cep
      and delivery_routes_cache.destination_cep = v_destination_cep
    for share;
    if not found then
      raise exception 'Calculate the delivery quote again before placing the order';
    end if;
    if route_distance < 0 or route_distance > 1000 then
      raise exception 'Calculated route is invalid';
    end if;
  end if;

  for cart_item in
    select (entry ->> 'product_id')::uuid as product_id,
      sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry
    where entry ? 'product_id' and entry ? 'quantity'
    group by (entry ->> 'product_id')::uuid
    order by (entry ->> 'product_id')::uuid
  loop
    if cart_item.quantity is null or cart_item.quantity < 1 then
      raise exception 'Cart quantities must be positive integers';
    end if;
    select * into product from public.products
    where id = cart_item.product_id and tenant_id = p_tenant_id
      and is_published
    for update;
    if not found then
      raise exception 'A product in the cart is no longer available';
    end if;
    if product.stock < cart_item.quantity then
      raise exception 'Insufficient stock for product %', product.name;
    end if;
    subtotal := subtotal + product.price * cart_item.quantity;
    item_count := item_count + 1;
  end loop;
  if item_count = 0 then
    raise exception 'Cart contains no valid products';
  end if;

  insert into public.orders (
    id, tenant_id, customer_id, payment_method, payment_status,
    subtotal, shipping_amount, total, delivery_address, distance_km, is_pickup,
    customer_snapshot
  ) values (
    order_id, p_tenant_id, auth.uid(), p_payment_method::public.payment_method, 'pending',
    subtotal, 0, subtotal, case when p_delivery_option = 'delivery' then p_delivery_address else null end,
    route_distance, p_delivery_option = 'pickup',
    jsonb_build_object(
      'full_name', customer.full_name,
      'document', customer.document,
      'phone', customer.phone,
      'email', (select email from auth.users where id = auth.uid())
    )
  ) returning order_number into new_order_number;

  for cart_item in
    select (entry ->> 'product_id')::uuid as product_id,
      sum((entry ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as entry
    where entry ? 'product_id' and entry ? 'quantity'
    group by (entry ->> 'product_id')::uuid
    order by (entry ->> 'product_id')::uuid
  loop
    select * into product from public.products
    where id = cart_item.product_id and tenant_id = p_tenant_id
    for update;
    insert into public.order_items (
      order_id, product_id, product_name, sku, quantity, unit_price
    ) values (
      order_id, product.id, product.name, product.sku, cart_item.quantity, product.price
    );
    update public.products set stock = stock - cart_item.quantity
    where id = product.id and tenant_id = p_tenant_id;
  end loop;

  return jsonb_build_object(
    'id', order_id,
    'order_number', new_order_number,
    'subtotal', subtotal,
    'shipping_amount', (select shipping_amount from public.orders where id = order_id),
    'total', (select total from public.orders where id = order_id),
    'payment_status', 'pending'
  );
end;
$$;
revoke all on function public.create_storefront_order(uuid, jsonb, text, jsonb, text) from public, anon;
grant execute on function public.create_storefront_order(uuid, jsonb, text, jsonb, text) to authenticated;

create or replace function public.update_storefront_order_checkout(
  p_order_id uuid,
  p_checkout_id text,
  p_checkout_url text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if not exists (
    select 1 from public.orders
    where id = p_order_id
      and payment_status = 'pending' and stock_released_at is null
      and asaas_checkout_id is null
  ) then
    raise exception 'Pending order is unavailable for checkout';
  end if;
  if coalesce(p_checkout_id, '') = ''
    or coalesce(p_checkout_url, '') !~ '^https://[^[:space:]]+$' then
    raise exception 'Asaas checkout response is invalid';
  end if;
  update public.orders set
    asaas_checkout_id = p_checkout_id,
    asaas_checkout_url = p_checkout_url,
    asaas_checkout_status = 'ACTIVE'
  where id = p_order_id
    and payment_status = 'pending' and stock_released_at is null
    and asaas_checkout_id is null;
  if not found then
    raise exception 'Pending order is unavailable for checkout';
  end if;
end;
$$;
revoke all on function public.update_storefront_order_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_storefront_order_checkout(uuid, text, text) to service_role;

create or replace function public.cancel_my_pending_storefront_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.orders set
    status = 'cancelled',
    payment_status = 'failed',
    asaas_checkout_status = 'CANCELED'
  where id = p_order_id and customer_id = auth.uid()
    and payment_status = 'pending' and stock_released_at is null
    and asaas_checkout_id is null;
  if not found then
    raise exception 'Pending order could not be canceled';
  end if;
end;
$$;
revoke all on function public.cancel_my_pending_storefront_order(uuid) from public, anon;
grant execute on function public.cancel_my_pending_storefront_order(uuid) to authenticated;

create or replace function public.release_storefront_order_stock()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.stock_released_at is null and new.stock_released_at is null
    and (new.status = 'cancelled' or new.payment_status in ('failed', 'refunded')) then
    update public.products p
    set stock = p.stock + items.quantity
    from public.order_items items
    where items.order_id = new.id
      and items.product_id = p.id
      and p.tenant_id = new.tenant_id;
    update public.orders set stock_released_at = now() where id = new.id;
  end if;
  return new;
end;
$$;
create trigger orders_release_storefront_stock
  after update of status, payment_status on public.orders
  for each row execute function public.release_storefront_order_stock();

create or replace function public.process_asaas_checkout_event(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_checkout_id text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  current_order public.orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_event_id is null or length(p_event_id) > 200
    or p_event_type not in ('CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED') then
    raise exception 'Invalid Asaas Checkout event';
  end if;
  select * into current_order from public.orders where id = p_order_id for update;
  if not found or current_order.asaas_checkout_id is distinct from p_checkout_id then
    raise exception 'Asaas Checkout does not match an order';
  end if;
  insert into public.asaas_webhook_events (event_id, order_id, checkout_id, event_type)
  values (p_event_id, p_order_id, p_checkout_id, p_event_type)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'CHECKOUT_PAID' then
    if current_order.payment_status = 'pending' and current_order.stock_released_at is null then
      update public.orders set payment_status = 'paid', asaas_checkout_status = 'PAID'
      where id = p_order_id;
    elsif current_order.payment_status <> 'paid' then
      raise exception 'Paid Checkout arrived after the order was canceled or released';
    end if;
  elsif p_event_type in ('CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED')
    and current_order.payment_status = 'pending' then
    update public.orders
    set status = 'cancelled',
        payment_status = 'failed',
        asaas_checkout_status = case when p_event_type = 'CHECKOUT_EXPIRED' then 'EXPIRED' else 'CANCELED' end
    where id = p_order_id;
  end if;
  return true;
end;
$$;
revoke all on function public.process_asaas_checkout_event(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.process_asaas_checkout_event(text, text, uuid, text) to service_role;

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;

drop function public.get_public_tenant(text);
create function public.get_public_tenant(p_slug text)
returns table (id uuid, name text, slug text, logo_url text, brand jsonb, status text)
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
  ), t.status::text
  from public.tenants t
  where t.slug = p_slug and t.status in ('active', 'trial')
  limit 1;
$$;
revoke all on function public.get_public_tenant(text) from public;
grant execute on function public.get_public_tenant(text) to anon, authenticated;
