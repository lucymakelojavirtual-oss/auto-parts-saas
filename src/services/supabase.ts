import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { lookupVehicle as lookupLocalVehicle, mockApiConsultaPlaca, type Vehicle, type VehicleLookup } from './mock'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const tenantId = import.meta.env.VITE_DEMO_TENANT_ID

export const supabase: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

function mapVehicle(row: Record<string, unknown>): Vehicle {
  return {
    plate: String(row.plate), make: String(row.make), model: String(row.model),
    year: Number(row.year), engine: String(row.motor), chassis: String(row.chassis ?? ''),
    renavam: String(row.renavam ?? ''),
  }
}

async function saveToGarage(vehicle: Vehicle) {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('client_garage').upsert(
    { user_id: user.id, plate: vehicle.plate },
    { onConflict: 'user_id,plate', ignoreDuplicates: true },
  )
  if (error) throw error
}

export async function lookupVehicle(rawPlate: string): Promise<VehicleLookup> {
  const plate = rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!supabase) return lookupLocalVehicle(plate)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return lookupLocalVehicle(plate)

  const { data: cached, error: cacheError } = await supabase.rpc('get_cached_vehicle', { p_plate: plate })
  if (cacheError) throw cacheError
  if (cached?.length) {
    const vehicle = mapVehicle(cached[0] as Record<string, unknown>)
    await saveToGarage(vehicle)
    return { vehicle, cacheHit: true, cost: 0 }
  }

  const vehicle = await mockApiConsultaPlaca(plate)
  const { data: result, error: recordError } = await supabase.rpc('record_plate_lookup', {
    p_plate: plate,
    p_make: vehicle.make,
    p_model: vehicle.model,
    p_year: vehicle.year,
    p_motor: vehicle.engine,
    p_chassis: vehicle.chassis,
    p_renavam: vehicle.renavam,
  })
  if (recordError) throw recordError
  const charge = Number(result?.[0]?.simulated_cost ?? 0.07)
  const finalVehicle = charge === 0
    ? await supabase.rpc('get_cached_vehicle', { p_plate: plate }).then(({ data, error }) => {
      if (error) throw error
      return data?.[0] ? mapVehicle(data[0] as Record<string, unknown>) : vehicle
    })
    : vehicle
  await saveToGarage(finalVehicle)
  return { vehicle: finalVehicle, cacheHit: charge === 0, cost: charge }
}

export async function loadClientGarage(): Promise<Vehicle[] | null> {
  if (!supabase) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.rpc('get_client_garage')
  if (error) throw error
  return (data ?? []).map((row: unknown) => mapVehicle(row as Record<string, unknown>))
}

export async function uploadTenantMedia(blob: Blob, simulatedUrl: string, kind: 'banner' | 'product') {
  if (!supabase || !tenantId) return { url: simulatedUrl, simulated: true }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { url: simulatedUrl, simulated: true }

  const path = `tenants/${tenantId}/${kind}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage.from('tenant-media').upload(path, blob, {
    contentType: 'image/webp', upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from('tenant-media').getPublicUrl(path)
  return { url: data.publicUrl, simulated: false }
}