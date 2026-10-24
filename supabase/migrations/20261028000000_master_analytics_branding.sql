create or replace function public.is_vancely_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin_master', 'vancely_admin'),
    false
  );
$$;

create index if not exists orders_tenant_created_idx
  on public.orders (tenant_id, created_at desc);
create index if not exists transactions_split_tenant_created_idx
  on public.transactions_split (tenant_id, created_at desc);
create index if not exists plate_lookup_events_created_idx
  on public.plate_lookup_events (created_at desc);

create or replace function public.get_master_dashboard_analytics()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.is_vancely_admin() then
    raise exception 'Administrative access required';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'stores', (
      select coalesce(jsonb_agg(store_data.value order by store_data.created_at desc), '[]'::jsonb)
      from (
        select t.created_at, jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'slug', t.slug,
          'status', t.status,
          'created_at', t.created_at,
          'plan_name', p.name,
          'monthly_price', p.monthly_price,
          'commission_rate', p.commission_rate,
          'subscription_status', s.status,
          'current_period_end', s.current_period_end,
          'monthly_paid_sales', coalesce(orders.monthly_paid_sales, 0),
          'monthly_paid_orders', coalesce(orders.monthly_paid_orders, 0),
          'monthly_delivered', coalesce(deliveries.monthly_delivered, 0),
          'monthly_delivery_fees', coalesce(deliveries.monthly_delivery_fees, 0),
          'monthly_route_fee_estimate', coalesce(deliveries.monthly_route_fee_estimate, 0),
          'monthly_average_distance_km', deliveries.monthly_average_distance_km,
          'monthly_split_amount', coalesce(split.monthly_split_amount, 0),
          'monthly_split_count', coalesce(split.monthly_split_count, 0),
          'monthly_split_settled', coalesce(split.monthly_split_settled, 0)
        ) as value
        from public.tenants t
        left join public.subscriptions s on s.tenant_id = t.id
        left join public.plans p on p.id = s.plan_id
        left join public.shipping_rules rules on rules.tenant_id = t.id
        left join lateral (
          select
            count(*) filter (
              where o.payment_status = 'paid'
                and o.created_at >= date_trunc('month', now())
            ) as monthly_paid_orders,
            coalesce(sum(o.subtotal) filter (
              where o.payment_status = 'paid'
                and o.created_at >= date_trunc('month', now())
            ), 0) as monthly_paid_sales
          from public.orders o
          where o.tenant_id = t.id
        ) orders on true
        left join lateral (
          select
            count(*) as monthly_delivered,
            coalesce(sum(o.shipping_amount), 0) as monthly_delivery_fees,
            coalesce(sum(
              greatest(o.distance_km - coalesce(rules.free_until_km, 0), 0)
                * coalesce(rules.price_per_km, 0)
            ) filter (
              where not o.is_pickup and o.distance_km is not null
            ), 0) as monthly_route_fee_estimate,
            avg(o.distance_km) filter (where not o.is_pickup) as monthly_average_distance_km
          from public.orders o
          where o.tenant_id = t.id
            and exists (
              select 1
              from public.order_status_events e
              where e.order_id = o.id
                and e.status = 'delivered'
                and e.created_at >= date_trunc('month', now())
                and e.created_at < date_trunc('month', now()) + interval '1 month'
            )
        ) deliveries on true
        left join lateral (
          select
            count(*) filter (
              where x.created_at >= date_trunc('month', now())
                and x.status in ('pending', 'settled')
            ) as monthly_split_count,
            coalesce(sum(x.service_fee_amount) filter (
              where x.created_at >= date_trunc('month', now())
                and x.status in ('pending', 'settled')
            ), 0) as monthly_split_amount,
            coalesce(sum(x.service_fee_amount) filter (
              where x.created_at >= date_trunc('month', now())
                and x.status = 'settled'
            ), 0) as monthly_split_settled
          from public.transactions_split x
          where x.tenant_id = t.id
        ) split on true
      ) store_data
    ),
    'plate_lookups', (
      select jsonb_build_object(
        'daily', count(*) filter (where e.created_at >= date_trunc('day', now())),
        'weekly', count(*) filter (where e.created_at >= date_trunc('week', now())),
        'monthly', count(*) filter (where e.created_at >= date_trunc('month', now())),
        'yearly', count(*) filter (where e.created_at >= date_trunc('year', now())),
        'daily_api', count(*) filter (
          where not e.cache_hit and e.created_at >= date_trunc('day', now())
        ),
        'weekly_api', count(*) filter (
          where not e.cache_hit and e.created_at >= date_trunc('week', now())
        ),
        'monthly_api', count(*) filter (
          where not e.cache_hit and e.created_at >= date_trunc('month', now())
        ),
        'yearly_api', count(*) filter (
          where not e.cache_hit and e.created_at >= date_trunc('year', now())
        ),
        'monthly_api_cost', coalesce(sum(e.simulated_cost) filter (
          where not e.cache_hit and e.created_at >= date_trunc('month', now())
        ), 0),
        'monthly_cache_fee_estimate', count(*) filter (
          where e.cache_hit and e.created_at >= date_trunc('month', now())
        ) * 0.03
      )
      from public.plate_lookup_events e
    ),
    'monthly_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', months.month_start,
        'split_revenue', coalesce(splits.split_revenue, 0),
        'settled_split_revenue', coalesce(splits.settled_split_revenue, 0),
        'renewals_forecast', coalesce(renewals.renewal_count, 0),
        'renewals_forecast_amount', coalesce(renewals.renewal_amount, 0)
      ) order by months.month_start), '[]'::jsonb)
      from (
        select generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          interval '1 month'
        ) as month_start
      ) months
      left join lateral (
        select
          coalesce(sum(x.service_fee_amount) filter (
            where x.status in ('pending', 'settled')
          ), 0) as split_revenue,
          coalesce(sum(x.service_fee_amount) filter (
            where x.status = 'settled'
          ), 0) as settled_split_revenue
        from public.transactions_split x
        where x.created_at >= months.month_start
          and x.created_at < months.month_start + interval '1 month'
      ) splits on true
      left join lateral (
        select count(*) as renewal_count, coalesce(sum(p.monthly_price), 0) as renewal_amount
        from public.subscriptions s
        join public.plans p on p.id = s.plan_id
        where s.status in ('trial', 'active')
          and s.current_period_end >= months.month_start
          and s.current_period_end < months.month_start + interval '1 month'
      ) renewals on true
    )
  );
