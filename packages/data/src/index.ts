import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDb(d1: D1Database) {
    return drizzle(d1, { schema });
}

export type DbClient = ReturnType<typeof createDb>;

export * from './schema';
export * from './queries/firms.query';
export * from './queries/osm.query';
export * from './queries/event-classifier';
export * from './queries/power-plants';
export * from './queries/sentinel.query';




