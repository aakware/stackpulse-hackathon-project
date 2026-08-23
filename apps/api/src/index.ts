import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDb, FirmsQueries, OsmQueries, estimateEventProbabilities, SentinelQueries } from '@repo/data';
import { TestService, getHomeResponse } from '@repo/core';

type Bindings = {
    DB: D1Database;
    NASA_MAPS_API_KEY?: string;
    COPERNICUS_CLIENT_ID?: string;
    COPERNICUS_CLIENT_SECRET?: string;
};


const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({ origin: '*' }));

app.get('/', (c) => c.json(getHomeResponse()));
app.get('/health', (c) => c.text('OK'));

app.get('/test', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const db = createDb(c.env.DB);
    const testService = new TestService(db);
    const results = await testService.getAll();
    return c.json(results);
});

// GET /api/anomalies/today - Fetch today's heat anomaly data (from D1 or NASA FIRMS API)
app.get('/api/anomalies/today', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const dateStr = c.req.query('date');
    const firms = FirmsQueries(c.env.DB, c.env.NASA_MAPS_API_KEY);
    const records = await firms.getAnomaliesForDate(dateStr);
    return c.json({ count: records.length, date: dateStr || new Date().toISOString().split('T')[0], data: records });
});

// GET /api/anomalies/land-info - Retrieve OSM land classification for coordinate (checks D1 cache / 3-month TTL rule)
app.get('/api/anomalies/land-info', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const latStr = c.req.query('lat');
    const lonStr = c.req.query('lon');

    if (!latStr || !lonStr) {
        return c.json({ error: 'Latitude (lat) and longitude (lon) are required' }, 400);
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) {
        return c.json({ error: 'Invalid lat/lon parameters' }, 400);
    }

    const osm = OsmQueries(c.env.DB);
    const landInfo = await osm.getLandInfo(lat, lon);
    return c.json(landInfo);
});

// GET /api/anomalies/classify-event - Multi-signal probabilistic estimation engine
app.get('/api/anomalies/classify-event', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const latStr = c.req.query('lat');
    const lonStr = c.req.query('lon');
    const frpStr = c.req.query('frp');
    const brightnessStr = c.req.query('brightness');
    const acqDate = c.req.query('acqDate') || new Date().toISOString().split('T')[0];
    const daynight = c.req.query('daynight') || 'D';

    if (!latStr || !lonStr) {
        return c.json({ error: 'Latitude (lat) and longitude (lon) are required' }, 400);
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) {
        return c.json({ error: 'Invalid lat/lon parameters' }, 400);
    }

    const frp = frpStr ? parseFloat(frpStr) : 5.0;
    const brightness = brightnessStr ? parseFloat(brightnessStr) : null;

    const firms = FirmsQueries(c.env.DB, c.env.NASA_MAPS_API_KEY);
    const osm = OsmQueries(c.env.DB);

    const [persistenceDays, landInfo] = await Promise.all([
        firms.getAnomalyPersistence(lat, lon),
        osm.getLandInfo(lat, lon),
    ]);

    const probResult = estimateEventProbabilities({
        latitude: lat,
        longitude: lon,
        frp,
        brightness,
        acqDate,
        daynight,
        persistenceDays180d: persistenceDays,
        osmLanduse: landInfo.landuseType,
    });

    return c.json({
        latitude: lat,
        longitude: lon,
        persistenceDays180d: persistenceDays,
        landuseType: landInfo.landuseType,
        ...probResult,
    });
});

// GET /api/anomalies/spatial-history - Retrieve time-series trajectory of detections within 1.5km spatial radius
app.get('/api/anomalies/spatial-history', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const latStr = c.req.query('lat');
    const lonStr = c.req.query('lon');

    if (!latStr || !lonStr) {
        return c.json({ error: 'Latitude and longitude are required' }, 400);
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) {
        return c.json({ error: 'Invalid lat/lon parameters' }, 400);
    }

    const firms = FirmsQueries(c.env.DB, c.env.NASA_MAPS_API_KEY);
    const records = await firms.getSpatialHistory(lat, lon);

    return c.json({
        latitude: lat,
        longitude: lon,
        count: records.length,
        data: records,
    });
});

// GET /api/anomalies/history - Retrieve historical heat anomalies

app.get('/api/anomalies/history', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const dateStr = c.req.query('date');
    const firms = FirmsQueries(c.env.DB, c.env.NASA_MAPS_API_KEY);
    const records = await firms.getAnomaliesForDate(dateStr);
    return c.json({ count: records.length, data: records });
});

// GET /api/anomalies/sentinel-imagery - On-demand Sentinel-2 high-res satellite imagery fetch & D1 cache
app.get('/api/anomalies/sentinel-imagery', async (c) => {
    if (!c.env.DB) {
        return c.json({ error: 'Database binding missing' }, 500);
    }
    const latStr = c.req.query('lat');
    const lonStr = c.req.query('lon');

    if (!latStr || !lonStr) {
        return c.json({ error: 'Latitude (lat) and longitude (lon) are required' }, 400);
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) {
        return c.json({ error: 'Invalid lat/lon parameters' }, 400);
    }

    const db = createDb(c.env.DB);
    const sentinel = SentinelQueries(
        db,
        c.env.COPERNICUS_CLIENT_ID,
        c.env.COPERNICUS_CLIENT_SECRET
    );

    const result = await sentinel.getSentinelImagery(lat, lon);
    return c.json(result);
});

export default app;

