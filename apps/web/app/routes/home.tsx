import { useState, useEffect, lazy, Suspense } from 'react';
import type { AnomalyPoint } from '../components/Map.client';
import HotspotSheet from '../components/HotspotSheet';
import { Flame, RefreshCw, Database } from 'lucide-react';

const MapClient = lazy(() => import('../components/Map.client'));

export function meta() {
    return [
        { title: 'NASA FIRMS & OSM Thermal Intelligence - Indian Subcontinent' },
        { name: 'description', content: 'AI-Based Detection and Classification of Industrial Fires and Persistent Thermal Sources' },
    ];
}

const SAMPLE_DEMO_ANOMALIES: AnomalyPoint[] = [
    { id: 1, latitude: 29.45248, longitude: 76.86888, brightness: 345.5, scan: 0.5, track: 0.5, acqDate: '2026-08-23', acqTime: '0722', satellite: 'VIIRS', instrument: 'VIIRS', confidence: 'h', version: '2.0', brightT31: 304.1, frp: 18.4, daynight: 'D', type: 2, category: 'industrial' },
    { id: 2, latitude: 10.95114, longitude: 76.98491, brightness: 338.2, scan: 0.4, track: 0.4, acqDate: '2026-08-23', acqTime: '0722', satellite: 'VIIRS', instrument: 'VIIRS', confidence: 'n', version: '2.0', brightT31: 298.5, frp: 8.2, daynight: 'D', type: 0, category: 'crop' },
    { id: 3, latitude: 21.87983, longitude: 82.90373, brightness: 334.1, scan: 0.5, track: 0.6, acqDate: '2026-08-23', acqTime: '0654', satellite: 'VIIRS', instrument: 'VIIRS', confidence: 'n', version: '2.0', brightT31: 292.2, frp: 26.3, daynight: 'D', type: 0, category: 'forest' },
    { id: 4, latitude: 19.19651, longitude: 82.54643, brightness: 328.9, scan: 0.4, track: 0.4, acqDate: '2026-08-23', acqTime: '0722', satellite: 'VIIRS', instrument: 'VIIRS', confidence: 'l', version: '2.0', brightT31: 302.4, frp: 2.8, daynight: 'D', type: 0, category: 'unclassified' },
    { id: 5, latitude: 14.63613, longitude: 77.35288, brightness: 331.8, scan: 0.5, track: 0.6, acqDate: '2026-08-23', acqTime: '0721', satellite: 'VIIRS', instrument: 'VIIRS', confidence: 'n', version: '2.0', brightT31: 295.4, frp: 5.2, daynight: 'D', type: 0, category: 'crop' },
    { id: 6, latitude: 7.98026, longitude: 80.27239, brightness: 333.1, scan: 0.6, track: 0.7, acqDate: '2026-08-23', acqTime: '0721', satellite: 'VIIRS', instrument: 'VIIRS', confidence: 'n', version: '2.0', brightT31: 297.7, frp: 5.5, daynight: 'D', type: 0, category: 'water' },
];

export default function Home() {
    const [anomalies, setAnomalies] = useState<AnomalyPoint[]>(SAMPLE_DEMO_ANOMALIES);
    const [selectedHotspot, setSelectedHotspot] = useState<AnomalyPoint | null>(null);
    const [loading, setLoading] = useState(false);
    const [dataSource, setDataSource] = useState<'D1 Database' | 'NASA FIRMS API'>('D1 Database');
    const [isMounted, setIsMounted] = useState(false);
    const apiUrl = 'http://localhost:8787';

    useEffect(() => {
        setIsMounted(true);
        fetchTodayAnomalies();
    }, []);

    const fetchTodayAnomalies = async () => {
        setLoading(true);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);

        try {
            const response = await fetch(`${apiUrl}/api/anomalies/today`, { signal: controller.signal });
            clearTimeout(timer);
            if (response.ok) {
                const result: { data: AnomalyPoint[] } = await response.json();
                if (result.data && result.data.length > 0) {
                    setAnomalies(result.data);
                    setDataSource('D1 Database');
                }
            }
        } catch (err) {
            clearTimeout(timer);
            console.log('Using demo dataset fallback for interactive preview:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-orange-500 selection:text-white">
            {/* Top Navigation Header */}
            <header className="h-16 px-6 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between z-40 shadow-sm flex-shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 p-0.5 shadow-md shadow-orange-500/20">
                        <div className="w-full h-full bg-white rounded-[10px] flex items-center justify-center">
                            <Flame className="w-5 h-5 text-orange-600 animate-pulse" />
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="font-extrabold text-base tracking-tight text-slate-900">
                                NASA FIRMS <span className="text-orange-600">&</span> OSM Thermal Intelligence
                            </h1>
                            {/* <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-mono font-medium">
                                NTRO SIH 26162
                            </span> */}
                        </div>
                        <p className="text-xs text-slate-500">
                            Industrial Heat Source Classification & Monitoring — Indian Subcontinent Region
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 text-xs">
                    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
                        <Database className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Source: <strong className="text-emerald-700 font-mono">{dataSource}</strong></span>
                    </div>

                    <button
                        onClick={fetchTodayAnomalies}
                        disabled={loading}
                        className="px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium flex items-center gap-1.5 shadow-md shadow-orange-600/20 transition disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        <span>Fetch Today's Anomalies ({anomalies.length})</span>
                    </button>
                </div>
            </header>

            {/* Main Full-Height Satellite Map Container */}
            <main className="flex-1 w-full h-[calc(100vh-64px)] relative overflow-hidden bg-slate-100">
                {isMounted ? (
                    <Suspense
                        fallback={
                            <div className="w-full h-full flex items-center justify-center text-slate-500 bg-slate-100">
                                <div className="animate-pulse flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full bg-orange-500 animate-ping" />
                                    Loading Full-Screen Satellite Map...
                                </div>
                            </div>
                        }
                    >
                        <MapClient
                            anomalies={anomalies}
                            selectedId={selectedHotspot?.id}
                            onSelectHotspot={(point) => setSelectedHotspot(point)}
                        />
                    </Suspense>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 bg-slate-100">
                        Initializing Indian Subcontinent Satellite Map...
                    </div>
                )}

                {/* Hotspot Details Slide-Over Sheet */}
                {selectedHotspot && (
                    <HotspotSheet
                        hotspot={selectedHotspot}
                        onClose={() => setSelectedHotspot(null)}
                        apiUrl={apiUrl}
                    />
                )}
            </main>
        </div>
    );
}
