import { eq, and, inArray } from 'drizzle-orm';
import { createDb } from '../index';
import { osmLandCache } from '../schema';

export interface LandInfoResult {
    latitude: number;
    longitude: number;
    latRounded: number;
    lonRounded: number;
    landuseType: string;
    category: 'industrial' | 'crop' | 'forest' | 'water' | 'unclassified';
    osmTags: any[];
    cached: boolean;
    lastUpdatedAt: string;
}

/**
 * Derives standardized high-level categorical classification from OSM landuse strings & tags.
 */
export function deriveCategoryFromLanduse(landuseType: string, tags?: any[]): 'industrial' | 'crop' | 'forest' | 'water' | 'unclassified' {
    const str = (landuseType || '').toLowerCase();
    const tagStr = tags ? JSON.stringify(tags).toLowerCase() : '';
    const combined = `${str} ${tagStr}`;

    if (combined.includes('industrial') || combined.includes('factory') || combined.includes('refinery') || combined.includes('power') || combined.includes('generator')) {
        return 'industrial';
    }
    if (combined.includes('farm') || combined.includes('crop') || combined.includes('agricultural') || combined.includes('meadow') || combined.includes('orchard') || combined.includes('grass')) {
        return 'crop';
    }
    if (combined.includes('forest') || combined.includes('wood') || combined.includes('scrub') || combined.includes('nature') || combined.includes('trees')) {
        return 'forest';
    }
    if (combined.includes('water') || combined.includes('wetland') || combined.includes('river') || combined.includes('reservoir') || combined.includes('basin') || combined.includes('stream')) {
        return 'water';
    }
    return 'unclassified';
}

export const OsmQueries = (d1: D1Database) => {
    const db = createDb(d1);
    const searchRadiusMeters = 500;
    const cacheTtlDays = 90; // 3 months TTL

    return {
        /**
         * Retrieves land use / land cover classification for a given coordinate.
         * Uses Cloudflare D1 cache first; queries Overpass API if missing or >3 months old.
         */
        async getLandInfo(lat: number, lon: number): Promise<LandInfoResult> {
            const latRounded = Math.round(lat * 1000) / 1000;
            const lonRounded = Math.round(lon * 1000) / 1000;

            // 1. Check local D1 cache
            const cachedRow = await db
                .select()
                .from(osmLandCache)
                .where(
                    and(
                        eq(osmLandCache.latRounded, latRounded),
                        eq(osmLandCache.lonRounded, lonRounded)
                    )
                )
                .get();

            if (cachedRow) {
                const lastUpdated = new Date(cachedRow.lastUpdatedAt).getTime();
                const ageInDays = (Date.now() - lastUpdated) / (1000 * 60 * 60 * 24);

                if (ageInDays <= cacheTtlDays) {
                    let tags: any[] = [];
                    try {
                        tags = cachedRow.osmTags ? JSON.parse(cachedRow.osmTags) : [];
                    } catch {
                        tags = [];
                    }

                    return {
                        latitude: lat,
                        longitude: lon,
                        latRounded,
                        lonRounded,
                        landuseType: cachedRow.landuseType,
                        category: deriveCategoryFromLanduse(cachedRow.landuseType, tags),
                        osmTags: tags,
                        cached: true,
                        lastUpdatedAt: cachedRow.lastUpdatedAt,
                    };
                }
            }

            // 2. Query Overpass API if missing or older than 3 months
            const freshLandInfo = await _fetchFromOverpass(lat, lon, searchRadiusMeters);
            const nowIso = new Date().toISOString();

            // 3. Save/Update in D1 Cache
            if (cachedRow) {
                await db
                    .update(osmLandCache)
                    .set({
                        landuseType: freshLandInfo.landuseType,
                        osmTags: JSON.stringify(freshLandInfo.tags),
                        lastUpdatedAt: nowIso,
                    })
                    .where(eq(osmLandCache.id, cachedRow.id));
            } else {
                await db.insert(osmLandCache).values({
                    latRounded,
                    lonRounded,
                    landuseType: freshLandInfo.landuseType,
                    osmTags: JSON.stringify(freshLandInfo.tags),
                    lastUpdatedAt: nowIso,
                });
            }

            return {
                latitude: lat,
                longitude: lon,
                latRounded,
                lonRounded,
                landuseType: freshLandInfo.landuseType,
                category: deriveCategoryFromLanduse(freshLandInfo.landuseType, freshLandInfo.tags),
                osmTags: freshLandInfo.tags,
                cached: false,
                lastUpdatedAt: nowIso,
            };
        },

        /**
         * Batches OSM Overpass classification for multiple coordinates in one-shot.
         * Checks local D1 cache first, dispatches consolidated Overpass API payload for un-cached points in chunks of 25,
         * and writes all results back into D1 (osmLandCache) via db.batch().
         */
        async batchEnrichLandInfo(points: { latitude: number; longitude: number }[]): Promise<number> {
            if (points.length === 0) return 0;

            // Deduplicate points by latRounded, lonRounded
            const uniqueCoordsMap = new Map<string, { lat: number; lon: number; latRounded: number; lonRounded: number }>();
            for (const p of points) {
                const latR = Math.round(p.latitude * 1000) / 1000;
                const lonR = Math.round(p.longitude * 1000) / 1000;
                const key = `${latR},${lonR}`;
                if (!uniqueCoordsMap.has(key)) {
                    uniqueCoordsMap.set(key, { lat: p.latitude, lon: p.longitude, latRounded: latR, lonRounded: lonR });
                }
            }

            const uniqueCoords = Array.from(uniqueCoordsMap.values());

            // Efficiently check D1 cache for latRoundeds
            const latRoundeds = Array.from(new Set(uniqueCoords.map((c) => c.latRounded)));
            let cachedKeys = new Set<string>();

            try {
                const cachedRows = await db
                    .select({ latRounded: osmLandCache.latRounded, lonRounded: osmLandCache.lonRounded })
                    .from(osmLandCache)
                    .where(inArray(osmLandCache.latRounded, latRoundeds.slice(0, 100)));

                cachedKeys = new Set(cachedRows.map((r) => `${r.latRounded},${r.lonRounded}`));
            } catch {
                cachedKeys = new Set();
            }

            // Find un-cached coordinates
            const unCached = uniqueCoords.filter((c) => !cachedKeys.has(`${c.latRounded},${c.lonRounded}`));
            if (unCached.length === 0) {
                return 0;
            }

            // Process unCached in chunks of 25 per Overpass request
            const overpassBatchSize = 25;
            let totalSaved = 0;

            for (let i = 0; i < unCached.length; i += overpassBatchSize) {
                const chunk = unCached.slice(i, i + overpassBatchSize);
                const statements: string[] = [];

                for (const c of chunk) {
                    statements.push(`nwr(around:${searchRadiusMeters},${c.lat},${c.lon})["landuse"];`);
                    statements.push(`nwr(around:${searchRadiusMeters},${c.lat},${c.lon})["natural"];`);
                    statements.push(`nwr(around:${searchRadiusMeters},${c.lat},${c.lon})["industrial"];`);
                }

                const batchedQuery = `
                [out:json][timeout:30];
                (
                  ${statements.join('\n  ')}
                );
                out center tags;
                `;

                try {
                    const response = await fetch('https://overpass-api.de/api/interpreter', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': 'NasaFirmsSpatialClassifier/2.0',
                        },
                        body: `data=${encodeURIComponent(batchedQuery)}`,
                    });

                    if (!response.ok) continue;

                    const data = (await response.json()) as { elements?: any[] };
                    const elements = data.elements || [];
                    const nowIso = new Date().toISOString();

                    const insertStatements = chunk.map((c) => {
                        const degRadius = searchRadiusMeters / 111000.0;
                        const matchedTags: any[] = [];

                        for (const el of elements) {
                            const eLat = el.lat ?? el.center?.lat;
                            const eLon = el.lon ?? el.center?.lon;
                            if (eLat === undefined || eLon === undefined) continue;

                            const distSq = (c.lat - eLat) ** 2 + (c.lon - eLon) ** 2;
                            if (distSq <= degRadius ** 2) {
                                if (el.tags && Object.keys(el.tags).length > 0) {
                                    matchedTags.push(el.tags);
                                }
                            }
                        }

                        const categories: string[] = [];
                        for (const t of matchedTags) {
                            if (t.industrial) categories.push(`industrial:${t.industrial}`);
                            else if (t.landuse) categories.push(`landuse:${t.landuse}`);
                            if (t.natural) categories.push(`natural:${t.natural}`);
                        }

                        const uniqueCats = Array.from(new Set(categories));
                        const landuseType = uniqueCats.length > 0 ? uniqueCats.join(', ') : 'unmapped / open terrain';

                        return db.insert(osmLandCache).values({
                            latRounded: c.latRounded,
                            lonRounded: c.lonRounded,
                            landuseType,
                            osmTags: JSON.stringify(matchedTags),
                            lastUpdatedAt: nowIso,
                        });
                    });

                    if (insertStatements.length > 0) {
                        await db.batch(insertStatements as [any, ...any[]]);
                        totalSaved += insertStatements.length;
                    }
                } catch (err) {
                    console.error('[OSM Batch] Error executing Overpass chunk query:', err);
                }
            }

            return totalSaved;
        },
    };
};