end;
$$;

revoke all on function public.get_master_dashboard_analytics() from public, anon;
grant execute on function public.get_master_dashboard_analytics() to authenticated;

create or replace function public.update_tenant_brand(
  p_tenant_id uuid,
  p_app_name text,
  p_primary_color text,
  p_tagline text,
  p_logo_url text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_tenant_manager(p_tenant_id) then
    raise exception 'Tenant manager access required';
  end if;
  if length(trim(coalesce(p_app_name, ''))) not between 2 and 60 then
    raise exception 'App name must contain between 2 and 60 characters';
  end if;
  if coalesce(p_primary_color, '') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Primary color must be a six-digit hexadecimal color';
  end if;
  if length(coalesce(p_tagline, '')) > 120 then
    raise exception 'Tagline must contain at most 120 characters';
  end if;
  if p_logo_url is not null and p_logo_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Logo URL must use HTTPS';
  end if;

  update public.tenants
  set logo_url = p_logo_url,
      brand = coalesce(brand, '{}'::jsonb) || jsonb_build_object(
        'app_name', trim(p_app_name),
        'primary_color', lower(p_primary_color),
        'tagline', trim(coalesce(p_tagline, ''))
      )
  where id = p_tenant_id;
  if not found then
    raise exception 'Tenant not found';
  end if;
end;
$$;

revoke all on function public.update_tenant_brand(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_tenant_brand(uuid, text, text, text, text) to authenticated;

drop function public.get_public_tenant(text);
create function public.get_public_tenant(p_slug text)
returns table (id uuid, name text, slug text, logo_url text, brand jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.slug, t.logo_url, jsonb_build_object(
    'app_name', t.brand -> 'app_name',
    'primary_color', t.brand -> 'primary_color',
    'tagline', t.brand -> 'tagline'
  )
  from public.tenants t
  where t.slug = p_slug and t.status = 'active'
  limit 1;
$$;
revoke all on function public.get_public_tenant(text) from public;
grant execute on function public.get_public_tenant(text) to anon, authenticated;
