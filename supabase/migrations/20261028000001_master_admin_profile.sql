create table public.master_admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document text not null check (document ~ '^[0-9]{11}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  updated_at timestamptz not null default now()
);

alter table public.master_admin_profiles enable row level security;
revoke all on public.master_admin_profiles from public, anon, authenticated;
grant select, insert, update on public.master_admin_profiles to authenticated;

create policy "Master admins read own profile"
  on public.master_admin_profiles for select to authenticated
  using (user_id = (select auth.uid()) and public.is_vancely_admin());

create policy "Master admins create own profile"
  on public.master_admin_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_vancely_admin());

create policy "Master admins update own profile"
  on public.master_admin_profiles for update to authenticated
  using (user_id = (select auth.uid()) and public.is_vancely_admin())
  with check (user_id = (select auth.uid()) and public.is_vancely_admin());