async function _fetchFromOverpass(lat: number, lon: number, radiusMeters: number): Promise<{ landuseType: string; tags: any[] }> {
    const query = `
    [out:json][timeout:25];
    (
      nwr(around:${radiusMeters},${lat},${lon})["landuse"];
      nwr(around:${radiusMeters},${lat},${lon})["natural"];
      nwr(around:${radiusMeters},${lat},${lon})["industrial"];
    );
    out center tags;
    `;

    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'NasaFirmsSpatialClassifier/1.0',
            },
            body: `data=${encodeURIComponent(query)}`,
        });

        if (!response.ok) {
            return { landuseType: 'unmapped / open terrain', tags: [] };
        }

        const data = (await response.json()) as { elements?: any[] };
        const elements = data.elements || [];

        if (elements.length === 0) {
            return { landuseType: 'unmapped / open terrain', tags: [] };
        }

        const matchedTags = elements.map((e) => e.tags || {}).filter((t) => Object.keys(t).length > 0);
        const categories: string[] = [];

        for (const t of matchedTags) {
            if (t.industrial) categories.push(`industrial:${t.industrial}`);
            else if (t.landuse) categories.push(`landuse:${t.landuse}`);
            if (t.natural) categories.push(`natural:${t.natural}`);
        }

        const uniqueCats = Array.from(new Set(categories));
        const landuseType = uniqueCats.length > 0 ? uniqueCats.join(', ') : 'unmapped / open terrain';

        return {
            landuseType,
            tags: matchedTags,
        };
    } catch (err) {
        console.error('Overpass API error:', err);
        return { landuseType: 'unmapped / open terrain', tags: [] };
    }
}
