import { sqliteTable, text, real, integer, index } from 'drizzle-orm/sqlite-core';

export const test = sqliteTable('test', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
});

export const heatAnomalies = sqliteTable(
    'heat_anomalies',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        latitude: real('latitude').notNull(),
        longitude: real('longitude').notNull(),
        brightness: real('brightness'),
        scan: real('scan'),
        track: real('track'),
        acqDate: text('acq_date').notNull(),
        acqTime: text('acq_time').notNull(),
        satellite: text('satellite'),
        instrument: text('instrument'),
        confidence: text('confidence'),
        version: text('version'),
        brightT31: real('bright_t31'),
        frp: real('frp'),
        daynight: text('daynight'),
        type: integer('type'),
        createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
    },
    (table) => [
        index('acq_date_idx').on(table.acqDate),
        index('lat_lon_idx').on(table.latitude, table.longitude),
        index('composite_dedup_idx').on(table.latitude, table.longitude, table.acqDate, table.acqTime),
    ]
);

export const osmLandCache = sqliteTable(
    'osm_land_cache',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        latRounded: real('lat_rounded').notNull(),
        lonRounded: real('lon_rounded').notNull(),
        landuseType: text('landuse_type').notNull(),
        osmTags: text('osm_tags'),
        lastUpdatedAt: text('last_updated_at').notNull(),
    },
    (table) => [
        index('lat_lon_cache_idx').on(table.latRounded, table.lonRounded),
    ]
);

export const sentinelImageCache = sqliteTable(
    'sentinel_image_cache',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        latRounded: real('lat_rounded').notNull(),
        lonRounded: real('lon_rounded').notNull(),
        sceneId: text('scene_id'),
        acquiredAt: text('acquired_at').notNull(),
        cloudCover: real('cloud_cover'),
        imageDataBase64: text('image_data_base64').notNull(),
        fetchedAt: text('fetched_at').notNull(),
    },
    (table) => [
        index('lat_lon_sentinel_cache_idx').on(table.latRounded, table.lonRounded),
    ]
);


