import { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { sentinelImageCache } from '../schema';

export interface SentinelImageResult {
    success: boolean;
    cached: boolean;
    acquiredAt: string;
    cloudCover: number;
    sceneId?: string;
    imageDataBase64?: string;
    error?: string;
}

// In-Memory Access Token Cache (Singleton reuse across requests)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/catalog/v1/search';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

/**
 * Obtains or reuses a valid Copernicus Data Space Ecosystem OAuth2 access token.
 */
async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt - 60000) {
        return cachedToken;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Copernicus OAuth authentication failed [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return cachedToken;
}

/**
 * Queries Copernicus Catalog API to locate available Sentinel-2 L2A scenes over the last 45 days,
 * picking the scene with minimum cloud coverage.
 */
async function findBestScene(
    lat: number,
    lon: number,
    accessToken: string,
    daysBack = 45
): Promise<{ sceneId: string; datetime: string; cloudCover: number }> {
    const padding = 0.01;
    const now = new Date();
    const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const payload = {
        bbox: [lon - padding, lat - padding, lon + padding, lat + padding],
        datetime: `${start.toISOString()}/${now.toISOString()}`,
        collections: ['sentinel-2-l2a'],
        limit: 100,
        fields: {
            include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'],
        },
    };

    const res = await fetch(CATALOG_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Copernicus Catalog search failed [${res.status}]: ${errText}`);
    }

    const result = (await res.json()) as {
        features?: Array<{
            id: string;
            properties: { datetime: string; 'eo:cloud_cover': number };
        }>;
    };

    const features = result.features || [];
    if (features.length === 0) {
        throw new Error(`No Sentinel-2 scenes found for coordinate (${lat}, ${lon}) in the last ${daysBack} days.`);
    }

    // Sort features by lowest cloud cover
    features.sort((a, b) => {
        const ccA = a.properties['eo:cloud_cover'] ?? 100;
        const ccB = b.properties['eo:cloud_cover'] ?? 100;
        return ccA - ccB;
    });

    const best = features[0];
    return {
        sceneId: best.id,
        datetime: best.properties.datetime,
        cloudCover: Math.round((best.properties['eo:cloud_cover'] ?? 0) * 100) / 100,
    };
}

/**
 * Calls Copernicus Process API to download a 512x512 True-Color (RGB) PNG image for the coordinate.
 */
async function downloadSentinelPng(
    lat: number,
    lon: number,
    sceneDatetime: string,
    accessToken: string
): Promise<string> {
    const padding = 0.01;
    const dateOnly = sceneDatetime.split('T')[0];
    const fromTime = `${dateOnly}T00:00:00Z`;
    const toTime = `${dateOnly}T23:59:59Z`;

    const evalscript = `
//VERSION=3
function setup() {
    return {
        input: [{
            bands: ["B02", "B03", "B04"],
            units: "REFLECTANCE"
        }],
        output: {
            bands: 3,
            sampleType: "AUTO"
        }
    };
}
function evaluatePixel(sample) {
    return [
        2.5 * sample.B04,
        2.5 * sample.B03,
        2.5 * sample.B02
    ];
}
`;

    const payload = {
        input: {
            bounds: {
                bbox: [lon - padding, lat - padding, lon + padding, lat + padding],
                properties: {
                    crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84',
                },
            },
            data: [
                {
                    type: 'sentinel-2-l2a',
                    dataFilter: {
                        timeRange: {
                            from: fromTime,
                            to: toTime,
                        },
                        maxCloudCoverage: 100,
                        mosaickingOrder: 'leastCC',
                    },
                },
            ],
        },
        output: {
            width: 512,
            height: 512,
            responses: [
                {
                    identifier: 'default',
                    format: {
                        type: 'image/png',
                    },
                },
            ],
        },
        evalscript,
    };

    const res = await fetch(PROCESS_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Copernicus Process API failed [${res.status}]: ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Convert binary bytes to Base64 in Edge runtime compatible manner
    let binaryStr = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
    }
    const base64Str = btoa(binaryStr);
    return `data:image/png;base64,${base64Str}`;
}

export function SentinelQueries(
    db: DrizzleD1Database<any>,
    clientId?: string,
    clientSecret?: string
) {
    return {
        /**
         * Obtains Sentinel-2 high-res satellite image for (lat, lon).
         * Checks D1 SQLite cache first. On cache miss, searches catalog & downloads via Process API.
         */
        async getSentinelImagery(lat: number, lon: number): Promise<SentinelImageResult> {
            const latRounded = Math.round(lat * 1000) / 1000;
            const lonRounded = Math.round(lon * 1000) / 1000;

            // 1. Check D1 SQLite cache
            const cachedRows = await db
                .select()
                .from(sentinelImageCache)
                .where(
                    and(
                        eq(sentinelImageCache.latRounded, latRounded),
                        eq(sentinelImageCache.lonRounded, lonRounded)
                    )
                )
                .limit(1);

            if (cachedRows.length > 0 && cachedRows[0].imageDataBase64) {
                const row = cachedRows[0];
                return {
                    success: true,
                    cached: true,
                    acquiredAt: row.acquiredAt,
                    cloudCover: row.cloudCover ?? 0,
                    sceneId: row.sceneId || undefined,
                    imageDataBase64: row.imageDataBase64,
                };
            }

            // 2. Validate client credentials
            if (!clientId || !clientSecret) {
                return {
                    success: false,
                    cached: false,
                    acquiredAt: '',
                    cloudCover: 0,
                    error: 'Copernicus API credentials (COPERNICUS_CLIENT_ID & COPERNICUS_CLIENT_SECRET) missing.',
                };
            }

            try {
                // 3. Acquire OAuth token (re-used if valid)
                const accessToken = await getAccessToken(clientId, clientSecret);

                // 4. Locate scene with minimum cloud cover
                const scene = await findBestScene(lat, lon, accessToken, 45);

                // 5. Download PNG image via Process API
                const imageDataBase64 = await downloadSentinelPng(lat, lon, scene.datetime, accessToken);

                // 6. Save image to D1 SQLite Cache
                const fetchedAt = new Date().toISOString();
                await db.insert(sentinelImageCache).values({
                    latRounded,
                    lonRounded,
                    sceneId: scene.sceneId,
                    acquiredAt: scene.datetime,
                    cloudCover: scene.cloudCover,
                    imageDataBase64,
                    fetchedAt,
                });

                return {
                    success: true,
                    cached: false,
                    acquiredAt: scene.datetime,
                    cloudCover: scene.cloudCover,
                    sceneId: scene.sceneId,
                    imageDataBase64,
                };
            } catch (err: any) {
                console.error('Error fetching Sentinel-2 imagery:', err);
                return {
                    success: false,
                    cached: false,
                    acquiredAt: '',
                    cloudCover: 0,
                    error: err.message || 'Failed to retrieve Sentinel-2 satellite imagery.',
                };
            }
        },
    };
}
