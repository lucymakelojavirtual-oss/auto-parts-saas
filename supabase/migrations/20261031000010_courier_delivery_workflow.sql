create table public.delivery_completions (
  order_id uuid primary key references public.orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  courier_id uuid not null references auth.users(id) on delete restrict,
  note text,
  amount_received numeric(10,2) not null default 0 check (amount_received >= 0),
  payment_method text check (payment_method is null or payment_method in ('cash', 'card', 'pix')),
  proof_path text,
  completed_at timestamptz not null default now(),
  check ((amount_received = 0 and payment_method is null) or (amount_received > 0 and payment_method is not null))
);

alter table public.delivery_completions enable row level security;
revoke all on public.delivery_completions from public, anon, authenticated;
grant select on public.delivery_completions to authenticated;
create policy "Tenant members and assigned couriers read delivery completions"
  on public.delivery_completions for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or courier_id = (select auth.uid())
  );

create or replace function public.accept_delivery(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  current_order public.orders%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Courier authentication required';
  end if;

  select * into current_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = current_order.tenant_id
      and tm.user_id = current_user_id
      and tm.role = 'courier'
  ) then
    raise exception 'Courier is not assigned to this store';
  end if;
  if current_order.is_pickup then
    raise exception 'Customer pickup orders cannot be assigned for delivery';
  end if;
  if current_order.status not in ('approved', 'separating', 'checking', 'delivery') then
    raise exception 'Order is not available for delivery';
  end if;
  if current_order.courier_id is not null and current_order.courier_id <> current_user_id then
    raise exception 'Order has already been accepted by another courier';
  end if;

  update public.orders
  set courier_id = current_user_id, status = 'delivery'
  where id = p_order_id;
end;
$$;
revoke all on function public.accept_delivery(uuid) from public, anon;
grant execute on function public.accept_delivery(uuid) to authenticated;

create or replace function public.complete_delivery(
  p_order_id uuid,
  p_note text,
  p_amount_received numeric,
  p_payment_method text,
  p_proof_path text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  current_order public.orders%rowtype;
  current_user_id uuid := auth.uid();
  received_amount numeric(10,2) := coalesce(p_amount_received, 0);
  normalized_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if current_user_id is null then
    raise exception 'Courier authentication required';
  end if;
  if length(coalesce(p_note, '')) > 1000 then
    raise exception 'Delivery note must contain at most 1000 characters';
  end if;
  if received_amount < 0 then
    raise exception 'Received amount cannot be negative';
  end if;

  select * into current_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = current_order.tenant_id
      and tm.user_id = current_user_id
      and tm.role = 'courier'
  ) or current_order.courier_id is distinct from current_user_id then
    raise exception 'Only the assigned courier can complete this delivery';
  end if;
  if current_order.status <> 'delivery' or current_order.is_pickup then
    raise exception 'Order is not in delivery';
  end if;
  if received_amount > current_order.total then
    raise exception 'Received amount cannot exceed the order total';
  end if;
  if current_order.payment_status = 'paid' and received_amount > 0 then
    raise exception 'This order is already paid through Asaas';
  end if;
  if current_order.payment_status <> 'paid' and received_amount <> current_order.total then
    raise exception 'Record the full order total received before completing an unpaid order';
  end if;
  if received_amount > 0 and p_payment_method not in ('cash', 'card', 'pix') then
    raise exception 'Choose how the delivery amount was received';
  end if;
  if received_amount = 0 and p_payment_method is not null then
    raise exception 'Payment method must be empty when no amount was received';
  end if;
  if p_proof_path is not null and (
    p_proof_path !~ ('^tenants/' || current_order.tenant_id::text || '/delivery-proofs/' || p_order_id::text || '/[^/]+$')
    or not exists (
      select 1 from storage.objects so
      where so.bucket_id = 'delivery-proofs' and so.name = p_proof_path
    )
  ) then
    raise exception 'Delivery proof is invalid or unavailable';
  end if;

  insert into public.delivery_completions (
    order_id, tenant_id, courier_id, note, amount_received, payment_method, proof_path
  ) values (
    p_order_id, current_order.tenant_id, current_user_id, normalized_note,
    received_amount, case when received_amount > 0 then p_payment_method else null end, p_proof_path
  );

  update public.orders set status = 'delivered' where id = p_order_id;
  update public.order_status_events
  set note = normalized_note
  where id = (
    select ose.id from public.order_status_events ose
    where ose.order_id = p_order_id and ose.status = 'delivered'
      and ose.actor_id = current_user_id
    order by ose.created_at desc, ose.id desc
    limit 1
  );
end;
$$;
revoke all on function public.complete_delivery(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.complete_delivery(uuid, text, numeric, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Assigned couriers upload delivery proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[3] = 'delivery-proofs'
    and exists (
      select 1 from public.orders o
      join public.tenant_members tm on tm.tenant_id = o.tenant_id
      where o.id = ((storage.foldername(name))[4])::uuid
        and o.tenant_id = ((storage.foldername(name))[2])::uuid
        and o.courier_id = (select auth.uid())
        and o.status = 'delivery'
        and tm.user_id = (select auth.uid())
        and tm.role = 'courier'
    )
  );

create policy "Tenant members read delivery proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[4])::uuid
        and o.tenant_id = ((storage.foldername(name))[2])::uuid
        and (public.is_tenant_member(o.tenant_id) or o.courier_id = (select auth.uid()))
    )
  );

create policy "Assigned couriers clean up in-progress delivery proofs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from public.orders o
      join public.tenant_members tm on tm.tenant_id = o.tenant_id
      where o.id = ((storage.foldername(name))[4])::uuid
        and o.tenant_id = ((storage.foldername(name))[2])::uuid
        and o.courier_id = (select auth.uid())
        and o.status = 'delivery'
        and tm.user_id = (select auth.uid())
        and tm.role = 'courier'
    )
  );