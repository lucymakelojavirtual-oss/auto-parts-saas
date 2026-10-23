export type Vehicle = {
  plate: string
  make: string
  model: string
  year: number
  engine: string
  chassis: string
  renavam: string
}

export type Product = {
  id: string
  name: string
  category: string
  price: number
  stock: number
  image: string
  makes: string[]
  models: string[]
  years: number[]
  engines: string[]
}

export type OrderStatus = 'approved' | 'separating' | 'checking' | 'delivery' | 'delivered'

export const orderSteps: { id: OrderStatus; label: string }[] = [
  { id: 'approved', label: 'Pedido aprovado' },
  { id: 'separating', label: 'Separação no estoque' },
  { id: 'checking', label: 'Conferência' },
  { id: 'delivery', label: 'Com o entregador' },
  { id: 'delivered', label: 'Entregue' },
]

export const initialVehicle: Vehicle = {
  plate: 'CDF1A23', make: 'Fiat', model: 'Uno', year: 2018, engine: '1.0 Fire',
  chassis: '9BD195A62J08•••••', renavam: '011••••••42',
}

export const initialProducts: Product[] = [
  { id: 'p1', name: 'Pastilha de freio dianteira', category: 'Freios', price: 189.9, stock: 12, image: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=700&q=85', makes: ['Fiat'], models: ['Uno', 'Palio', 'Mobi'], years: [2015, 2016, 2017, 2018, 2019, 2020], engines: ['1.0 Fire', '1.4 Fire'] },
  { id: 'p2', name: 'Filtro de óleo Wega', category: 'Filtros', price: 34.5, stock: 28, image: 'https://images.unsplash.com/photo-1635784063382-7e029a81a5da?auto=format&fit=crop&w=700&q=85', makes: ['Fiat', 'Volkswagen'], models: ['Uno', 'Palio', 'Gol', 'Polo'], years: [2014, 2015, 2016, 2017, 2018, 2019, 2020], engines: ['1.0 Fire', '1.4 Fire', '1.0 MPI'] },
  { id: 'p3', name: 'Amortecedor traseiro', category: 'Suspensão', price: 278, stock: 6, image: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=700&q=85', makes: ['Fiat'], models: ['Uno', 'Mobi'], years: [2017, 2018, 2019, 2020, 2021], engines: ['1.0 Fire'] },
  { id: 'p4', name: 'Bateria 60Ah', category: 'Elétrica', price: 429.9, stock: 9, image: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?auto=format&fit=crop&w=700&q=85', makes: ['Fiat', 'Volkswagen', 'Chevrolet', 'Hyundai'], models: ['Uno', 'Palio', 'Gol', 'Onix', 'HB20'], years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021], engines: ['1.0 Fire', '1.4 Fire', '1.0 MPI', '1.0'] },
]

const cacheKey = 'vancely-vehicle-cache-v1'
const vehicleCache = new Map<string, Vehicle>()
try {
  const stored = JSON.parse(localStorage.getItem(cacheKey) ?? '[]') as Vehicle[]
  stored.forEach((vehicle) => vehicleCache.set(vehicle.plate, vehicle))
} catch {
  localStorage.removeItem(cacheKey)
}
vehicleCache.set(initialVehicle.plate, initialVehicle)

export type VehicleLookup = { vehicle: Vehicle; cacheHit: boolean; cost: number }

export async function lookupVehicle(rawPlate: string): Promise<VehicleLookup> {
  const plate = rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (plate.length !== 7) throw new Error('Digite uma placa com 7 caracteres.')
  const cached = vehicleCache.get(plate)
  if (cached) return { vehicle: cached, cacheHit: true, cost: 0 }

  const vehicle = await mockApiConsultaPlaca(plate)
  vehicleCache.set(plate, vehicle)
  localStorage.setItem(cacheKey, JSON.stringify([...vehicleCache.values()]))
  return { vehicle, cacheHit: false, cost: 0.07 }
}

export async function mockApiConsultaPlaca(plate: string): Promise<Vehicle> {
  await new Promise((resolve) => window.setTimeout(resolve, 1000))
  const vehicles = [
    { make: 'Fiat', model: 'Uno', engine: '1.0 Fire' },
    { make: 'Volkswagen', model: 'Gol', engine: '1.0 MPI' },
    { make: 'Chevrolet', model: 'Onix', engine: '1.0' },
    { make: 'Hyundai', model: 'HB20', engine: '1.0' },
  ]
  const fitment = vehicles[plate.charCodeAt(0) % vehicles.length]
  return {
    plate,
    make: fitment.make,
    model: fitment.model,
    year: 2017 + (plate.charCodeAt(1) % 5),
    engine: fitment.engine,
    chassis: `9BW${plate.slice(0, 3)}•••••••••`,
    renavam: `01${plate.charCodeAt(3)}•••••••${plate.charCodeAt(4)}`,
  }
}

export function isCompatible(product: Product, vehicle: Vehicle) {
  return product.makes.includes(vehicle.make) && product.models.includes(vehicle.model) &&
    product.years.includes(vehicle.year) && product.engines.some((engine) => vehicle.engine.startsWith(engine) || engine.startsWith(vehicle.engine))
}

export function calculateShipping(distanceKm: number, freeUntilKm: number, pickup: boolean) {
  if (pickup) return { method: 'Retirada no balcão', price: 0 }
  if (distanceKm <= freeUntilKm) return { method: 'Entrega grátis', price: 0 }
  return { method: 'Entrega expressa', price: Number((distanceKm * 2.5).toFixed(2)) }
}

export function calculateSplit(total: number, feeRate = 0.08) {
  const serviceFee = Number((total * feeRate).toFixed(2))
  return { serviceFee, merchantAmount: Number((total - serviceFee).toFixed(2)), feeRate }
}

export async function optimizeImage(file: File): Promise<{ url: string; blob: Blob; size: number; format: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.')
  const source = await createImageBitmap(file)
  const scale = Math.min(1, 1400 / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  let width = Math.round(source.width * scale)
  let height = Math.round(source.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível otimizar esta imagem.')
  let quality = 0.78
  let blob: Blob | null = null
  while (true) {
    canvas.width = width
    canvas.height = height
    context.drawImage(source, 0, 0, width, height)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob || blob.size <= 4_500_000) break
    if (quality > 0.48) quality -= 0.1
    else if (Math.max(width, height) > 640) {
      width = Math.round(width * 0.8)
      height = Math.round(height * 0.8)
    } else break
  }
  source.close()
  if (!blob) throw new Error('Falha ao converter imagem.')
  if (blob.size > 4_500_000) throw new Error('Esta imagem ainda excede o limite de 4,5 MB após otimização.')
  return { url: URL.createObjectURL(blob), blob, size: blob.size, format: 'WebP' }
}