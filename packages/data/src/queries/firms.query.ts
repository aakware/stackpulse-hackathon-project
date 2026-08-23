import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { createDb } from '../index';
import { heatAnomalies } from '../schema';
import { OsmQueries } from './osm.query';
import { findNearbyPowerPlant } from './power-plants';


export interface HeatAnomalyRecord {
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
    createdAt: string;
}


/**
 * Spatial filter to ensure anomaly points belong to sovereign Indian landmass and island territories,
 * filtering out rectangular bounding box artifacts in Sri Lanka and deep China.
 */
export function isWithinIndianTerritory(lat: number, lon: number): boolean {
    // Exclude Sri Lanka landmass (6.0°N to 9.8°N, 79.5°E to 82.0°E)
    if (lat < 9.8 && lon > 79.4 && lon < 82.2) {
        return false;
    }
    // Exclude deep China / Central Asia north of Indira Col (37.2°N)
    if (lat > 37.2) {
        return false;
    }
    return true;
}

function enrichRecordType(records: HeatAnomalyRecord[]): HeatAnomalyRecord[] {
    return records.map((r) => {
        const plant = findNearbyPowerPlant(r.latitude, r.longitude, 2.5);
        if (r.type === 2 || plant) {
            return { ...r, type: 2, category: 'industrial' };
        }

        const frp = r.frp || 0;
        const isDay = r.daynight === 'D';

        let category: 'industrial' | 'crop' | 'forest' | 'water' | 'unclassified' = 'unclassified';
        if (frp >= 25) {
            category = 'forest';
        } else if (frp >= 3 && isDay) {
            category = 'crop';
        } else if (r.daynight === 'N' && frp < 3) {
            category = 'unclassified';
        } else {
            category = 'crop';
        }

        return { ...r, category };
    });
}



export const FirmsQueries = (d1: D1Database, apiKey?: string) => {
    const db = createDb(d1);
    // Official Sovereign Indian Subcontinent Bounding Box: [West, South, East, North]
    const defaultBbox = '68.0,6.0,97.5,37.5';

    return {
        /**
         * Gets heat anomaly data for a given date (YYYY-MM-DD).
         * Checks Cloudflare D1 database first. If empty, fetches from NASA FIRMS API, persists to D1, and returns.
         */
        async getAnomaliesForDate(dateStr?: string, limit = 1500): Promise<HeatAnomalyRecord[]> {
            const targetDate = dateStr || new Date().toISOString().split('T')[0];

            // 1. Query local D1 database first
            const dbRecords = await db
                .select()
                .from(heatAnomalies)
                .where(eq(heatAnomalies.acqDate, targetDate))
                .limit(limit * 2);

            const filteredDbRecords = (dbRecords as HeatAnomalyRecord[]).filter((r) =>
                isWithinIndianTerritory(r.latitude, r.longitude)
            ).slice(0, limit);

            if (filteredDbRecords.length > 0) {
                console.log(`[!] Found DB Records for ${targetDate}: ${filteredDbRecords.length} records.`);
                return enrichRecordType(filteredDbRecords);
            }


            // 2. Fetch from NASA FIRMS API if API key is provided
            if (apiKey) {
                try {
                    const freshRecords = await _fetchFromNasaApi(apiKey, defaultBbox, targetDate);
                    if (freshRecords.length > 0) {
                        console.log(`[!] Fetched ${freshRecords.length} FRESH Records from NASA FIRMS API for ${targetDate}. Persisting to D1...`);
                        await this.saveRecords(freshRecords);

                        // One-shot batch OSM geolabeling enrichment in background
                        try {
                            OsmQueries(d1).batchEnrichLandInfo(freshRecords).catch((err) =>
                                console.error('Background OSM Batch Error:', err)
                            );
                        } catch (err) {
                            console.error('OSM Batch Trigger Error:', err);
                        }

                        return freshRecords.filter((r) => isWithinIndianTerritory(r.latitude, r.longitude)).slice(0, limit);
                    }
                } catch (err) {
                    console.error('Error fetching NASA FIRMS API:', err);
                }
            }

            // 3. Fallback: Return latest historical records from D1 if date has no data
            console.log(`[!] No records for ${targetDate}. Returning latest historical records from D1...`);
            const fallbackRecords = await db
                .select()
                .from(heatAnomalies)
                .orderBy(desc(heatAnomalies.acqDate))
                .limit(limit * 2);

            return enrichRecordType(
                (fallbackRecords as HeatAnomalyRecord[])
                    .filter((r) => isWithinIndianTerritory(r.latitude, r.longitude))
                    .slice(0, limit)
            );
        },


        async getHistoricalAnomalies(limit = 1500): Promise<HeatAnomalyRecord[]> {
            const records = await db
                .select()
                .from(heatAnomalies)
                .orderBy(desc(heatAnomalies.acqDate))
                .limit(limit * 2);

            return (records as HeatAnomalyRecord[])
                .filter((r) => isWithinIndianTerritory(r.latitude, r.longitude))
                .slice(0, limit);
        },

        /**
         * Calculates distinct active detection days within a 1.5 km spatial neighborhood.
         */
        async getAnomalyPersistence(lat: number, lon: number): Promise<number> {
            const delta = 0.015; // ~1.5 km spatial bounding box
            const records = await db
                .select({ acqDate: heatAnomalies.acqDate })
                .from(heatAnomalies)
                .where(
                    and(
                        gte(heatAnomalies.latitude, lat - delta),
                        lte(heatAnomalies.latitude, lat + delta),
                        gte(heatAnomalies.longitude, lon - delta),
                        lte(heatAnomalies.longitude, lon + delta)
                    )
                );

            const uniqueDates = new Set((records || []).map((r) => r.acqDate));
            return uniqueDates.size;
        },

        /**
         * Returns all historical detection records within a 1.5 km spatial bounding box ordered by date ascending.
         */
        async getSpatialHistory(lat: number, lon: number): Promise<HeatAnomalyRecord[]> {
            const delta = 0.015; // ~1.5 km bounding box
            const records = await db
                .select()
                .from(heatAnomalies)
                .where(
                    and(
                        gte(heatAnomalies.latitude, lat - delta),
                        lte(heatAnomalies.latitude, lat + delta),
                        gte(heatAnomalies.longitude, lon - delta),
                        lte(heatAnomalies.longitude, lon + delta)
                    )
                );

            return (records as HeatAnomalyRecord[]).sort((a, b) => {
                const dtA = `${a.acqDate}T${a.acqTime}`;
                const dtB = `${b.acqDate}T${b.acqTime}`;
                return dtA.localeCompare(dtB);
            });
        },


        /**
         * Persists records using D1's native db.batch() to prevent SQL variable limit errors.
         */
        async saveRecords(records: HeatAnomalyRecord[]) {
            if (records.length === 0) return;

            const chunkSize = 50;
            for (let i = 0; i < records.length; i += chunkSize) {
                const chunk = records.slice(i, i + chunkSize);
                const statements = chunk.map((r) =>
                    db.insert(heatAnomalies).values({
                        latitude: r.latitude,
                        longitude: r.longitude,
                        brightness: r.brightness ?? null,
                        scan: r.scan ?? null,
                        track: r.track ?? null,
                        acqDate: r.acqDate,
                        acqTime: r.acqTime,
                        satellite: r.satellite ?? 'VIIRS',
                        instrument: r.instrument ?? 'VIIRS',
                        confidence: r.confidence ?? 'n',
                        version: r.version ?? '2.0',
                        brightT31: r.brightT31 ?? null,
                        frp: r.frp ?? null,
                        daynight: r.daynight ?? 'D',
                        type: r.type ?? 0,
                        createdAt: r.createdAt || new Date().toISOString(),
                    }).onConflictDoNothing()
                );

                if (statements.length > 0) {
                    await db.batch(statements as [any, ...any[]]);
                }
            }
            console.log(`✅ Successfully saved ${records.length} records into Cloudflare D1.`);
        },
    };
};

