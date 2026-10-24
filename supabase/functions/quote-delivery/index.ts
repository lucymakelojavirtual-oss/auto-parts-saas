import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const mapsApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!supabaseUrl || !serviceRoleKey || !mapsApiKey) {
      throw new Error('Delivery quote service is not fully configured')
    }

    const body = await request.json()
    const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : ''
    const destinationCep = typeof body.destination_cep === 'string'
      ? body.destination_cep.replace(/\D/g, '')
      : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
      || !/^\d{8}$/.test(destinationCep)) {
      return jsonResponse({ error: 'A valid store and destination CEP are required' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, address')
      .eq('id', tenantId)
      .eq('status', 'active')
      .maybeSingle()
    if (tenantError) throw new Error(`Unable to load store address: ${tenantError.message}`)
    if (!tenant) return jsonResponse({ error: 'Store is unavailable' }, 404)

    const { data: cachedRoute, error: cacheError } = await supabase
      .from('delivery_routes_cache')
      .select('distance_meters, duration_seconds')
      .eq('tenant_id', tenantId)
      .eq('destination_cep', destinationCep)
      .maybeSingle()
    if (cacheError) throw new Error(`Unable to read route cache: ${cacheError.message}`)

    let distanceMeters: number
    let durationSeconds: number
    const cacheHit = Boolean(cachedRoute)

    if (cachedRoute) {
      distanceMeters = Number(cachedRoute.distance_meters)
      durationSeconds = Number(cachedRoute.duration_seconds)
    } else {
      const origin = tenant.address?.postal_code
      if (typeof origin !== 'string' || origin.replace(/\D/g, '').length !== 8) {
        return jsonResponse({ error: 'Store origin CEP is not configured' }, 422)
      }

      const directionsUrl = new URL('https://maps.googleapis.com/maps/api/directions/json')
      directionsUrl.search = new URLSearchParams({
        origin: `${origin.replace(/\D/g, '')}, Brazil`,
        destination: `${destinationCep}, Brazil`,
        region: 'br',
        language: 'pt-BR',
        key: mapsApiKey,
      }).toString()
      const mapsResponse = await fetch(directionsUrl)
      if (!mapsResponse.ok) throw new Error(`Google Maps request failed with status ${mapsResponse.status}`)
      const directions = await mapsResponse.json()
      const route = directions.routes?.[0]?.legs?.[0]
      if (directions.status !== 'OK' || !route) {
        return jsonResponse({ error: 'No delivery route was found for this CEP' }, 422)
      }
      distanceMeters = Number(route.distance?.value)
      durationSeconds = Number(route.duration?.value)
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0
        || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
        throw new Error('Google Maps returned invalid route measurements')
      }

      const { error: insertError } = await supabase.from('delivery_routes_cache').upsert({
        tenant_id: tenantId,
        destination_cep: destinationCep,
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
      }, { onConflict: 'tenant_id,destination_cep' })
      if (insertError) throw new Error(`Unable to save route cache: ${insertError.message}`)
    }

    if (!Number.isFinite(distanceMeters) || distanceMeters < 0
      || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
      throw new Error('Cached route has invalid measurements')
    }

    const { data: shippingAmount, error: feeError } = await supabase.rpc('quote_delivery_fee', {
      p_tenant_id: tenantId,
      p_distance_km: distanceMeters / 1000,
    })
    if (feeError) throw new Error(`Unable to calculate delivery fee: ${feeError.message}`)

    return jsonResponse({
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      distance_km: distanceMeters / 1000,
      shipping_amount: Number(shippingAmount),
      cache_hit: cacheHit,
    })
  } catch (error) {
    console.error('Delivery quote failed', error)
    return jsonResponse({ error: 'Unable to calculate delivery quote' }, 500)
  }
})
