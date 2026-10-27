alter table public.products
  add column if not exists cost_price numeric(10,2) not null default 0
    check (cost_price >= 0),
  add column if not exists minimum_stock integer not null default 0
    check (minimum_stock >= 0),
  add column if not exists storage_location text not null default ''
    check (length(storage_location) <= 120);

create or replace function public.is_tenant_product_editor(target_tenant uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (
      public.is_vancely_admin()
      and exists (select 1 from public.tenants where id = target_tenant)
    )
    or exists (
      select 1 from public.tenant_members
      where tenant_id = target_tenant and user_id = (select auth.uid())
        and role in ('owner', 'admin', 'manager', 'staff')
    );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-invoices',
  'tenant-invoices',
  false,
  15728640,
  array['application/pdf', 'application/xml', 'text/xml']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.inventory_receipts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  invoice_number text not null check (length(trim(invoice_number)) between 1 and 50),
  invoice_series text not null default '' check (length(invoice_series) <= 20),
  invoice_access_key text check (
    invoice_access_key is null or invoice_access_key ~ '^[0-9]{44}$'
  ),
  supplier_name text not null default '' check (length(supplier_name) <= 160),
  expected_quantity integer not null check (expected_quantity > 0),
  counted_quantity integer not null check (counted_quantity >= 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  attachment_path text not null unique,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  constraint inventory_receipts_attachment_path_check check (
    attachment_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|xml)$'
  )
);

create index inventory_receipts_tenant_received_idx
  on public.inventory_receipts (tenant_id, received_at desc);
create index inventory_receipts_product_received_idx
  on public.inventory_receipts (product_id, received_at desc);

alter table public.inventory_receipts enable row level security;
revoke all on public.inventory_receipts from public, anon, authenticated;
grant select on public.inventory_receipts to authenticated;
create policy "Product editors read inventory receipts"
  on public.inventory_receipts for select to authenticated
  using (public.is_tenant_product_editor(tenant_id));

create policy "Product editors upload private invoices"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tenant-invoices'
    and exists (
      select 1 from public.tenants t
      where t.id::text = (storage.foldername(name))[1]
        and public.is_tenant_product_editor(t.id)
    )
    and lower(storage.extension(name)) in ('pdf', 'xml')
  );

create policy "Product editors read private invoices"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tenant-invoices'
    and exists (
      select 1 from public.inventory_receipts r
      where r.attachment_path = name
    )
    and exists (
      select 1 from public.tenants t
      where t.id::text = (storage.foldername(name))[1]
        and public.is_tenant_product_editor(t.id)
    )
  );

create policy "Product editors remove unregistered invoices"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tenant-invoices'
    and not exists (
      select 1 from public.inventory_receipts r
      where r.attachment_path = name
    )
    and exists (
      select 1 from public.tenants t
      where t.id::text = (storage.foldername(name))[1]
        and public.is_tenant_product_editor(t.id)
    )
  );

revoke select on public.products from public, anon, authenticated;
grant select (
  id, tenant_id, category_id, sku, name, description, price, stock, image_url,
  compatible_makes, compatible_models, compatible_years, compatible_engines,
  is_published, created_at, updated_at
) on public.products to anon;
grant select (
  id, tenant_id, category_id, sku, name, description, price, stock, image_url,
  compatible_makes, compatible_models, compatible_years, compatible_engines,
  is_published, cost_price, minimum_stock, storage_location, created_at, updated_at
) on public.products to authenticated;

create or replace function public.register_inventory_receipt(
  p_receipt_id uuid,
  p_tenant_id uuid,
  p_product_id uuid,
  p_invoice_number text,
  p_invoice_series text,
  p_invoice_access_key text,
  p_supplier_name text,
  p_expected_quantity integer,
  p_counted_quantity integer,
  p_unit_cost numeric,
  p_attachment_path text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_tenant_product_editor(p_tenant_id) then
    raise exception 'Product editor access required';
  end if;
  if length(trim(coalesce(p_invoice_number, ''))) not between 1 and 50 then
    raise exception 'Invoice number is required and must contain at most 50 characters';
  end if;
  if length(coalesce(p_invoice_series, '')) > 20
    or length(coalesce(p_supplier_name, '')) > 160 then
    raise exception 'Invoice series or supplier name is too long';
  end if;
  if p_invoice_access_key is not null
    and p_invoice_access_key !~ '^[0-9]{44}$' then
    raise exception 'The invoice access key must contain 44 digits';
  end if;
  if p_expected_quantity is null or p_expected_quantity <= 0
    or p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception 'Invoice and counted quantities are invalid';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Unit cost must be zero or greater';
  end if;
  if p_attachment_path is null
    or p_attachment_path !~ (
      '^' || p_tenant_id::text || '/' || p_receipt_id::text || '\.(pdf|xml)$'
    ) then
    raise exception 'Invoice attachment path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'tenant-invoices' and name = p_attachment_path
  ) then
    raise exception 'Upload the invoice PDF or XML before registering the receipt';
  end if;

  perform 1 from public.products
  where id = p_product_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Product not found in this store';
  end if;

  insert into public.inventory_receipts (
    id, tenant_id, product_id, invoice_number, invoice_series,
    invoice_access_key, supplier_name, expected_quantity,
    counted_quantity, unit_cost, attachment_path, received_by
  ) values (
    p_receipt_id, p_tenant_id, p_product_id, trim(p_invoice_number),
    trim(coalesce(p_invoice_series, '')), nullif(trim(coalesce(p_invoice_access_key, '')), ''),
    trim(coalesce(p_supplier_name, '')), p_expected_quantity,
    p_counted_quantity, p_unit_cost, p_attachment_path, auth.uid()
  );

  update public.products
  set stock = stock + p_counted_quantity,
      cost_price = case when p_counted_quantity > 0 then p_unit_cost else cost_price end
  where id = p_product_id and tenant_id = p_tenant_id;

  return p_receipt_id;
end;
$$;

revoke all on function public.register_inventory_receipt(
  uuid, uuid, uuid, text, text, text, text, integer, integer, numeric, text
) from public, anon;
grant execute on function public.register_inventory_receipt(
  uuid, uuid, uuid, text, text, text, text, integer, integer, numeric, text
) to authenticated;
