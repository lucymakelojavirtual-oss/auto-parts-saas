alter table public.delivery_tracking
  add column if not exists heading double precision check (heading is null or heading between 0 and 360);

drop policy if exists "Assigned courier inserts tracking" on public.delivery_tracking;
create policy "Assigned courier inserts tracking"
  on public.delivery_tracking for insert to authenticated
  with check (
    courier_id = (select auth.uid())
    and exists (
      select 1 from public.orders current_order
      where current_order.id = order_id
        and current_order.courier_id = (select auth.uid())
        and current_order.status = 'delivery'
    )
  );

create or replace function public.get_customer_delivery_tracking(p_order_ids uuid[])
returns table (
  order_id uuid,
  latitude double precision,
  longitude double precision,
  heading double precision,
  recorded_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Customer authentication required';
  end if;
  if cardinality(coalesce(p_order_ids, array[]::uuid[])) > 50 then
    raise exception 'A maximum of 50 orders can be tracked at once';
  end if;

  return query
  select distinct on (tracking.order_id)
    tracking.order_id, tracking.latitude, tracking.longitude, tracking.heading, tracking.recorded_at
  from public.delivery_tracking tracking
  join public.orders current_order on current_order.id = tracking.order_id
  where tracking.order_id = any(coalesce(p_order_ids, array[]::uuid[]))
    and current_order.customer_id = auth.uid()
    and current_order.status = 'delivery'
    and tracking.courier_id = current_order.courier_id
  order by tracking.order_id, tracking.recorded_at desc;
end;
$$;
revoke all on function public.get_customer_delivery_tracking(uuid[]) from public, anon;
grant execute on function public.get_customer_delivery_tracking(uuid[]) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'Supabase Realtime publication is unavailable';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'delivery_tracking'
  ) then
    execute 'alter publication supabase_realtime add table public.delivery_tracking';
  end if;
end;
$$;