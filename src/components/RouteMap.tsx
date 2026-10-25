import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type RouteGeometry = {
  type: 'LineString'
  coordinates: [number, number][]
}

export default function RouteMap({ geometry }: { geometry: RouteGeometry }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const map = L.map(containerRef.current).setView([-14.235, -51.9253], 4)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    routeLayerRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      routeLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) return

    const points = geometry.coordinates.map(([longitude, latitude]) => L.latLng(latitude, longitude))
    if (points.length < 2) return

    routeLayer.clearLayers()
    L.polyline(points, { color: '#587523', weight: 5, opacity: 0.85 }).addTo(routeLayer)
    L.circleMarker(points[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#587523', fillOpacity: 1 }).addTo(routeLayer)
    L.circleMarker(points[points.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#c75a35', fillOpacity: 1 }).addTo(routeLayer)
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24] })
  }, [geometry])

  return <div className="route-map" ref={containerRef} role="img" aria-label="Mapa da rota de entrega calculada pelo OpenStreetMap" />
}
