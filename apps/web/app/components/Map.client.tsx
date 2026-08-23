import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, ChevronDown, ChevronUp, Flame, Zap, TreePine, Wheat, Droplets, HelpCircle } from 'lucide-react';

export interface AnomalyPoint {
    id?: number;
    latitude: number;
    longitude: number;
    brightness: number | null;
    scan: number | null;
    track: number | null;
    acqDate: string;
    acqTime: string;
    satellite: string | null;
    instrument: string | null;
    confidence: string | null;
    version: string | null;
    brightT31: number | null;
    frp: number | null;
    daynight: string | null;
    type: number | null;
    category?: 'industrial' | 'crop' | 'forest' | 'water' | 'unclassified';
}

interface MapProps {
    anomalies: AnomalyPoint[];
    selectedId?: number | null;
    onSelectHotspot: (point: AnomalyPoint) => void;
}

// Indian Subcontinent Sovereign Territorial Bounding Box
const INDIA_BOUNDS: L.LatLngBoundsExpression = [
    [5.0, 64.0], // South-West
    [38.5, 99.0], // North-East
];

function MapControls({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
    const map = useMap();

    useEffect(() => {
        const timer = setTimeout(() => {
            map.invalidateSize();
        }, 150);
        return () => clearTimeout(timer);
    }, [map]);

    useMapEvents({
        zoomend: () => {
            onZoomChange(map.getZoom());
        },
    });

    return null;
}

export default function MapClient({ anomalies, selectedId, onSelectHotspot }: MapProps) {
    const [isClient, setIsClient] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(5);
    const [indiaGeoJsonData, setIndiaGeoJsonData] = useState<any>(null);
    const [legendOpen, setLegendOpen] = useState(true);

    useEffect(() => {
        setIsClient(true);
        fetch('/in.json')
            .then((res) => res.json())
            .then((data) => {
                setIndiaGeoJsonData(data);
            })
            .catch((err) => {
                console.error('Failed to load sovereign boundary:', err);
            });
    }, []);

    if (!isClient) {
        return (
            <div className="w-full h-full min-h-[600px] flex items-center justify-center bg-slate-100 text-slate-500 rounded-2xl border border-slate-200">
                <div className="animate-pulse flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-500 animate-ping" />
                    Initializing Satellite Map...
                </div>
            </div>
        );
    }

    /**
     * Categorical marker color mapping based on spatial land cover & energy infrastructure classification
     */
    const getMarkerColor = (pt: AnomalyPoint) => {
        if (pt.type === 2 || pt.category === 'industrial') return '#4f46e5'; // Deep Indigo (Industrial / Power Plant)
        if (pt.category === 'crop') return '#f59e0b'; // Amber Gold (Crop Burning)
        if (pt.category === 'forest') return '#ef4444'; // Crimson Red (Forest Fire)
        if (pt.category === 'water') return '#06b6d4'; // Cyan Teal (Water / Wetland)
        if (pt.frp && pt.frp >= 20) return '#ef4444';
        if (pt.frp && pt.frp >= 8) return '#f59e0b';
        return '#f97316'; // Coral Orange (Unclassified / Open Land)
    };

    /**
     * Calculates marker radius scaled according to the current map zoom level.
     */
    const getScaledRadius = (frp: number | null, zoom: number) => {
        const frpVal = frp || 3;
        const sqrtVal = Math.sqrt(frpVal);

        if (zoom <= 5) {
            return Math.min(Math.max(sqrtVal * 0.9, 3.5), 5.5);
        } else if (zoom <= 7) {
            return Math.min(Math.max(sqrtVal * 1.5, 4.5), 8);
        } else {
            return Math.min(Math.max(sqrtVal * 2.5, 6), 16);
        }
    };

    return (
        <div className="relative w-full h-full min-h-[600px] rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-slate-50">
            <MapContainer
                center={[22.5937, 78.9629]}
                zoom={5}
                minZoom={4}
                maxZoom={14}
                maxBounds={INDIA_BOUNDS}
                maxBoundsViscosity={0.9}
                zoomControl={false}
                style={{ width: '100%', height: '100%', minHeight: '600px' }}
                className="z-0 bg-slate-100"
            >
                <MapControls onZoomChange={(z) => setZoomLevel(z)} />

                {/* CartoDB Voyager Light Theme Tile Layer */}
                <TileLayer
                    attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />

                {/* Survey of India Sovereign Boundary Overlay */}
                {indiaGeoJsonData && (
                    <GeoJSON
                        data={indiaGeoJsonData}
                        interactive={false}
                        style={() => ({
                            color: '#475569',
                            weight: 2.2,
                            opacity: 0.2,
                            fillColor: 'transparent',
                            fillOpacity: 0
                        })}
                    />
                )}

                <ZoomControl position="topright" />

                {anomalies.map((pt, idx) => {
                    const color = getMarkerColor(pt);
                    const radius = getScaledRadius(pt.frp, zoomLevel);
                    const isSelected = selectedId === pt.id || (selectedId === undefined && idx === 0);

                    return (
                        <CircleMarker
                            key={pt.id || `${pt.latitude}-${pt.longitude}-${idx}`}
                            center={[pt.latitude, pt.longitude]}
                            radius={isSelected ? radius + 3 : radius}
                            pathOptions={{
                                fillColor: color,
                                fillOpacity: isSelected ? 0.95 : 0.8,
                                color: isSelected ? '#0f172a' : color,
                                weight: isSelected ? 2.5 : 1,
                            }}
                            eventHandlers={{
                                click: () => onSelectHotspot(pt),
                            }}
                        >
                            <Tooltip direction="top" offset={[0, -5]} opacity={0.95} className="custom-leaflet-tooltip">
                                <div className="text-xs font-sans font-semibold p-1 space-y-0.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-bold text-slate-900">
                                            {pt.latitude.toFixed(3)}°N, {pt.longitude.toFixed(3)}°E
                                        </span>
                                        <span
                                            className="px-1.5 py-0.2 text-[9px] uppercase font-mono rounded text-white font-bold"
                                            style={{ backgroundColor: color }}
                                        >
                                            {pt.type === 2 ? 'Industrial' : pt.category || 'Thermal'}
                                        </span>
                                    </div>
                                    <div className="text-slate-700 text-[11px]">
                                        FRP: {pt.frp ? `${pt.frp} MW` : 'N/A'} | Brightness: {pt.brightness ? `${pt.brightness}K` : 'N/A'}
                                    </div>
                                    <div className="text-slate-500 text-[10px]">
                                        Acquired: {pt.acqDate} {pt.acqTime} UTC
                                    </div>
                                </div>
                            </Tooltip>
                        </CircleMarker>
                    );
                })}
            </MapContainer>

            {/* Floating Glassmorphism Map Legend (Bottom-Left Corner) */}
            <div className="absolute left-4 bottom-6 z-[400] transition-all duration-300">
                <div className="bg-slate-800/90 backdrop-blur-md border border-slate-800 text-white rounded-xl shadow-2xl overflow-hidden min-w-[220px]">
                    <div
                        onClick={() => setLegendOpen(!legendOpen)}
                        className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition border-b border-slate-800/80"
                    >
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200 tracking-wide">
                            <Layers className="w-3.5 h-3.5 text-orange-400" />
                            <span>Hotspot Classification Legend</span>
                        </div>
                        <button className="text-slate-400 hover:text-white transition">
                            {legendOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                    </div>

                    {legendOpen && (
                        <div className="p-3 space-y-2 text-[11px]">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shadow-[0_0_6px_rgba(79,70,229,0.8)]" />
                                    <span className="text-slate-300 font-medium flex items-center gap-1">
                                        <Zap className="w-3 h-3 text-indigo-400" /> Industrial / Power Plant
                                    </span>
                                </div>
                                <span className="font-mono text-slate-400 text-[10px]">Static</span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
                                    <span className="text-slate-300 font-medium flex items-center gap-1">
                                        <Wheat className="w-3 h-3 text-amber-400" /> Crop Residue Burning
                                    </span>
                                </div>
                                <span className="font-mono text-slate-400 text-[10px]">OSM</span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                                    <span className="text-slate-300 font-medium flex items-center gap-1">
                                        <TreePine className="w-3 h-3 text-red-400" /> Forest & Woodland Fire
                                    </span>
                                </div>
                                <span className="font-mono text-slate-400 text-[10px]">FRP</span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                                    <span className="text-slate-300 font-medium flex items-center gap-1">
                                        <Droplets className="w-3 h-3 text-cyan-400" /> Water / Off-Target Source
                                    </span>
                                </div>
                                <span className="font-mono text-slate-400 text-[10px]">Hydro</span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
                                    <span className="text-slate-300 font-medium flex items-center gap-1">
                                        <Flame className="w-3 h-3 text-orange-400" /> Unclassified / Open Land
                                    </span>
                                </div>
                                <span className="font-mono text-slate-400 text-[10px]">FIRMS</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
