alter table public.tenants add column terms_version text;

create function public.capture_tenant_terms_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  onboarding jsonb := auth.jwt() -> 'user_metadata' -> 'vancely_onboarding';
  accepted_version text;
begin
  accepted_version := onboarding ->> 'terms_version';
  if coalesce(onboarding ->> 'terms_accepted', 'false') <> 'true' then
    raise exception 'Terms acceptance is required';
  end if;
  if accepted_version is null or accepted_version <> '2026-10-23-v1' then
    raise exception 'Terms version is invalid or outdated';
  end if;
  new.terms_version := accepted_version;
  return new;
end;
$$;

create trigger tenants_capture_terms_version
  before insert on public.tenants
  for each row execute function public.capture_tenant_terms_version();
