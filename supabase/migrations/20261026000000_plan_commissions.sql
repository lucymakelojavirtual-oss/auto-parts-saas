alter table public.plans
  add column commission_rate numeric(5,4) not null default 0.0400
    check (commission_rate between 0 and 1),
  add column monthly_nfe_limit integer not null default 0
    check (monthly_nfe_limit >= 0),
  add column max_sellers integer not null default 0
    check (max_sellers >= 0),
  add column max_couriers integer not null default 0
    check (max_couriers >= 0);

insert into public.plans (
  name, monthly_price, max_products, commission_rate, monthly_nfe_limit,
  max_sellers, max_couriers, features, is_active
) values
  (
    'Essencial', 149.00, 1000, 0.0400, 150, 2, 2,
    '{"focus":"Comece a vender com sua vitrine digital","features":["Até 1.000 produtos","Até 150 NF-e por mês","2 vendedores","2 motoboys"]}'::jsonb,
    true
  ),
  (
    'Aceleração', 299.00, 5000, 0.0250, 500, 5, 5,
    '{"focus":"Mais estrutura para acelerar sua operação","features":["Até 5.000 produtos","Até 500 NF-e por mês","5 vendedores","5 motoboys"]}'::jsonb,
    true
  ),
  (
    'Sede', 699.00, 20000, 0.0150, 2000, 15, 15,
    '{"focus":"Capacidade ampliada para operações em escala","features":["Até 20.000 produtos","Até 2.000 NF-e por mês","15 vendedores","15 motoboys"]}'::jsonb,
    true
  )
on conflict (name) do update set
  monthly_price = excluded.monthly_price,
  max_products = excluded.max_products,
  commission_rate = excluded.commission_rate,
  monthly_nfe_limit = excluded.monthly_nfe_limit,
  max_sellers = excluded.max_sellers,
  max_couriers = excluded.max_couriers,
  features = excluded.features,
  is_active = excluded.is_active;

update public.plans
set is_active = false
where name not in ('Essencial', 'Aceleração', 'Sede');

alter table public.transactions_split
  alter column service_fee_rate drop default;

create function public.record_paid_order_split()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  plan_commission numeric(5,4);
  commission_amount numeric(10,2);
begin
  if new.payment_status <> 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'paid' then
    return new;
  end if;

  select p.commission_rate into plan_commission
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = new.tenant_id
    and s.status in ('trial', 'active')
  order by s.created_at desc
  limit 1;

  if plan_commission is null then
    raise exception 'No active plan commission configured for tenant %', new.tenant_id;
  end if;

  commission_amount := round(new.subtotal * plan_commission, 2);

  insert into public.transactions_split (
    tenant_id, order_id, gross_amount, service_fee_rate,
    service_fee_amount, merchant_amount, status
  ) values (
    new.tenant_id, new.id, new.subtotal, plan_commission,
    commission_amount, new.subtotal - commission_amount, 'pending'
  )
  on conflict (order_id) do nothing;

  return new;
end;
$$;

create trigger orders_record_paid_split
  after insert or update of payment_status on public.orders
  for each row execute function public.record_paid_order_split();
