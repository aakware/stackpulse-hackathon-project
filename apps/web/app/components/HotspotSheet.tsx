import { useEffect, useState } from 'react';
import { type AnomalyPoint } from './Map.client';
import TimelineChart from './TimelineChart';
import { MapPin, Flame, Radio, Clock, ShieldAlert, Layers, RefreshCw, X, Tag, Sparkles, AlertTriangle, Zap, Activity, Satellite, Maximize2 } from 'lucide-react';

interface HotspotSheetProps {
    hotspot: AnomalyPoint | null;
    onClose: () => void;
    apiUrl?: string;
}

interface LandInfo {
    landuseType: string;
    osmTags: any[];
    cached: boolean;
    lastUpdatedAt: string;
}

interface EventProbabilityResult {
    industrialFlare: number;
    cropBurning: number;
    forestFire: number;
    urbanHeat: number;
    unknown?: number;
    primaryType: 'Industrial Flare' | 'Agricultural Crop Burning' | 'Forest Fire / Wildfire' | 'Urban / Off-Target Source' | 'Unknown / Low Confidence Signal';
    confidenceLevel: 'High' | 'Moderate' | 'Low';
    nearbyPowerPlant?: {
        name: string;
        latitude: number;
        longitude: number;
        primaryFuel: string;
        owner: string;
        distanceKm: number;
    } | null;
    insights: string[];
}

interface SentinelResult {
    success: boolean;
    cached: boolean;
    acquiredAt: string;
    cloudCover: number;
    sceneId?: string;
    imageDataBase64?: string;
    error?: string;
}

const fetchWithTimeout = async (url: string, ms = 4000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
};

/**
 * Client-side heuristic fallback estimator when backend API is unreachable or timing out.
 */
function getClientFallbackEstimation(hotspot: AnomalyPoint): EventProbabilityResult {
    const frp = hotspot.frp || 5.0;
    const isNight = hotspot.daynight === 'N';
    const isStatic = hotspot.type === 2;

    let pInd = isStatic ? 0.85 : 0.15;
    let pCrop = frp > 3 && frp < 25 && !isNight && !isStatic ? 0.65 : 0.15;
    let pForest = frp >= 25 && !isStatic ? 0.65 : 0.10;
    let pUrban = isNight && frp <= 4 ? 0.70 : 0.05;
    let pUnk = 0.10;

    const sum = pInd + pCrop + pForest + pUrban + pUnk;
    pInd = Math.round((pInd / sum) * 100) / 100;
    pCrop = Math.round((pCrop / sum) * 100) / 100;
    pForest = Math.round((pForest / sum) * 100) / 100;
    pUrban = Math.round((pUrban / sum) * 100) / 100;
    pUnk = Math.round((pUnk / sum) * 100) / 100;

    let primaryType: EventProbabilityResult['primaryType'] = 'Agricultural Crop Burning';
    if (pUnk > pInd && pUnk > pCrop && pUnk > pForest && pUnk > pUrban) primaryType = 'Unknown / Low Confidence Signal';
    else if (pInd >= pCrop && pInd >= pForest && pInd >= pUrban) primaryType = 'Industrial Flare';
    else if (pForest >= pCrop && pForest >= pUrban) primaryType = 'Forest Fire / Wildfire';
    else if (pUrban >= pCrop) primaryType = 'Urban / Off-Target Source';

    return {
        industrialFlare: pInd,
        cropBurning: pCrop,
        forestFire: pForest,
        urbanHeat: pUrban,
        unknown: pUnk,
        primaryType,
        confidenceLevel: 'Moderate',
        insights: [
            `Radiometric FRP: ${frp.toFixed(1)} MW (${isNight ? 'Nighttime' : 'Daytime'} acquisition)`,
        ],
    };
}

