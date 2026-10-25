import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type RouteGeometry = {
  type: 'LineString'
  coordinates: [number, number][]
}

function parseRouteGeometry(value: unknown): RouteGeometry | null {
  if (!value || typeof value !== 'object') return null
  const geometry = value as { type?: unknown; coordinates?: unknown }
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
    return null
  }

  const coordinates: [number, number][] = []
  for (const coordinate of geometry.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null
    const [longitude, latitude] = coordinate
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return null
    }
    coordinates.push([longitude, latitude])
  }
  return { type: 'LineString', coordinates }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function geocodeCep(cep: string): Promise<[number, number] | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({
    format: 'json',
    q: `${cep}, Brazil`,
    countrycodes: 'br',
    limit: '1',
  }).toString()
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VancelySaaS-App/1.0',
      'Accept-Language': 'pt-BR',
    },
  })
  if (!response.ok) throw new Error(`Nominatim request failed with status ${response.status}`)
  const results: unknown = await response.json()
  if (!Array.isArray(results) || !results[0] || typeof results[0] !== 'object') return null

  const result = results[0] as { lat?: unknown; lon?: unknown }
  const latitude = Number(result.lat)
  const longitude = Number(result.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null
  }
  return [longitude, latitude]
}

async function getOsrmRoute(
  origin: [number, number],
  destination: [number, number],
): Promise<{ distanceMeters: number; durationSeconds: number; geometry: RouteGeometry } | null> {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}`,
  )
  url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson' }).toString()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`OSRM request failed with status ${response.status}`)
  const directions: unknown = await response.json()
  if (!directions || typeof directions !== 'object') return null

  const result = directions as {
    code?: unknown
    routes?: { distance?: unknown; duration?: unknown; geometry?: unknown }[]
  }
  const route = result.routes?.[0]
  const distanceMeters = Number(route?.distance)
  const durationSeconds = Number(route?.duration)
  const geometry = parseRouteGeometry(route?.geometry)
  if (result.code !== 'Ok' || !geometry
    || !Number.isFinite(distanceMeters) || distanceMeters < 0
    || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return null
  }
  return { distanceMeters, durationSeconds, geometry }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
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
      .in('status', ['active', 'trial'])
      .maybeSingle()
    if (tenantError) throw new Error(`Unable to load store address: ${tenantError.message}`)
    if (!tenant) return jsonResponse({ error: 'Store is unavailable' }, 404)

    const originCep = typeof tenant.address?.postal_code === 'string'
      ? tenant.address.postal_code.replace(/\D/g, '')
      : ''
    if (!/^\d{8}$/.test(originCep)) {
      return jsonResponse({ error: 'Store origin CEP is not configured' }, 422)
    }

    const { data: cachedRoute, error: cacheError } = await supabase
      .from('delivery_routes_cache')
      .select('distance_meters, duration_seconds, geometry')
      .eq('tenant_id', tenantId)
      .eq('origin_cep', originCep)
      .eq('destination_cep', destinationCep)
      .maybeSingle()
    if (cacheError) throw new Error(`Unable to read route cache: ${cacheError.message}`)

    let distanceMeters: number
    let durationSeconds: number
    let geometry: RouteGeometry
    const cachedGeometry = parseRouteGeometry(cachedRoute?.geometry)
    const cacheHit = Boolean(cachedRoute && cachedGeometry)

    if (cachedRoute && cachedGeometry) {
      distanceMeters = Number(cachedRoute.distance_meters)
      durationSeconds = Number(cachedRoute.duration_seconds)
      geometry = cachedGeometry
    } else {
      const origin = await geocodeCep(originCep)
      if (!origin) {
        return jsonResponse({ error: 'Store origin CEP could not be located' }, 422)
      }
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const destination = await geocodeCep(destinationCep)
      if (!destination) {
        return jsonResponse({ error: 'Destination CEP could not be located' }, 422)
      }

      const route = await getOsrmRoute(origin, destination)
      if (!route) {
        return jsonResponse({ error: 'No delivery route was found for this CEP' }, 422)
      }
      distanceMeters = route.distanceMeters
      durationSeconds = route.durationSeconds
      geometry = route.geometry
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0
        || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
        throw new Error('OSRM returned invalid route measurements')
      }

      const { error: insertError } = await supabase.from('delivery_routes_cache').upsert({
        tenant_id: tenantId,
        origin_cep: originCep,
        destination_cep: destinationCep,
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
        geometry,
      }, { onConflict: 'tenant_id,origin_cep,destination_cep' })
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
      geometry,
      shipping_amount: Number(shippingAmount),
      cache_hit: cacheHit,
    })
  } catch (error) {
    console.error('Delivery quote failed', error)
    return jsonResponse({ error: 'Unable to calculate delivery quote' }, 500)
  }
})