async function _fetchFromNasaApi(apiKey: string, bbox: string, targetDate: string): Promise<HeatAnomalyRecord[]> {
    const sensor = 'VIIRS_NOAA20_NRT';
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${sensor}/${bbox}/1/${targetDate}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`NASA FIRMS API status ${response.status}`);
    }

    const csvText = await response.text();
    if (!csvText || csvText.includes('Invalid API Key') || csvText.includes('No data found')) {
        return [];
    }

    return _parseCsvResponse(csvText, targetDate);
}

function _parseCsvResponse(csvText: string, defaultDate: string): HeatAnomalyRecord[] {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(',').map((h) => h.trim());
    const records: HeatAnomalyRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        if (cols.length < headers.length) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
            row[h] = cols[idx];
        });

        const lat = parseFloat(row.latitude);
        const lon = parseFloat(row.longitude);
        if (isNaN(lat) || isNaN(lon)) continue;

        records.push({
            latitude: lat,
            longitude: lon,
            brightness: row.brightness && !isNaN(parseFloat(row.brightness)) ? parseFloat(row.brightness) : null,
            scan: row.scan && !isNaN(parseFloat(row.scan)) ? parseFloat(row.scan) : null,
            track: row.track && !isNaN(parseFloat(row.track)) ? parseFloat(row.track) : null,
            acqDate: row.acq_date || defaultDate,
            acqTime: row.acq_time || '0000',
            satellite: row.satellite || 'VIIRS',
            instrument: row.instrument || 'VIIRS',
            confidence: row.confidence || 'n',
            version: row.version || '2.0',
            brightT31: row.bright_t31 && !isNaN(parseFloat(row.bright_t31)) ? parseFloat(row.bright_t31) : null,
            frp: row.frp && !isNaN(parseFloat(row.frp)) ? parseFloat(row.frp) : null,
            daynight: row.daynight || 'D',
            type: row.type !== undefined && row.type !== '' && !isNaN(parseInt(row.type, 10)) ? parseInt(row.type, 10) : 0,
            createdAt: new Date().toISOString(),
        });
    }

    return records;
}
