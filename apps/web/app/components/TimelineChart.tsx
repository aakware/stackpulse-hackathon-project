import { useEffect, useState, useMemo } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { type AnomalyPoint } from './Map.client';

interface TimelineChartProps {
    data: AnomalyPoint[];
}

export default function TimelineChart({ data }: TimelineChartProps) {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const mappedPoints = useMemo(() => {
        if (!data || data.length === 0) return [];
        return data.map((pt, i) => {
            const shortDate = pt.acqDate.length >= 10 ? pt.acqDate.slice(5) : pt.acqDate;
            const fullLabel = `${shortDate} ${pt.acqTime}`;
            return {
                x: `${fullLabel}#${i}`,
                displayLabel: shortDate,
                fullLabel,
                y: pt.frp || 2,
                rawFrp: pt.frp,
                rawBright: pt.brightness,
                acqDate: pt.acqDate,
                acqTime: pt.acqTime,
                daynight: pt.daynight,
            };
        });
    }, [data]);

    // Select ONLY First, Middle, and Last tick labels to avoid text overlap
    const tickValuesToShow = useMemo(() => {
        if (mappedPoints.length === 0) return [];
        if (mappedPoints.length <= 3) return mappedPoints.map((p) => p.x);
        const first = mappedPoints[0].x;
        const midIndex = Math.floor((mappedPoints.length - 1) / 2);
        const mid = mappedPoints[midIndex].x;
        const last = mappedPoints[mappedPoints.length - 1].x;
        return Array.from(new Set([first, mid, last]));
    }, [mappedPoints]);

    if (!data || data.length === 0) {
        return (
            <div className="py-6 text-center text-xs text-slate-400 font-mono">
                No historical trajectory points found for this coordinate.
            </div>
        );
    }

    if (!isMounted) {
        return (
            <div className="h-44 w-full animate-pulse bg-slate-100 rounded-xl flex items-center justify-center text-xs text-slate-400 font-mono">
                Loading Trajectory Plot...
            </div>
        );
    }

    const nivoSeries = [
        {
            id: 'FRP (MW)',
            color: '#ea580c',
            data: mappedPoints,
        },
    ];

    return (
        <div className="h-44 w-full bg-white rounded-xl border border-slate-200/80 p-2 shadow-sm">
            <ResponsiveLine
                data={nivoSeries}
                margin={{ top: 12, right: 15, bottom: 28, left: 35 }}
                xScale={{ type: 'point' }}
                yScale={{ type: 'linear', min: 0, max: 'auto', stacked: false }}
                curve="monotoneX"
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    tickValues: tickValuesToShow,
                    format: (val: string) => {
                        const item = mappedPoints.find((p) => p.x === val);
                        return item ? item.displayLabel : val.split('#')[0];
                    },
                    tickSize: 3,
                    tickPadding: 4,
                    tickRotation: 0,
                }}
                axisLeft={{
                    tickSize: 3,
                    tickPadding: 4,
                    tickRotation: 0,
                    legend: 'MW',
                    legendPosition: 'middle',
                    legendOffset: -28,
                }}
                colors={['#ea580c']}
                enablePoints={false}
                enableGridX={false}
                enableArea={true}
                areaOpacity={0.12}
                useMesh={true}
                crosshairType="x"
                tooltip={({ point }) => {
                    const d = point.data as any;
                    return (
                        <div className="bg-slate-900/95 backdrop-blur-md text-white p-2.5 rounded-lg text-xs font-mono shadow-xl border border-slate-700 space-y-1">
                            <div className="text-orange-400 font-bold flex items-center justify-between gap-3">
                                <span>{d.acqDate} {d.acqTime} UTC</span>
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                                    {d.daynight === 'D' ? 'Daytime' : 'Nighttime'}
                                </span>
                            </div>
                            <div className="text-slate-200">
                                FRP: <span className="font-bold text-white">{d.rawFrp ? `${d.rawFrp.toFixed(1)} MW` : 'N/A'}</span>
                            </div>
                            {d.rawBright && (
                                <div className="text-slate-300">
                                    Brightness: <span className="font-bold text-sky-300">{d.rawBright.toFixed(1)} K</span>
                                </div>
                            )}
                        </div>
                    );
                }}
                theme={{
                    // fontSize: 10,
                    axis: {
                        ticks: {
                            text: { fill: '#64748b', fontSize: 9 },
                        },
                        legend: {
                            text: { fill: '#94a3b8', fontSize: 9, fontWeight: 600 },
                        },
                    },
                    grid: { line: { stroke: '#f1f5f9' } },
                }}
            />
        </div>
    );
}