export default function HotspotSheet({ hotspot, onClose, apiUrl = 'http://localhost:8787' }: HotspotSheetProps) {
    const [landInfo, setLandInfo] = useState<LandInfo | null>(null);
    const [eventProb, setEventProb] = useState<EventProbabilityResult | null>(null);
    const [spatialHistory, setSpatialHistory] = useState<AnomalyPoint[]>([]);
    const [loadingInfo, setLoadingInfo] = useState(false);

    // On-Demand Sentinel Satellite Imagery state
    const [sentinelData, setSentinelData] = useState<SentinelResult | null>(null);
    const [fetchingSentinel, setFetchingSentinel] = useState(false);
    const [sentinelError, setSentinelError] = useState<string | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);

    useEffect(() => {
        if (!hotspot) {
            setLandInfo(null);
            setEventProb(null);
            setSpatialHistory([]);
            setSentinelData(null);
            setSentinelError(null);
            return;
        }

        let isMounted = true;
        setLoadingInfo(true);
        setLandInfo(null);
        setEventProb(null);
        setSpatialHistory([]);
        setSentinelData(null);
        setSentinelError(null);

        const lat = hotspot.latitude;
        const lon = hotspot.longitude;
        const frp = hotspot.frp || 5;
        const brightness = hotspot.brightness || 300;
        const acqDate = hotspot.acqDate;
        const daynight = hotspot.daynight || 'D';

        // Concurrently fetch land-info, classify-event, and spatial-history with 4-second timeouts
        const landPromise = fetchWithTimeout(`${apiUrl}/api/anomalies/land-info?lat=${lat}&lon=${lon}`).catch(() => ({
            landuseType: 'Open Land / Unmapped Area',
            osmTags: [],
            cached: false,
            lastUpdatedAt: new Date().toISOString(),
        }));

        const classifyPromise = fetchWithTimeout(`${apiUrl}/api/anomalies/classify-event?lat=${lat}&lon=${lon}&frp=${frp}&brightness=${brightness}&acqDate=${acqDate}&daynight=${daynight}`).catch(() =>
            getClientFallbackEstimation(hotspot)
        );

        const historyPromise = fetchWithTimeout(`${apiUrl}/api/anomalies/spatial-history?lat=${lat}&lon=${lon}`).catch(() => ({
            data: [hotspot],
        }));

        Promise.all([landPromise, classifyPromise, historyPromise])
            .then(([landData, probData, historyData]) => {
                if (isMounted) {
                    setLandInfo(landData as LandInfo);
                    setEventProb(probData as EventProbabilityResult);
                    if (historyData && Array.isArray((historyData as { data: AnomalyPoint }).data)) {
                        setSpatialHistory((historyData as { data: AnomalyPoint[] }).data);
                    } else {
                        setSpatialHistory([hotspot]);
                    }
                    setLoadingInfo(false);
                }
            })
            .catch((err) => {
                console.warn('Fallback to local hotspot inspection:', err);
                if (isMounted) {
                    setEventProb(getClientFallbackEstimation(hotspot));
                    setSpatialHistory([hotspot]);
                    setLoadingInfo(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [hotspot, apiUrl]);

    const handleFetchSentinel = async () => {
        if (!hotspot) return;
        setFetchingSentinel(true);
        setSentinelError(null);

        try {
            const res = await fetch(`${apiUrl}/api/anomalies/sentinel-imagery?lat=${hotspot.latitude}&lon=${hotspot.longitude}`);
            if (!res.ok) throw new Error(`HTTP status ${res.status}`);
            const data: SentinelResult = await res.json();
            if (data.success) {
                setSentinelData(data);
            } else {
                setSentinelError(data.error || 'Unable to retrieve satellite imagery.');
            }
        } catch (err: any) {
            setSentinelError(err.message || 'Failed to fetch Sentinel-2 imagery.');
        } finally {
            setFetchingSentinel(false);
        }
    };

    if (!hotspot) return null;

    // const getConfidenceBadge = (conf?: string) => {
    //     if (conf === 'High') {
    //         return <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> High Confidence</span>;
    //     }
    //     if (conf === 'Moderate') {
    //         return <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Moderate Confidence</span>;
    //     }
    //     return <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Low Confidence</span>;
    // };

    return (
        <>
            <div className="fixed right-4 top-20 bottom-6 w-96 z-50 bg-white/95 backdrop-blur-md text-slate-900 rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden transition-all duration-300 animate-in slide-in-from-right">
                {/* Header */}
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-orange-100 text-orange-600 border border-orange-200">
                            <Flame className="w-5 h-5 animate-pulse" />
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-slate-900">Thermal Hotspot Details</h3>
                            <p className="text-xs text-slate-500">ID #{hotspot.id || 'N/A'}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
                        title="Close Sheet"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content Body */}
                <div className="p-4 space-y-4 overflow-y-auto flex-1 text-sm scrollbar-thin scrollbar-thumb-slate-300">
                    {/* Coordinates & Location */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-700 font-mono">
                            <div className="flex items-center gap-1.5 font-medium">
                                <MapPin className="w-4 h-4 text-orange-600" />
                                <span>{hotspot.latitude.toFixed(4)}° N, {hotspot.longitude.toFixed(4)}° E</span>
                            </div>
                            {/* {eventProb && getConfidenceBadge(eventProb.confidenceLevel)} DO NOT UNCOMMENT BRUH */}
                        </div>
                    </div>

                    {/* Thermal Signatures Grid */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="text-xs text-slate-500 flex items-center gap-1">
                                <Flame className="w-3.5 h-3.5 text-orange-500" />
                                <span>Fire Radiative Power</span>
                            </div>
                            <div className="text-lg font-bold text-orange-600 mt-1">
                                {hotspot.frp !== null ? `${hotspot.frp.toFixed(1)} MW` : 'N/A'}
                            </div>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                            <div className="text-xs text-slate-500 flex items-center gap-1">
                                <Radio className="w-3.5 h-3.5 text-amber-500" />
                                <span>Brightness Temp</span>
                            </div>
                            <div className="text-lg font-bold text-amber-600 mt-1">
                                {hotspot.brightness !== null ? `${hotspot.brightness.toFixed(1)} K` : 'N/A'}
                            </div>
                        </div>
                    </div>

                    {/* Sentinel-2 High-Res Satellite Imagery (On-Demand) */}
                    <div className="p-3.5 bg-slate-900 text-white rounded-xl border border-slate-800 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-400">
                                <Satellite className="w-4 h-4 text-orange-400 animate-pulse" />
                                <span>Sentinel-2 Satellite Context (1x1 km²)</span>
                            </div>
                            {sentinelData && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${sentinelData.cached ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-orange-950 text-orange-300 border-orange-700'}`}>
                                    {sentinelData.cached ? 'Cached (D1)' : 'Fresh (Copernicus L2A)'}
                                </span>
                            )}
                        </div>

                        {!sentinelData && !fetchingSentinel && (
                            <div className="space-y-2">
                                <p className="text-xs text-slate-300">
                                    Fetch recent true-color optical satellite imagery from Copernicus Sentinel-2.
                                </p>
                                <button
                                    onClick={handleFetchSentinel}
                                    className="w-full py-2.5 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-600/30 transition"
                                >
                                    <Satellite className="w-4 h-4" />
                                    <span>Fetch Sentinel-2 Satellite Image</span>
                                </button>
                            </div>
                        )}

                        {fetchingSentinel && (
                            <div className="py-6 text-center text-xs text-slate-300 flex flex-col items-center justify-center gap-2">
                                <RefreshCw className="w-5 h-5 animate-spin text-orange-400" />
                                <span>Evaluating scenes & fetching clear Sentinel-2 image...</span>
                            </div>
                        )}

                        {sentinelError && (
                            <div className="p-2.5 bg-red-950/80 border border-red-800 rounded-lg text-xs text-red-200 space-y-1">
                                <div className="font-semibold text-red-300 flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" /> Imagery Retrieval Error
                                </div>
                                <div>{sentinelError}</div>
                                <button
                                    onClick={handleFetchSentinel}
                                    className="mt-1 px-2.5 py-1 rounded bg-red-900 hover:bg-red-800 text-white text-[11px] font-mono"
                                >
                                    Retry Request
                                </button>
                            </div>
                        )}

                        {sentinelData && sentinelData.imageDataBase64 && (
                            <div className="space-y-2">
                                <div
                                    onClick={() => setShowImageModal(true)}
                                    className="relative group cursor-pointer overflow-hidden rounded-lg border border-slate-700 aspect-square bg-black shadow-inner"
                                >
                                    <img
                                        src={sentinelData.imageDataBase64}
                                        alt="Sentinel-2 True Color Satellite Scene"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-mono gap-1">
                                        <Maximize2 className="w-4 h-4" /> Expand Image
                                    </div>
                                </div>

                                <div className="space-y-1 text-[11px] font-mono text-slate-300 bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">Captured:</span>
                                        <span className="text-orange-300 font-bold">{new Date(sentinelData.acquiredAt).toUTCString().replace('GMT', 'UTC')}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-400">Cloud Coverage:</span>
                                        <span className="text-sky-300 font-semibold">{sentinelData.cloudCover.toFixed(2)}%</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Nearby Heavy Energy Infrastructure Alert */}
                    {eventProb?.nearbyPowerPlant && (
                        <div className="p-3 bg-indigo-50/90 rounded-xl border border-indigo-200 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                                <Zap className="w-4 h-4 text-indigo-600 fill-indigo-500" />
                                <span>Energy Infrastructure Proximity</span>
                            </div>
                            <div className="text-xs text-indigo-950 font-medium">
                                {eventProb.nearbyPowerPlant.name}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-indigo-700 font-mono pt-0.5">
                                <span>Fuel: {eventProb.nearbyPowerPlant.primaryFuel}</span>
                                <span className="font-semibold">{eventProb.nearbyPowerPlant.distanceKm} km away</span>
                            </div>
                        </div>
                    )}

                    {/* Probabilistic Multi-Class Event Type Estimation */}
                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                <Sparkles className="w-4 h-4 text-orange-500" />
                                <span>Probabilistic Event Classification</span>
                            </div>
                        </div>

                        {loadingInfo ? (
                            <div className="py-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-orange-500" />
                                Evaluating signals & spatial persistence...
                            </div>
                        ) : eventProb ? (
                            <div className="space-y-2.5">
                                <div className="p-2.5 rounded-lg">
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Primary Classification</div>
                                    <div className="text-sm font-extrabold text-orange-600 mt-0.5">
                                        {eventProb.primaryType}
                                    </div>
                                </div>

                                {/* Probabilistic Breakdown Progress Bars */}
                                <div className="space-y-3 text-xs">
                                    <div>
                                        <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                                            <span>Industrial Flare</span>
                                            <span className="font-mono font-bold">{Math.round(eventProb.industrialFlare * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-indigo-600 h-full transition-all duration-500" style={{ width: `${eventProb.industrialFlare * 100}%` }} />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                                            <span>Crop Residue Burning</span>
                                            <span className="font-mono font-bold">{Math.round(eventProb.cropBurning * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-amber-500 h-full transition-all duration-500" style={{ width: `${eventProb.cropBurning * 100}%` }} />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                                            <span>Forest Fire / Wildfire</span>
                                            <span className="font-mono font-bold">{Math.round(eventProb.forestFire * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${eventProb.forestFire * 100}%` }} />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                                            <span>Urban / Off-Target Heat</span>
                                            <span className="font-mono font-bold">{Math.round(eventProb.urbanHeat * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-sky-500 h-full transition-all duration-500" style={{ width: `${eventProb.urbanHeat * 100}%` }} />
                                        </div>
                                    </div>

                                    {eventProb.unknown !== undefined && eventProb.unknown > 0 && (
                                        <div>
                                            <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                                                <span>Unknown / Low Confidence</span>
                                                <span className="font-mono font-bold">{Math.round(eventProb.unknown * 100)}%</span>
                                            </div>
                                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                                <div className="bg-slate-400 h-full transition-all duration-500" style={{ width: `${eventProb.unknown * 100}%` }} />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Key Signals / Insights */}
                                {eventProb.insights && eventProb.insights.length > 0 && (
                                    <div className="pt-1.5 space-y-1">
                                        <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Model Feature Drivers</div>
                                        <ul className="space-y-1 text-[11px] text-slate-600 rounded-lg">
                                            {eventProb.insights.map((insight, idx) => (
                                                <li key={idx} className="flex items-start gap-1">
                                                    <span className="text-orange-500 font-bold">•</span>
                                                    <span>{insight}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* Historical Thermal Trajectory Multi-Line Plot */}
                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                <Activity className="w-4 h-4 text-orange-500" />
                                <span>Historical Thermal Trajectory (1.5km)</span>
                            </div>
                        </div>
                        {loadingInfo ? (
                            <div className="py-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-orange-500" />
                                Loading trajectory timeline...
                            </div>
                        ) : (
                            <TimelineChart data={spatialHistory.length > 0 ? spatialHistory : [hotspot]} />
                        )}
                    </div>

                    {/* Acquisition & Satellite Info */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                        <div className="flex justify-between items-center text-slate-700">
                            <span className="text-slate-500 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-blue-500" /> Acquired Date / Time
                            </span>
                            <span className="font-mono text-slate-900">{hotspot.acqDate} {hotspot.acqTime} UTC</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-700">
                            <span className="text-slate-500 flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5 text-purple-500" /> Satellite & Sensor
                            </span>
                            <span className="font-mono text-slate-900">{hotspot.satellite} ({hotspot.instrument})</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-700">
                            <span className="text-slate-500 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-cyan-500" /> Capture Time
                            </span>
                            <span className="font-mono text-slate-900">{hotspot.daynight === 'D' ? 'Daytime' : 'Nighttime'}</span>
                        </div>
                    </div>

                    {/* OSM Land Classification Section */}
                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                <Layers className="w-4 h-4" />
                                <span>OSM Land Classification</span>
                            </div>
                            {landInfo && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${landInfo.cached ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-sky-100 text-sky-800 border-sky-300'}`}>
                                    {landInfo.cached ? 'Cached (D1)' : 'Fresh (Overpass API)'}
                                </span>
                            )}
                        </div>

                        {loadingInfo ? (
                            <div className="py-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                                Querying OSM Overpass API & D1 land storage...
                            </div>
                        ) : landInfo ? (
                            <div className="space-y-2">
                                <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-sm">
                                    <div className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">Primary Land Category</div>
                                    <div className="text-sm font-bold text-emerald-700 mt-0.5 capitalize">
                                        {landInfo.landuseType}
                                    </div>
                                </div>

                                {landInfo.osmTags && landInfo.osmTags.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                                            <Tag className="w-3 h-3 text-slate-400" /> Matching OSM Tags ({landInfo.osmTags.length})
                                        </div>
                                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                                            {landInfo.osmTags.map((tagObj, idx) =>
                                                Object.entries(tagObj).map(([k, v]) => (
                                                    <span key={`${idx}-${k}`} className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono border border-slate-200">
                                                        {k}={String(v)}
                                                    </span>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="text-[10px] text-slate-400 font-mono pt-1">
                                    Last Updated: {new Date(landInfo.lastUpdatedAt).toLocaleString()} (3-mo TTL)
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs text-slate-400 py-2 text-center">No land use data available</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Expanded Full-Screen Image Modal */}
            {showImageModal && sentinelData?.imageDataBase64 && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
                    <div className="relative max-w-2xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <Satellite className="w-5 h-5 text-orange-400" />
                                <div>
                                    <h3 className="font-bold text-sm text-white">Sentinel-2 True-Color Optical Scene</h3>
                                    <p className="text-xs text-slate-400 font-mono">
                                        {hotspot.latitude.toFixed(4)}° N, {hotspot.longitude.toFixed(4)}° E (1x1 km² area)
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowImageModal(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="rounded-xl overflow-hidden border border-slate-800 bg-black aspect-square max-h-[70vh] flex items-center justify-center">
                            <img
                                src={sentinelData.imageDataBase64}
                                alt="Sentinel-2 True Color Optical Scene"
                                className="w-full h-full object-contain"
                            />
                        </div>

                        <div className="flex items-center justify-between text-xs font-mono text-slate-300 pt-1">
                            <div>Acquisition: <strong className="text-orange-400">{new Date(sentinelData.acquiredAt).toUTCString()}</strong></div>
                            <div>Cloud Cover: <strong className="text-sky-300">{sentinelData.cloudCover.toFixed(2)}%</strong></div>
                            <div>Source: <strong className="text-emerald-400">{sentinelData.cached ? 'D1 Database Cache' : 'Copernicus CDSE L2A'}</strong></div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
