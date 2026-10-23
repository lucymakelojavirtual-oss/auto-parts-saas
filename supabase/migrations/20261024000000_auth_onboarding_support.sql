alter table public.tenants
  add column cnpj text unique check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  add column legal_name text,
  add column whatsapp text,
  add column owner_name text,
  add column terms_accepted_at timestamptz;

create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_conversations_tenant_updated_idx
  on public.support_conversations (tenant_id, updated_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index support_messages_conversation_created_idx
  on public.support_messages (conversation_id, created_at);

create function public.touch_support_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.support_conversations set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;
create trigger support_message_updates_conversation
  after insert on public.support_messages
  for each row execute function public.touch_support_conversation();

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

create policy "Public reads active plans for registration"
  on public.plans for select to anon using (is_active);
create policy "Support participants read conversations"
  on public.support_conversations for select to authenticated
  using (public.is_vancely_admin() or public.is_tenant_member(tenant_id));
create policy "Tenant members create conversations"
  on public.support_conversations for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_tenant_member(tenant_id));
create policy "Support participants update conversations"
  on public.support_conversations for update to authenticated
  using (public.is_vancely_admin() or public.is_tenant_manager(tenant_id))
  with check (public.is_vancely_admin() or public.is_tenant_manager(tenant_id));
create policy "Support participants read messages"
  on public.support_messages for select to authenticated
  using (exists (
    select 1 from public.support_conversations c
    where c.id = conversation_id
      and (public.is_vancely_admin() or public.is_tenant_member(c.tenant_id))
  ));
create policy "Support participants send messages"
  on public.support_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.support_conversations c
      where c.id = conversation_id
        and (public.is_vancely_admin() or public.is_tenant_member(c.tenant_id))
    )
  );

create function public.complete_tenant_registration()
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  registration jsonb := auth.jwt() -> 'user_metadata' -> 'vancely_onboarding';
  chosen_plan uuid;
  new_tenant_id uuid;
  store_name text;
  store_slug text;
  tax_id text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.tenant_members where user_id = current_user_id) then
    raise exception 'This account already belongs to a store';
  end if;
  if registration is null or registration = 'null'::jsonb then
    raise exception 'Onboarding data not found';
  end if;

  store_name := trim(registration ->> 'store_name');
  tax_id := regexp_replace(coalesce(registration ->> 'cnpj', ''), '[^0-9]', '', 'g');
  chosen_plan := (registration ->> 'plan_id')::uuid;
  if length(store_name) < 2 then raise exception 'Invalid store name'; end if;
  if tax_id !~ '^[0-9]{14}$' then raise exception 'Invalid CNPJ'; end if;
  if coalesce((registration ->> 'terms_accepted')::boolean, false) is not true then
    raise exception 'Terms acceptance is required';
  end if;
  if not exists (select 1 from public.plans where id = chosen_plan and is_active) then
    raise exception 'Selected plan is unavailable';
  end if;

  store_slug := trim(both '-' from regexp_replace(lower(store_name), '[^a-z0-9]+', '-', 'g'));
  if store_slug = '' then store_slug := 'loja'; end if;
  if exists (select 1 from public.tenants where slug = store_slug) then
    store_slug := store_slug || '-' || left(replace(current_user_id::text, '-', ''), 8);
  end if;

  insert into public.tenants (
    name, slug, legal_name, cnpj, whatsapp, owner_name, address, terms_accepted_at
  ) values (
    store_name, store_slug, trim(registration ->> 'legal_name'), tax_id,
    trim(registration ->> 'whatsapp'), trim(registration ->> 'owner_name'),
    jsonb_build_object(
      'street', trim(registration ->> 'street'),
      'number', trim(registration ->> 'number'),
      'city', trim(registration ->> 'city'),
      'state', upper(trim(registration ->> 'state')),
      'postal_code', regexp_replace(coalesce(registration ->> 'postal_code', ''), '[^0-9]', '', 'g')
    ),
    now()
  ) returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (new_tenant_id, current_user_id, 'owner');
  insert into public.subscriptions (tenant_id, plan_id)
    values (new_tenant_id, chosen_plan);
  insert into public.shipping_rules (tenant_id)
    values (new_tenant_id);

  return new_tenant_id;
end;
$$;
revoke all on function public.complete_tenant_registration() from public;
grant execute on function public.complete_tenant_registration() to authenticated;

create function public.get_public_tenant(p_slug text)
returns table (id uuid, name text, slug text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.slug, t.logo_url
  from public.tenants t
  where t.slug = p_slug and t.status = 'active'
  limit 1;
$$;
revoke all on function public.get_public_tenant(text) from public;
grant execute on function public.get_public_tenant(text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'support_conversations'
  ) then
    alter publication supabase_realtime add table public.support_conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end
$$;
