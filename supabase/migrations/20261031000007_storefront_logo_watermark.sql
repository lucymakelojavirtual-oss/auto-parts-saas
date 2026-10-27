create or replace function public.update_tenant_brand_with_banners(
  p_tenant_id uuid,
  p_app_name text,
  p_primary_color text,
  p_tagline text,
  p_logo_url text,
  p_banners text[],
  p_show_logo_watermark boolean
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.update_tenant_brand(
    p_tenant_id, p_app_name, p_primary_color, p_tagline, p_logo_url
  );
  perform public.update_tenant_promotional_banners(p_tenant_id, p_banners);

  update public.tenants
  set brand = coalesce(brand, '{}'::jsonb) || jsonb_build_object(
    'show_logo_watermark', coalesce(p_show_logo_watermark, false)
  )
  where id = p_tenant_id;
end;
$$;
revoke all on function public.update_tenant_brand_with_banners(uuid, text, text, text, text, text[], boolean) from public, anon;
grant execute on function public.update_tenant_brand_with_banners(uuid, text, text, text, text, text[], boolean) to authenticated;
